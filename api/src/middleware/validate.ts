import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ApiError } from '@utils/ApiError';

export interface RequestSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Parses and *replaces* the request segments with their validated output, so
 * controllers receive coerced values (numbers as numbers, dates normalised)
 * and never have to re-check shapes. Unknown keys are stripped by the schemas
 * themselves, which keeps mass-assignment out of the repositories.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          ApiError.badRequest(
            'Request validation failed',
            error.issues.map((issue) => ({
              field: issue.path.join('.') || undefined,
              message: issue.message,
            })),
          ),
        );
        return;
      }
      next(error);
    }
  };
}
