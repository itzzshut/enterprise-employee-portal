import { Injectable, signal } from '@angular/core';

const ACCESS_KEY = 'ep.accessToken';
const REFRESH_KEY = 'ep.refreshToken';

/**
 * Token storage.
 *
 * Tokens live in localStorage so a refresh of the tab keeps the session, and
 * the access token is mirrored into a signal so the auth interceptor reads it
 * synchronously without touching storage on every request.
 *
 * Trade-off, stated plainly: localStorage is readable by any script on the
 * origin, so it is only acceptable because the app ships a strict CSP with no
 * inline scripts and no third-party JS. The stronger design is an httpOnly
 * refresh cookie with the access token held in memory only — that is on the
 * roadmap and would remove this class entirely.
 */
@Injectable({ providedIn: 'root' })
export class TokenService {
  private readonly accessTokenSignal = signal<string | null>(this.read(ACCESS_KEY));
  private readonly refreshTokenSignal = signal<string | null>(this.read(REFRESH_KEY));

  readonly accessToken = this.accessTokenSignal.asReadonly();

  get access(): string | null {
    return this.accessTokenSignal();
  }

  get refresh(): string | null {
    return this.refreshTokenSignal();
  }

  setTokens(accessToken: string, refreshToken: string): void {
    this.accessTokenSignal.set(accessToken);
    this.refreshTokenSignal.set(refreshToken);
    this.write(ACCESS_KEY, accessToken);
    this.write(REFRESH_KEY, refreshToken);
  }

  clear(): void {
    this.accessTokenSignal.set(null);
    this.refreshTokenSignal.set(null);
    this.write(ACCESS_KEY, null);
    this.write(REFRESH_KEY, null);
  }

  hasSession(): boolean {
    return this.accessTokenSignal() !== null;
  }

  /**
   * Decodes the `exp` claim without verifying the signature — that is the
   * server's job. It is used only to pre-empt an obviously expired token and
   * skip a pointless round trip.
   */
  isAccessTokenExpired(skewSeconds = 10): boolean {
    const token = this.accessTokenSignal();
    if (!token) return true;

    const payload = this.decodePayload(token);
    if (!payload?.exp) return false;
    return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
  }

  private decodePayload(token: string): { exp?: number; role?: string } | null {
    try {
      const segment = token.split('.')[1];
      if (!segment) return null;
      const normalised = segment.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(normalised)) as { exp?: number; role?: string };
    } catch {
      return null;
    }
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      // Private browsing / blocked storage — degrade to an in-memory session.
      return null;
    }
  }

  private write(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: the signals above remain the source of truth */
    }
  }
}
