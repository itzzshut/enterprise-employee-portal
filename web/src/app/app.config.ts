import {
  APP_INITIALIZER,
  type ApplicationConfig,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  PreloadAllModules,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
  withRouterConfig,
} from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { appRoutes } from './app.routes';
import { authInterceptor } from '@core/interceptors/auth.interceptor';
import { errorInterceptor } from '@core/interceptors/error.interceptor';
import { AuthService } from '@core/services/auth.service';

/**
 * Restores the session before the first route resolves.
 *
 * Without this the auth guard would run against an empty session on a hard
 * refresh and bounce a signed-in user to the login page for a frame. The
 * initialiser never rejects — `restoreSession` swallows its own failure and
 * settles the session as anonymous — so a dead API cannot block bootstrap.
 */
function restoreSessionInitializer(auth: AuthService): () => Promise<unknown> {
  return () => firstValueFrom(auth.restoreSession());
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),

    provideRouter(
      appRoutes,
      // Route params and query params bind straight to component inputs, which
      // removes a lot of ActivatedRoute boilerplate from the feature code.
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
      // Lazy chunks are fetched once the app is idle: the first paint stays
      // small, but navigation afterwards is instant.
      withPreloading(PreloadAllModules),
      withRouterConfig({ onSameUrlNavigation: 'reload' }),
    ),

    // Interceptor order matters: auth runs first so a retried request carries
    // the refreshed token, and error runs outermost so it sees the final
    // outcome rather than the transient 401.
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),

    {
      provide: APP_INITIALIZER,
      useFactory: restoreSessionInitializer,
      deps: [AuthService],
      multi: true,
    },
  ],
};
