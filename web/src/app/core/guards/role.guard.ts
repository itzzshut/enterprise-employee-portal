import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { NotificationService } from '@core/services/notification.service';
import type { Role } from '@core/models';

/**
 * Role guard factory: `canActivate: [authGuard, roleGuard('HR_ADMIN')]`.
 *
 * This is convenience and clarity, not security — the API enforces the same
 * rules on every request. Hiding a route the server would refuse anyway just
 * means the user sees a clear message instead of a 403 toast.
 */
export function roleGuard(...allowed: Role[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const notifications = inject(NotificationService);
    const router = inject(Router);

    if (auth.hasRole(...allowed)) return true;

    notifications.warning(
      'That area is restricted',
      `It is limited to: ${allowed.map(formatRole).join(', ')}.`,
    );
    return router.createUrlTree(['/dashboard']);
  };
}

function formatRole(role: Role): string {
  switch (role) {
    case 'HR_ADMIN':
      return 'People Operations';
    case 'SUPER_ADMIN':
      return 'Administrators';
    case 'MANAGER':
      return 'Managers';
    default:
      return 'Employees';
  }
}
