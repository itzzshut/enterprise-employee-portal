import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import type { AuthResult, SessionUser } from '@core/models';

const SESSION_USER: SessionUser = {
  userId: 4,
  employeeId: 4,
  email: 'employee@portal.dev',
  role: 'EMPLOYEE',
  firstName: 'Priya',
  lastName: 'Raman',
  fullName: 'Priya Raman',
  jobTitle: 'Senior Software Engineer',
  avatarUrl: null,
  departmentId: 1,
  departmentName: 'Engineering',
  managerId: 3,
  mustChangePassword: false,
};

const AUTH_RESULT: AuthResult = {
  user: SESSION_USER,
  accessToken: 'header.payload.signature',
  refreshToken: 'refresh.payload.signature',
  expiresIn: '15m',
};

describe('AuthService', () => {
  let service: AuthService;
  let tokens: TokenService;
  let http: HttpTestingController;
  const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
      ],
    });

    service = TestBed.inject(AuthService);
    tokens = TestBed.inject(TokenService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts unauthenticated with an unknown session', () => {
      expect(service.isAuthenticated()).toBe(false);
      expect(service.user()).toBeNull();
      expect(service.role()).toBeNull();
      expect(service.status()).toBe('unknown');
      expect(service.displayName()).toBe('Signed out');
    });
  });

  describe('login', () => {
    it('posts the credentials and stores the resulting session', () => {
      let emitted: AuthResult | undefined;
      service.login('employee@portal.dev', 'Employee@12345').subscribe((result) => {
        emitted = result;
      });

      const request = http.expectOne('/api/v1/auth/login');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        email: 'employee@portal.dev',
        password: 'Employee@12345',
      });
      request.flush(AUTH_RESULT);

      expect(emitted).toEqual(AUTH_RESULT);
      expect(service.isAuthenticated()).toBe(true);
      expect(service.status()).toBe('authenticated');
      expect(service.user()?.fullName).toBe('Priya Raman');
      expect(tokens.access).toBe('header.payload.signature');
      expect(tokens.refresh).toBe('refresh.payload.signature');
    });

    it('leaves the session untouched when the credentials are rejected', () => {
      const errors: unknown[] = [];
      service.login('employee@portal.dev', 'wrong-password').subscribe({
        error: (error: unknown) => errors.push(error),
      });

      http.expectOne('/api/v1/auth/login').flush(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } },
        { status: 401, statusText: 'Unauthorized' },
      );

      expect(errors).toHaveLength(1);
      expect(service.isAuthenticated()).toBe(false);
      expect(tokens.access).toBeNull();
    });
  });

  describe('derived role signals', () => {
    beforeEach(() => {
      service.login('employee@portal.dev', 'Employee@12345').subscribe();
      http.expectOne('/api/v1/auth/login').flush(AUTH_RESULT);
    });

    it('exposes the role from the session', () => {
      expect(service.role()).toBe('EMPLOYEE');
      expect(service.isManager()).toBe(false);
      expect(service.isHrAdmin()).toBe(false);
    });

    it('matches roles with hasRole', () => {
      expect(service.hasRole('EMPLOYEE')).toBe(true);
      expect(service.hasRole('MANAGER', 'HR_ADMIN')).toBe(false);
      expect(service.hasRole('EMPLOYEE', 'MANAGER')).toBe(true);
    });
  });

  describe('manager and HR sessions', () => {
    it('treats HR_ADMIN as both manager and HR', () => {
      service.login('hr@portal.dev', 'HrAdmin@12345').subscribe();
      http.expectOne('/api/v1/auth/login').flush({
        ...AUTH_RESULT,
        user: { ...SESSION_USER, role: 'HR_ADMIN', email: 'hr@portal.dev' },
      });

      expect(service.isManager()).toBe(true);
      expect(service.isHrAdmin()).toBe(true);
    });

    it('treats MANAGER as a manager but not HR', () => {
      service.login('manager@portal.dev', 'Manager@12345').subscribe();
      http.expectOne('/api/v1/auth/login').flush({
        ...AUTH_RESULT,
        user: { ...SESSION_USER, role: 'MANAGER' },
      });

      expect(service.isManager()).toBe(true);
      expect(service.isHrAdmin()).toBe(false);
    });
  });

  describe('restoreSession', () => {
    it('resolves to null without a request when no token is stored', () => {
      let result: SessionUser | null | undefined;
      service.restoreSession().subscribe((user) => {
        result = user;
      });

      expect(result).toBeNull();
      expect(service.status()).toBe('anonymous');
      http.expectNone('/api/v1/auth/me');
    });

    it('confirms a stored token against /auth/me', () => {
      tokens.setTokens('stored.access.token', 'stored.refresh.token');

      let result: SessionUser | null | undefined;
      service.restoreSession().subscribe((user) => {
        result = user;
      });

      http.expectOne('/api/v1/auth/me').flush({ user: SESSION_USER });

      expect(result).toEqual(SESSION_USER);
      expect(service.isAuthenticated()).toBe(true);
      expect(service.status()).toBe('authenticated');
    });

    it('clears a stale token rather than leaving a half-signed-in UI', () => {
      tokens.setTokens('stale.access.token', 'stale.refresh.token');

      let result: SessionUser | null | undefined;
      service.restoreSession().subscribe((user) => {
        result = user;
      });

      http
        .expectOne('/api/v1/auth/me')
        .flush({ error: { code: 'UNAUTHORIZED', message: 'nope' } }, { status: 401, statusText: 'Unauthorized' });

      expect(result).toBeNull();
      expect(tokens.access).toBeNull();
      expect(service.isAuthenticated()).toBe(false);
      expect(service.status()).toBe('anonymous');
    });
  });

  describe('refreshTokens', () => {
    it('sends the stored refresh token and replaces the pair', () => {
      tokens.setTokens('old.access', 'old.refresh');

      service.refreshTokens().subscribe();
      const request = http.expectOne('/api/v1/auth/refresh');
      expect(request.request.body).toEqual({ refreshToken: 'old.refresh' });

      request.flush({
        ...AUTH_RESULT,
        accessToken: 'new.access',
        refreshToken: 'new.refresh',
      });

      expect(tokens.access).toBe('new.access');
      expect(tokens.refresh).toBe('new.refresh');
      expect(service.isAuthenticated()).toBe(true);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token, clears state and redirects', () => {
      tokens.setTokens('some.access', 'some.refresh');
      service.logout();

      const request = http.expectOne('/api/v1/auth/logout');
      expect(request.request.body).toEqual({ refreshToken: 'some.refresh' });
      request.flush(null);

      expect(tokens.access).toBeNull();
      expect(service.user()).toBeNull();
      expect(service.status()).toBe('anonymous');
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('still clears the session when the server call fails', () => {
      tokens.setTokens('some.access', 'some.refresh');
      service.logout();

      http
        .expectOne('/api/v1/auth/logout')
        .flush(null, { status: 500, statusText: 'Server Error' });

      expect(tokens.access).toBeNull();
      expect(service.isAuthenticated()).toBe(false);
    });

    it('skips the redirect when asked to', () => {
      tokens.clear();
      service.logout(false);

      expect(router.navigate).not.toHaveBeenCalled();
      http.expectNone('/api/v1/auth/logout');
    });
  });

  describe('changePassword', () => {
    it('posts both passwords to the change-password endpoint', () => {
      service.changePassword('Employee@12345', 'BrandNewPass1').subscribe();

      const request = http.expectOne('/api/v1/auth/change-password');
      expect(request.request.body).toEqual({
        currentPassword: 'Employee@12345',
        newPassword: 'BrandNewPass1',
      });
      request.flush({ message: 'Password updated.' });
    });
  });
});
