import bcrypt from 'bcryptjs';
import { authService } from './auth.service';
import { authRepository, type AuthUserRecord } from './auth.repository';
import { hashToken, signRefreshToken, verifyRefreshToken } from '@utils/jwt';
import { ApiError } from '@utils/ApiError';

jest.mock('./auth.repository');
jest.mock('@utils/audit', () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('$2a$12$freshly.hashed.password'),
}));

const mockedRepo = authRepository as jest.Mocked<typeof authRepository>;
const mockedBcrypt = bcrypt as unknown as {
  compare: jest.Mock;
  hash: jest.Mock;
};

function userRecord(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: 4,
    email: 'employee@portal.dev',
    password_hash: '$2a$12$storedhash',
    role: 'EMPLOYEE',
    is_active: 1,
    must_change_password: 0,
    employee_id: 4,
    first_name: 'Priya',
    last_name: 'Raman',
    job_title: 'Senior Software Engineer',
    avatar_url: null,
    department_id: 1,
    department_name: 'Engineering',
    manager_id: 3,
    ...overrides,
  };
}

describe('authService.login', () => {
  beforeEach(() => {
    mockedRepo.storeRefreshToken.mockResolvedValue(undefined);
    mockedRepo.touchLastLogin.mockResolvedValue(undefined);
  });

  it('issues an access and refresh token pair for valid credentials', async () => {
    mockedRepo.findByEmail.mockResolvedValue(userRecord());
    mockedBcrypt.compare.mockResolvedValue(true);

    const result = await authService.login(
      { email: 'employee@portal.dev', password: 'Employee@12345' },
      { ipAddress: '10.0.0.5', userAgent: 'jest' },
    );

    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.user).toMatchObject({
      userId: 4,
      employeeId: 4,
      role: 'EMPLOYEE',
      fullName: 'Priya Raman',
      departmentName: 'Engineering',
    });
    expect(result.expiresIn).toBe('15m');
    expect(mockedRepo.touchLastLogin).toHaveBeenCalledWith(4);
  });

  it('persists only the hash of the refresh token, never the token itself', async () => {
    mockedRepo.findByEmail.mockResolvedValue(userRecord());
    mockedBcrypt.compare.mockResolvedValue(true);

    const result = await authService.login({
      email: 'employee@portal.dev',
      password: 'Employee@12345',
    });

    const stored = mockedRepo.storeRefreshToken.mock.calls[0][0];
    expect(stored.tokenHash).toBe(hashToken(result.refreshToken));
    expect(stored.tokenHash).not.toBe(result.refreshToken);
    expect(stored.tokenHash).toHaveLength(64);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an unknown email with the same 401 as a wrong password', async () => {
    mockedRepo.findByEmail.mockResolvedValue(undefined);
    mockedBcrypt.compare.mockResolvedValue(false);

    await expect(
      authService.login({ email: 'nobody@portal.dev', password: 'whatever123' }),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid email or password' });

    // Timing-attack mitigation: bcrypt still runs when the account is absent.
    expect(mockedBcrypt.compare).toHaveBeenCalled();
  });

  it('rejects a wrong password', async () => {
    mockedRepo.findByEmail.mockResolvedValue(userRecord());
    mockedBcrypt.compare.mockResolvedValue(false);

    await expect(
      authService.login({ email: 'employee@portal.dev', password: 'wrongpassword' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockedRepo.storeRefreshToken).not.toHaveBeenCalled();
  });

  it('refuses a deactivated account with 403 rather than 401', async () => {
    mockedRepo.findByEmail.mockResolvedValue(userRecord({ is_active: 0 }));
    mockedBcrypt.compare.mockResolvedValue(true);

    await expect(
      authService.login({ email: 'employee@portal.dev', password: 'Employee@12345' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('authService.refresh', () => {
  it('rotates the token and marks the old one as replaced', async () => {
    const issued = signRefreshToken(4);
    mockedRepo.findLiveRefreshToken.mockResolvedValue({
      id: 10,
      user_id: 4,
      jti: issued.jti,
      token_hash: hashToken(issued.token),
      expires_at: issued.expiresAt,
      revoked_at: null,
    });
    mockedRepo.findById.mockResolvedValue(userRecord());
    mockedRepo.storeRefreshToken.mockResolvedValue(undefined);
    mockedRepo.rotateRefreshToken.mockResolvedValue(undefined);

    const result = await authService.refresh(issued.token);

    expect(result.refreshToken).not.toBe(issued.token);
    const newJti = verifyRefreshToken(result.refreshToken).jti;
    expect(mockedRepo.rotateRefreshToken).toHaveBeenCalledWith(issued.jti, newJti);
  });

  it('revokes every session when a consumed token is replayed', async () => {
    const issued = signRefreshToken(4);
    mockedRepo.findLiveRefreshToken.mockResolvedValue(undefined);
    mockedRepo.revokeAllForUser.mockResolvedValue(3);

    await expect(authService.refresh(issued.token)).rejects.toMatchObject({ statusCode: 401 });
    expect(mockedRepo.revokeAllForUser).toHaveBeenCalledWith(4);
  });

  it('revokes every session when the stored hash does not match', async () => {
    const issued = signRefreshToken(4);
    mockedRepo.findLiveRefreshToken.mockResolvedValue({
      id: 11,
      user_id: 4,
      jti: issued.jti,
      token_hash: 'a'.repeat(64),
      expires_at: issued.expiresAt,
      revoked_at: null,
    });
    mockedRepo.revokeAllForUser.mockResolvedValue(1);

    await expect(authService.refresh(issued.token)).rejects.toMatchObject({ statusCode: 401 });
    expect(mockedRepo.revokeAllForUser).toHaveBeenCalledWith(4);
  });

  it('rejects a structurally invalid token before touching the database', async () => {
    await expect(authService.refresh('not-a-jwt')).rejects.toMatchObject({ statusCode: 401 });
    expect(mockedRepo.findLiveRefreshToken).not.toHaveBeenCalled();
  });

  it('refuses to refresh a session for a deactivated account', async () => {
    const issued = signRefreshToken(9);
    mockedRepo.findLiveRefreshToken.mockResolvedValue({
      id: 12,
      user_id: 9,
      jti: issued.jti,
      token_hash: hashToken(issued.token),
      expires_at: issued.expiresAt,
      revoked_at: null,
    });
    mockedRepo.findById.mockResolvedValue(userRecord({ id: 9, is_active: 0 }));
    mockedRepo.revokeAllForUser.mockResolvedValue(1);

    await expect(authService.refresh(issued.token)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('authService.changePassword', () => {
  it('re-hashes the password and revokes every other session', async () => {
    mockedRepo.findById.mockResolvedValue(userRecord());
    mockedBcrypt.compare.mockResolvedValue(true);
    mockedRepo.updatePassword.mockResolvedValue(undefined);
    mockedRepo.revokeAllForUser.mockResolvedValue(2);

    await authService.changePassword(4, {
      currentPassword: 'Employee@12345',
      newPassword: 'BrandNewPass1',
    });

    expect(mockedBcrypt.hash).toHaveBeenCalledWith('BrandNewPass1', 10);
    expect(mockedRepo.updatePassword).toHaveBeenCalledWith(4, '$2a$12$freshly.hashed.password');
    expect(mockedRepo.revokeAllForUser).toHaveBeenCalledWith(4);
  });

  it('rejects an incorrect current password', async () => {
    mockedRepo.findById.mockResolvedValue(userRecord());
    mockedBcrypt.compare.mockResolvedValue(false);

    await expect(
      authService.changePassword(4, { currentPassword: 'nope12345', newPassword: 'BrandNewPass1' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockedRepo.updatePassword).not.toHaveBeenCalled();
  });
});

describe('authService.logout', () => {
  it('is idempotent for an unusable token', async () => {
    await expect(authService.logout('garbage', 4)).resolves.toBeUndefined();
    expect(mockedRepo.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('revokes the matching token row', async () => {
    const issued = signRefreshToken(4);
    mockedRepo.revokeRefreshToken.mockResolvedValue(1);

    await authService.logout(issued.token, 4);
    expect(mockedRepo.revokeRefreshToken).toHaveBeenCalledWith(issued.jti);
  });
});
