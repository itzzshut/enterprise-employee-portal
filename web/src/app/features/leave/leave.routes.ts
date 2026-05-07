import type { Routes } from '@angular/router';
import { roleGuard } from '@core/guards/role.guard';

/**
 * Child routes for the leave module, loaded as one chunk.
 *
 * Grouping the four screens together is deliberate: a user who opens "my
 * requests" almost always goes on to the request form, so splitting them
 * further would only add round trips.
 */
export const leaveRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'My leave · Employee Portal',
    loadComponent: () =>
      import('./my-requests/my-requests.component').then((m) => m.MyRequestsComponent),
  },
  {
    path: 'new',
    title: 'Request leave · Employee Portal',
    loadComponent: () =>
      import('./request-form/request-form.component').then((m) => m.RequestFormComponent),
  },
  {
    path: 'approvals',
    title: 'Leave approvals · Employee Portal',
    canActivate: [roleGuard('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN')],
    loadComponent: () => import('./approvals/approvals.component').then((m) => m.ApprovalsComponent),
  },
  {
    path: 'calendar',
    title: 'Leave calendar · Employee Portal',
    loadComponent: () =>
      import('./calendar/leave-calendar.component').then((m) => m.LeaveCalendarComponent),
  },
];
