import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { TokenService } from '@core/services/token.service';

/**
 * Functional route guard (Angular 15+ style — no class, no NgModule).
 *
 * The session is restored before the router runs (see `app.config.ts`), so by
 * the time this executes `isAuthenticated()` is already settled. The token
 * fallback covers the narrow case of a deep link opened while the restore call
 * is still in flight.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const tokens = inject(TokenService);
  const router = inject(Router);

  if (auth.isAuthenticated() || tokens.hasSession()) return true;

  // Preserve the attempted URL so sign-in can return the user to it.
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/** Keeps an already-signed-in user out of the login page. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const tokens = inject(TokenService);
  const router = inject(Router);

  if (auth.isAuthenticated() || tokens.hasSession()) {
    return router.createUrlTree(['/dashboard']);
  }
  return true;
};
