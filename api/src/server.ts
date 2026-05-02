import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from '@config/env';
import { closeDatabase, pingDatabase } from '@config/knex';
import { logger } from '@utils/logger';

const SHUTDOWN_TIMEOUT_MS = 15_000;

async function bootstrap(): Promise<void> {
  // Fail fast at boot rather than serving 500s: if MySQL is unreachable the
  // orchestrator should restart (or hold back) this replica.
  const databaseUp = await pingDatabase().catch(() => false);
  if (!databaseUp) {
    logger.error('Database is unreachable — refusing to start', {
      host: env.DB_HOST,
      database: env.DB_NAME,
    });
    process.exit(1);
  }

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info('API listening', {
      port: env.PORT,
      env: env.NODE_ENV,
      prefix: env.API_PREFIX,
      docs: '/api-docs',
    });
  });

  // Keep-alive slightly above the typical 60s ALB idle timeout so the load
  // balancer closes connections first and we never answer a half-closed socket.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  let shuttingDown = false;

  /**
   * Graceful shutdown.
   *
   * On SIGTERM (a rolling deploy, a `docker compose down`, a pod eviction) we
   * stop accepting new connections, let in-flight requests finish, then drain
   * the MySQL pool. The watchdog guarantees the process still exits even if a
   * socket refuses to close, because a container that ignores SIGTERM gets
   * SIGKILLed and loses whatever it was mid-way through.
   */
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — draining connections`, { timeoutMs: SHUTDOWN_TIMEOUT_MS });

    const watchdog = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    watchdog.unref();

    server.close(async (closeError) => {
      if (closeError) logger.error('Error while closing HTTP server', { error: closeError.message });
      try {
        await closeDatabase();
        logger.info('Shutdown complete');
        clearTimeout(watchdog);
        process.exit(0);
      } catch (error) {
        logger.error('Failed to close the database pool', { error: (error as Error).message });
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — shutting down', { error: error.message, stack: error.stack });
    void shutdown('uncaughtException');
  });
}

void bootstrap();
