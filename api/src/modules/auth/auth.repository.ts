import { db } from '@config/knex';
import type { Role } from '@/types/roles';

export interface AuthUserRecord {
  id: number;
  email: string;
  password_hash: string;
  role: Role;
  is_active: number | boolean;
  must_change_password: number | boolean;
  employee_id: number | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  avatar_url: string | null;
  department_id: number | null;
  department_name: string | null;
  manager_id: number | null;
}

export interface RefreshTokenRecord {
  id: number;
  user_id: number;
  jti: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

const PROFILE_COLUMNS = [
  'users.id',
  'users.email',
  'users.password_hash',
  'users.role',
  'users.is_active',
  'users.must_change_password',
] as const;

function baseUserQuery() {
  return db('users')
    .select(...PROFILE_COLUMNS)
    .select(
      db.ref('employees.id').as('employee_id'),
      db.ref('employees.first_name').as('first_name'),
      db.ref('employees.last_name').as('last_name'),
      db.ref('employees.job_title').as('job_title'),
      db.ref('employees.avatar_url').as('avatar_url'),
      db.ref('employees.department_id').as('department_id'),
      db.ref('departments.name').as('department_name'),
      db.ref('employees.manager_id').as('manager_id'),
    )
    .leftJoin('employees', 'employees.user_id', 'users.id')
    .leftJoin('departments', 'departments.id', 'employees.department_id');
}

export const authRepository = {
  findByEmail(email: string): Promise<AuthUserRecord | undefined> {
    return baseUserQuery().where('users.email', email).first<AuthUserRecord | undefined>();
  },

  findById(userId: number): Promise<AuthUserRecord | undefined> {
    return baseUserQuery().where('users.id', userId).first<AuthUserRecord | undefined>();
  },

  async touchLastLogin(userId: number): Promise<void> {
    await db('users').where('id', userId).update({ last_login_at: db.fn.now() });
  },

  async updatePassword(userId: number, passwordHash: string): Promise<void> {
    await db('users')
      .where('id', userId)
      .update({ password_hash: passwordHash, must_change_password: false });
  },

  async storeRefreshToken(input: {
    userId: number;
    jti: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<void> {
    await db('refresh_tokens').insert({
      user_id: input.userId,
      jti: input.jti,
      token_hash: input.tokenHash,
      expires_at: input.expiresAt,
      user_agent: input.userAgent?.slice(0, 255) ?? null,
      ip_address: input.ipAddress ?? null,
    });
  },

  findLiveRefreshToken(jti: string): Promise<RefreshTokenRecord | undefined> {
    return db('refresh_tokens')
      .where('jti', jti)
      .whereNull('revoked_at')
      .where('expires_at', '>', db.fn.now())
      .first<RefreshTokenRecord | undefined>();
  },

  /** Rotation: mark the used token revoked and point it at its successor. */
  async rotateRefreshToken(oldJti: string, newJti: string): Promise<void> {
    await db('refresh_tokens')
      .where('jti', oldJti)
      .update({ revoked_at: db.fn.now(), replaced_by_jti: newJti });
  },

  async revokeRefreshToken(jti: string): Promise<number> {
    return db('refresh_tokens').where('jti', jti).whereNull('revoked_at').update({
      revoked_at: db.fn.now(),
    });
  },

  /** Used on reuse detection and on password change — kills every session. */
  async revokeAllForUser(userId: number): Promise<number> {
    return db('refresh_tokens')
      .where('user_id', userId)
      .whereNull('revoked_at')
      .update({ revoked_at: db.fn.now() });
  },
};
