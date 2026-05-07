import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '@core/services/notification.service';
import type { ApiErrorEnvelope } from '@core/models';

/**
 * Turns an API error envelope into a toast, once, in one place.
 *
 * Deliberate omissions:
 *   - 401 is handled by the auth interceptor (refresh, then sign-out), so
 *     surfacing it here would double-notify during a normal token refresh.
 *   - 422 and 409 are business outcomes that forms render inline next to the
 *     offending field; a toast on top of that is noise.
 * The error is always re-thrown so the calling component can still react.
 */
const SILENT_STATUSES = new Set([401, 409, 422]);

function describe(error: HttpErrorResponse): { title: string; message: string } {
  if (error.status === 0) {
    return {
      title: 'Cannot reach the server',
      message: 'Check your connection — the portal will retry when you act again.',
    };
  }

  const envelope = error.error as ApiErrorEnvelope | undefined;
  const apiMessage = envelope?.error?.message;
  const requestId = envelope?.requestId;

  const titles: Record<number, string> = {
    400: 'That request was not valid',
    403: 'You do not have access to that',
    404: 'Not found',
    413: 'File is too large',
    429: 'Too many requests',
    500: 'Something went wrong on our side',
    503: 'Service temporarily unavailable',
  };

  return {
    title: titles[error.status] ?? `Request failed (${error.status})`,
    message: requestId
      ? `${apiMessage ?? error.message} · ref ${requestId.slice(0, 8)}`
      : (apiMessage ?? error.message),
  };
}

export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const notifications = inject(NotificationService);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && !SILENT_STATUSES.has(error.status)) {
        const { title, message } = describe(error);
        notifications.error(title, message);
      }
      return throwError(() => error);
    }),
  );
};
