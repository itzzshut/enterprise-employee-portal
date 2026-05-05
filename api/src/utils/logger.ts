import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import winston from 'winston';
import { env } from '@config/env';

/**
 * Request-scoped context.
 *
 * `requestId` middleware seeds this store, so every log line emitted anywhere
 * downstream — controller, service, repository — carries the same correlation
 * id without threading a logger argument through every function signature.
 */
export const requestContext = new AsyncLocalStorage<{ requestId: string; userId?: number }>();

const correlationFormat = winston.format((info) => {
  const store = requestContext.getStore();
  if (store) {
    info.requestId = store.requestId;
    if (store.userId !== undefined) info.userId = store.userId;
  }
  return info;
});

const jsonFormat = winston.format.combine(
  correlationFormat(),
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const prettyFormat = winston.format.combine(
  correlationFormat(),
  winston.format.colorize({ level: true }),
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.printf(({ level, message, timestamp, requestId, stack, ...meta }) => {
    const rid = requestId ? ` [${String(requestId).slice(0, 8)}]` : '';
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}${rid} ${stack ?? message}${extra}`;
  }),
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: env.isProduction ? jsonFormat : prettyFormat,
    handleExceptions: true,
  }),
];

// Errors also go to their own file so an on-call engineer can tail failures
// without wading through request logs. In containers the file transport is a
// convenience for `docker cp`; the console stream remains the source of truth.
if (!env.isTest) {
  transports.push(
    new winston.transports.File({
      filename: path.join(env.logDir, 'error.log'),
      level: 'error',
      format: jsonFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  );
}

export const logger = winston.createLogger({
  level: env.isTest ? 'error' : env.LOG_LEVEL,
  defaultMeta: { service: 'employee-portal-api', env: env.NODE_ENV },
  format: jsonFormat,
  transports,
  exitOnError: false,
});

/** Morgan stream adapter — HTTP access lines keep the same JSON shape. */
export const httpLogStream = {
  write: (message: string): void => {
    logger.http(message.trim());
  },
};
