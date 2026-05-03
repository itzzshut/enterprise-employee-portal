import bcrypt from 'bcryptjs';
import { env } from '@config/env';
import { ApiError } from '@utils/ApiError';
import { recordAudit } from '@utils/audit';
import { logger } from '@utils/logger';
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '@utils/jwt';
import { authRepository, type AuthUserRecord } from './auth.repository';
import type { ChangePasswordInput, LoginInput } from './auth.schema';
import type { Role } from '@/types/roles';

export interface SessionUser {
  userId: number;
  employeeId: number | null;
  email: string;
  role: Role;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  departmentId: number | null;
  departmentName: string | null;
  managerId: number | null;
  mustChangePassword: boolean;
}

export interface AuthResult {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

function toSessionUser(record: AuthUserRecord): SessionUser {
  const first = record.first_name ?? '';
  const last = record.last_name ?? '';
  return {
    userId: record.id,
    employeeId: record.employee_id ?? null,
    email: record.email,
    role: record.role,
    firstName: record.first_name,
    lastName: record.last_name,
    fullName: `${first} ${last}`.trim() || record.email,
    jobTitle: record.job_title,
    avatarUrl: record.avatar_url,
    departmentId: record.department_id,
    departmentName: record.department_name,
    managerId: record.manager_id,
    mustChangePassword: Boolean(record.must_change_password),
  };
}

async function issueSession(record: AuthUserRecord, meta: RequestMeta): Promise<AuthResult> {
  const user = toSessionUser(record);

  const accessToken = signAccessToken({
    userId: user.userId,
    role: user.role,
    employeeId: user.employeeId,
    email: user.email,
  });

  const refresh = signRefreshToken(user.userId);
  await authRepository.storeRefreshToken({
    userId: user.userId,
    jti: refresh.jti,
    tokenHash: hashToken(refresh.token),
    expiresAt: refresh.expiresAt,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress,
  });

  return {
    user,
    accessToken,
    refreshToken: refresh.token,
    expiresIn: env.ACCESS_TOKEN_TTL,
  };
}

export const authService = {
  /**
   * Credentials check.
   *
   * A missing account and a wrong password produce the same 401 with the same
   * message, and bcrypt is still executed against a dummy hash when the user
   * does not exist so response timing cannot be used to enumerate accounts.
   */
  async login(input: LoginInput, meta: RequestMeta = {}): Promise<AuthResult> {
    const record = await authRepository.findByEmail(input.email);

    const passwordHash = record?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali';
    const passwordMatches = await bcrypt.compare(input.password, passwordHash);

    if (!record || !passwordMatches) {
      logger.warn('Failed login attempt', { email: input.email, ip: meta.ipAddress });
      throw ApiError.unauthorized('Invalid email or password');
    }
    if (!record.is_active) {
      throw ApiError.forbidden('This account has been deactivated. Contact People Operations.');
    }

    const session = await issueSession(record, meta);
    await authRepository.touchLastLogin(record.id);
    await recordAudit(
      {
        actorUserId: record.id,
        action: 'AUTH_LOGIN',
        entityType: 'user',
        entityId: record.id,
        metadata: { role: record.role },
      },
      meta.ipAddress,
    );

    return session;
  },

  /**
   * Refresh-token rotation with reuse detection.
   *
   * Each refresh consumes exactly one token row and issues a new one. If a token
   * verifies cryptographically but no live row exists, it has already been used
   * (or revoked) — that is the signature of a stolen token, so every session for
   * the user is invalidated rather than just rejecting the call.
   */
  async refresh(rawToken: string, meta: RequestMeta = {}): Promise<AuthResult> {
    const claims = verifyRefreshToken(rawToken);
    const stored = await authRepository.findLiveRefreshToken(claims.jti);

    if (!stored) {
      const revoked = await authRepository.revokeAllForUser(Number(claims.sub));
      logger.error('Refresh token reuse detected — all sessions revoked', {
        userId: Number(claims.sub),
        jti: claims.jti,
        revokedSessions: revoked,
      });
      throw ApiError.unauthorized('Session is no longer valid. Please sign in again.');
    }

    if (stored.token_hash !== hashToken(rawToken)) {
      await authRepository.revokeAllForUser(stored.user_id);
      throw ApiError.unauthorized('Session is no longer valid. Please sign in again.');
    }

    const record = await authRepository.findById(stored.user_id);
    if (!record || !record.is_active) {
      await authRepository.revokeAllForUser(stored.user_id);
      throw ApiError.forbidden('Account is no longer active');
    }

    const session = await issueSession(record, meta);
    const newJti = verifyRefreshToken(session.refreshToken).jti;
    await authRepository.rotateRefreshToken(stored.jti, newJti);

    return session;
  },

  /** Idempotent: an already-revoked or unknown token still resolves quietly. */
  async logout(rawToken: string, actorUserId: number | null, meta: RequestMeta = {}): Promise<void> {
    try {
      const claims = verifyRefreshToken(rawToken);
      await authRepository.revokeRefreshToken(claims.jti);
    } catch {
      logger.debug('Logout called with an unusable refresh token — ignoring');
    }
    if (actorUserId) {
      await recordAudit(
        { actorUserId, action: 'AUTH_LOGOUT', entityType: 'user', entityId: actorUserId },
        meta.ipAddress,
      );
    }
  },

  async me(userId: number): Promise<SessionUser> {
    const record = await authRepository.findById(userId);
    if (!record) throw ApiError.notFound('User');
    return toSessionUser(record);
  },

  async changePassword(userId: number, input: ChangePasswordInput): Promise<void> {
    const record = await authRepository.findById(userId);
    if (!record) throw ApiError.notFound('User');

    const matches = await bcrypt.compare(input.currentPassword, record.password_hash);
    if (!matches) throw ApiError.badRequest('Current password is incorrect');

    const hash = await bcrypt.hash(input.newPassword, env.BCRYPT_ROUNDS);
    await authRepository.updatePassword(userId, hash);
    // Force every other device to re-authenticate with the new credential.
    await authRepository.revokeAllForUser(userId);

    await recordAudit({
      actorUserId: userId,
      action: 'AUTH_PASSWORD_CHANGED',
      entityType: 'user',
      entityId: userId,
    });
  },
};
