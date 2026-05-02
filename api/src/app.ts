import path from 'node:path';
import express, { type Application, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { env } from '@config/env';
import { requestId } from '@middleware/requestId';
import { errorHandler, notFound } from '@middleware/errorHandler';
import { httpLogStream } from '@utils/logger';
import { apiRouter } from '@/routes';
import { mountSwagger } from '@/docs/openapi';

/**
 * Builds the Express application.
 *
 * Exported separately from `server.ts` so Supertest can exercise the full
 * middleware pipeline — CORS, helmet, validation, error translation — without
 * binding a port.
 *
 * Middleware order matters and is deliberate:
 *   1. trust proxy / requestId  — correlation id exists before anything logs
 *   2. helmet, cors             — reject hostile requests as early as possible
 *   3. compression, body parser — cheap transforms
 *   4. morgan                   — log the request once it is well-formed
 *   5. routes                   — business logic
 *   6. notFound, errorHandler   — single exit point for every response
 */
export function createApp(): Application {
  const app = express();

  // Behind nginx / an ALB, `req.ip` must come from X-Forwarded-For, otherwise
  // every rate-limit bucket would collapse onto the proxy's address.
  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);

  app.use(
    helmet({
      // The API serves JSON and Swagger UI only; the SPA is served by nginx
      // with its own policy. `unsafe-inline` styles are required by swagger-ui.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  morgan.token('requestId', (req) => (req as Request).requestId ?? '-');
  app.use(
    morgan(
      ':method :url :status :res[content-length] - :response-time ms rid=:requestId',
      { stream: httpLogStream, skip: () => env.isTest },
    ),
  );

  /**
   * Liveness probe — no database, no auth. Kubernetes restarts the container if
   * this stops answering, so it must never depend on a downstream service.
   */
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'employee-portal-api',
      version: process.env.APP_VERSION ?? 'dev',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Avatars are public-by-obscurity static assets; documents are streamed
  // through the authenticated download endpoint instead.
  app.use(
    '/static/avatars',
    express.static(path.join(env.uploadDir, 'avatars'), {
      maxAge: '7d',
      index: false,
      dotfiles: 'deny',
    }),
  );

  mountSwagger(app);

  app.use(env.API_PREFIX, apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
