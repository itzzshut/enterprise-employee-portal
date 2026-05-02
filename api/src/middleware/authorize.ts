import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '@utils/ApiError';
import { hasAtLeast, type Role } from '@/types/roles';

/**
 * Coarse route-level RBAC.
 *
 * `authorize()` answers "may this role call this endpoint at all?". It is NOT
 * sufficient on its own: row-level questions ("is this employee one of my
 * direct reports?") are enforced inside the services, because only they know
 * the ownership graph. Both layers are required — see docs/ARCHITECTURE.md.
 */
export function authorize(...allowed: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!allowed.includes(req.user.role)) {
      next(
        ApiError.forbidden(
          `Role ${req.user.role} cannot access this resource (requires one of: ${allowed.join(', ')})`,
        ),
      );
      return;
    }
    next();
  };
}

/** Rank-based variant: `authorizeAtLeast('MANAGER')` allows MANAGER and above. */
export function authorizeAtLeast(minimum: Role): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!hasAtLeast(req.user.role, minimum)) {
      next(ApiError.forbidden(`Requires ${minimum} privileges or higher`));
      return;
    }
    next();
  };
}
