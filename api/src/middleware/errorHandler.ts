import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { env } from '@config/env';
import { ApiError } from '@utils/ApiError';
import { logger } from '@utils/logger';

/** Terminal 404 for unmatched routes — runs after every router. */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `Cannot ${req.method} ${req.originalUrl}`));
}

interface MysqlError extends Error {
  code?: string;
  sqlMessage?: string;
}

function translate(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return ApiError.badRequest(`File exceeds the ${env.MAX_UPLOAD_MB}MB upload limit`);
    }
    return ApiError.badRequest(`Upload rejected: ${error.message}`);
  }

  const mysql = error as MysqlError;
  switch (mysql.code) {
    case 'ER_DUP_ENTRY':
      return ApiError.conflict('A record with these unique values already exists');
    case 'ER_NO_REFERENCED_ROW_2':
      return ApiError.badRequest('Referenced record does not exist');
    case 'ER_ROW_IS_REFERENCED_2':
      return ApiError.conflict('Record is still referenced by other data');
    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
      return new ApiError(503, 'DATABASE_UNAVAILABLE', 'Database is temporarily unavailable');
    default:
      return ApiError.internal();
  }
}

/**
 * Single exit point for every failure.
 *
 * Operational errors (`ApiError`) are returned verbatim; everything else is
 * logged with its stack and correlation id and flattened to a generic 500 so
 * SQL fragments and file paths never reach the browser.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const apiError = translate(err);
  const unexpected = !(err instanceof ApiError);

  const logPayload = {
    method: req.method,
    path: req.originalUrl,
    statusCode: apiError.statusCode,
    code: apiError.code,
    userId: req.user?.userId,
  };

  if (apiError.statusCode >= 500 || unexpected) {
    logger.error(`Unhandled ${apiError.statusCode} on ${req.method} ${req.originalUrl}`, {
      ...logPayload,
      stack: (err as Error)?.stack,
      original: (err as Error)?.message,
    });
  } else {
    logger.warn(`${apiError.code} on ${req.method} ${req.originalUrl}`, logPayload);
  }

  res.status(apiError.statusCode).json({
    error: apiError.toJSON(),
    requestId: req.requestId,
    ...(env.isProduction || !unexpected ? {} : { debug: (err as Error)?.message }),
  });
};
