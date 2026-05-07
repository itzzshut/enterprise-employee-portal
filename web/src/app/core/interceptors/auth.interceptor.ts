import { HttpErrorResponse, type HttpEvent, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import {
  type Observable,
  Subject,
  catchError,
  filter,
  switchMap,
  take,
  throwError,
} from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import { TokenService } from '@core/services/token.service';

/**
 * Module-level refresh coordination.
 *
 * A dashboard load fires five requests at once. If the access token has just
 * expired they all get a 401 more or less simultaneously, and a naive
 * interceptor would fire five refresh calls — four of which replay an
 * already-consumed refresh token and trip the server's reuse detection, killing
 * the session.
 *
 * So: the first 401 sets `refreshInFlight` and performs the refresh; every
 * other request parks on `refreshDone` and retries once the new token lands. A
 * failed refresh pushes `null`, which lets the parked requests fail fast
 * instead of hanging.
 */
let refreshInFlight = false;
const refreshDone = new Subject<string | null>();

/** Endpoints that must never trigger a refresh attempt. */
const AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

function isAuthEndpoint(url: string): boolean {
  return AUTH_PATHS.some((path) => url.includes(path));
}

function withBearer<T>(request: HttpRequest<T>, token: string): HttpRequest<T> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const tokens = inject(TokenService);
  const auth = inject(AuthService);

  const accessToken = tokens.access;
  const authorised =
    accessToken && !isAuthEndpoint(request.url) ? withBearer(request, accessToken) : request;

  return next(authorised).pipe(
    catchError((error: unknown) => {
      const isUnauthorised = error instanceof HttpErrorResponse && error.status === 401;

      if (!isUnauthorised || isAuthEndpoint(request.url) || !tokens.refresh) {
        return throwError(() => error);
      }

      if (refreshInFlight) {
        // Queue: wait for the in-flight refresh, then replay this request once.
        return refreshDone.pipe(
          filter((token): token is string => token !== null),
          take(1),
          switchMap((token) => next(withBearer(request, token))),
        ) as Observable<HttpEvent<unknown>>;
      }

      refreshInFlight = true;

      return auth.refreshTokens().pipe(
        switchMap((result) => {
          refreshInFlight = false;
          refreshDone.next(result.accessToken);
          return next(withBearer(request, result.accessToken));
        }),
        catchError((refreshError: unknown) => {
          refreshInFlight = false;
          refreshDone.next(null);
          // The refresh token is gone or revoked — the session is over.
          auth.logout();
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
