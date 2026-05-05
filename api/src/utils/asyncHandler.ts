import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not await handler promises, so a rejected promise inside an
 * `async` controller becomes an unhandled rejection instead of a 500. Wrapping
 * every controller keeps `try/catch` out of the controllers themselves.
 *
 * (Express 5 forwards rejections natively; this wrapper is the one line that
 * has to change when we upgrade.)
 */
export function asyncHandler<T extends Request = Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req as T, res, next)).catch(next);
  };
}
