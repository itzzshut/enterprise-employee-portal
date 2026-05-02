import type { NextFunction, Request, Response } from 'express';
import { db } from '@config/knex';
import { ApiError } from '@utils/ApiError';
import { verifyAccessToken } from '@utils/jwt';
import { requestContext } from '@utils/logger';
import type { Role } from '@/types/roles';

interface UserRow {
  id: number;
  email: string;
  role: Role;
  is_active: number | boolean;
  employee_id: number | null;
}

/**
 * Verifies the bearer access token and loads the *current* user state.
 *
 * The extra `users` lookup is deliberate: access tokens live for 15 minutes, so
 * without it a deactivated account (or a role demotion) would stay valid for up
 * to a quarter of an hour. One indexed primary-key read per request is a cheap
 * price for immediate revocation.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Missing bearer token');
    }

    const claims = verifyAccessToken(header.slice('Bearer '.length).trim());

    const row = await db<UserRow>('users')
      .select('users.id', 'users.email', 'users.role', 'users.is_active')
      .select(db.ref('employees.id').as('employee_id'))
      .leftJoin('employees', 'employees.user_id', 'users.id')
      .where('users.id', Number(claims.sub))
      .first();

    if (!row) throw ApiError.unauthorized('Account no longer exists');
    if (!row.is_active) throw ApiError.forbidden('Account has been deactivated');

    req.user = {
      userId: row.id,
      email: row.email,
      role: row.role,
      employeeId: row.employee_id ?? null,
    };

    const store = requestContext.getStore();
    if (store) store.userId = row.id;

    next();
  } catch (error) {
    next(error);
  }
}

/** Convenience accessor for controllers that run behind `authenticate`. */
export function currentUser(req: Request): NonNullable<Request['user']> {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}
