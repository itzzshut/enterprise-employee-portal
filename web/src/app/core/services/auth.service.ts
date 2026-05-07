import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { EMPTY, type Observable, catchError, map, of, tap } from 'rxjs';
import { ApiService } from './api.service';
import { TokenService } from './token.service';
import type { AuthResult, Role, SessionUser } from '@core/models';

export type SessionStatus = 'unknown' | 'restoring' | 'authenticated' | 'anonymous';

/**
 * Session state as signals.
 *
 * There is exactly one writable signal here (`sessionUser`); everything else —
 * `isAuthenticated`, `role`, `initials`, `isManager` — is derived. That is the
 * whole reason this app does not carry an NgRx store: the state is one object,
 * the derivations are pure, and the async work is already modelled by
 * HttpClient observables. See docs/ARCHITECTURE.md for the longer argument.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly tokens = inject(TokenService);
  private readonly router = inject(Router);

  private readonly sessionUser = signal<SessionUser | null>(null);
  private readonly sessionStatus = signal<SessionStatus>('unknown');

  readonly user = this.sessionUser.asReadonly();
  readonly status = this.sessionStatus.asReadonly();

  readonly isAuthenticated = computed(() => this.sessionUser() !== null);
  readonly role = computed<Role | null>(() => this.sessionUser()?.role ?? null);
  readonly isManager = computed(() => {
    const role = this.role();
    return role === 'MANAGER' || role === 'HR_ADMIN' || role === 'SUPER_ADMIN';
  });
  readonly isHrAdmin = computed(() => {
    const role = this.role();
    return role === 'HR_ADMIN' || role === 'SUPER_ADMIN';
  });
  readonly displayName = computed(() => this.sessionUser()?.fullName ?? 'Signed out');

  login(email: string, password: string): Observable<AuthResult> {
    return this.api.post<AuthResult>('/auth/login', { email, password }).pipe(
      tap((result) => {
        this.tokens.setTokens(result.accessToken, result.refreshToken);
        this.sessionUser.set(result.user);
        this.sessionStatus.set('authenticated');
      }),
    );
  }

  /**
   * Called once by the app initialiser. A stored token is only *probably*
   * valid, so the session is confirmed against `/auth/me`; a failure clears the
   * tokens rather than leaving the UI in a half-signed-in state.
   */
  restoreSession(): Observable<SessionUser | null> {
    if (!this.tokens.hasSession()) {
      this.sessionStatus.set('anonymous');
      return of(null);
    }

    this.sessionStatus.set('restoring');
    return this.api.get<{ user: SessionUser }>('/auth/me').pipe(
      map(({ user }) => {
        this.sessionUser.set(user);
        this.sessionStatus.set('authenticated');
        return user;
      }),
      catchError(() => {
        this.tokens.clear();
        this.sessionUser.set(null);
        this.sessionStatus.set('anonymous');
        return of(null);
      }),
    );
  }

  /** Used by the auth interceptor when an access token has expired. */
  refreshTokens(): Observable<AuthResult> {
    return this.api
      .post<AuthResult>('/auth/refresh', { refreshToken: this.tokens.refresh })
      .pipe(
        tap((result) => {
          this.tokens.setTokens(result.accessToken, result.refreshToken);
          this.sessionUser.set(result.user);
          this.sessionStatus.set('authenticated');
        }),
      );
  }

  logout(redirect = true): void {
    const refreshToken = this.tokens.refresh;

    // Fire-and-forget: the local session is cleared regardless of whether the
    // server call succeeds, so a network failure can never trap a user in.
    if (refreshToken) {
      this.api
        .post('/auth/logout', { refreshToken })
        .pipe(catchError(() => EMPTY))
        .subscribe();
    }

    this.tokens.clear();
    this.sessionUser.set(null);
    this.sessionStatus.set('anonymous');
    if (redirect) void this.router.navigate(['/login']);
  }

  hasRole(...roles: Role[]): boolean {
    const current = this.role();
    return current !== null && roles.includes(current);
  }

  changePassword(currentPassword: string, newPassword: string): Observable<{ message: string }> {
    return this.api.post<{ message: string }>('/auth/change-password', {
      currentPassword,
      newPassword,
    });
  }
}
