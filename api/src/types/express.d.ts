import type { Role } from './roles';

export interface AuthenticatedUser {
  userId: number;
  email: string;
  role: Role;
  /** Null only for platform accounts that are not tied to an employee record. */
  employeeId: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id, echoed back as the `X-Request-Id` response header. */
      requestId: string;
      /** Populated by the `authenticate` middleware. */
      user?: AuthenticatedUser;
    }
  }
}

export {};
