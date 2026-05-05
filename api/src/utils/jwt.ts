import crypto from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '@config/env';
import { ApiError } from './ApiError';
import type { Role } from '@/types/roles';

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  role: Role;
  employeeId: number | null;
  email: string;
}

export interface RefreshTokenClaims extends JwtPayload {
  sub: string;
  jti: string;
}

const ISSUER = 'employee-portal-api';
const AUDIENCE = 'employee-portal-web';

export function signAccessToken(payload: {
  userId: number;
  role: Role;
  employeeId: number | null;
  email: string;
}): string {
  const options: SignOptions = {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: String(payload.userId),
  };
  return jwt.sign(
    { role: payload.role, employeeId: payload.employeeId, email: payload.email },
    env.JWT_ACCESS_SECRET,
    options,
  );
}

/**
 * Refresh tokens are opaque to the client but carry a `jti` so the server can
 * look up (and revoke) the exact row in `refresh_tokens`. Only the SHA-256
 * digest is persisted — a database dump therefore cannot be replayed.
 */
export function signRefreshToken(userId: number): { token: string; jti: string; expiresAt: Date } {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ jti }, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: String(userId),
  });
  return { token, jti, expiresAt: new Date(Date.now() + env.refreshTokenTtlMs) };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as AccessTokenClaims;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, 'TOKEN_EXPIRED', 'Access token has expired');
    }
    throw ApiError.unauthorized('Invalid access token');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as RefreshTokenClaims;
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
