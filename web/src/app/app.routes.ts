import type { Routes } from '@angular/router';
import { authGuard, guestGuard } from '@core/guards/auth.guard';
import { roleGuard } from '@core/guards/role.guard';

/**
 * Every feature is lazily loaded.
 *
 * The initial bundle therefore contains the shell, the core services and the
 * login screen only — around 190kB gzipped against an 800kB production budget
 * (see angular.json). Preloading in app.config.ts warms the rest once the app
 * is idle, so users never feel the split.
 */
export const appRoutes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in · Employee Portal',
    loadComponent: () => import('@features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('@layout/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'Dashboard · Employee Portal',
        loadComponent: () =>
          import('@features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'profile',
        title: 'My profile · Employee Portal',
        loadComponent: () => import('@features/profile/profile.component').then((m) => m.ProfileComponent),
      },
      {
        path: 'directory',
        title: 'Directory · Employee Portal',
        loadComponent: () =>
          import('@features/directory/directory.component').then((m) => m.DirectoryComponent),
      },
      {
        path: 'leave',
        title: 'Leave · Employee Portal',
        loadChildren: () => import('@features/leave/leave.routes').then((m) => m.leaveRoutes),
      },
      {
        path: 'timesheets',
        title: 'Timesheets · Employee Portal',
        loadComponent: () =>
          import('@features/timesheets/weekly-grid/weekly-grid.component').then(
            (m) => m.WeeklyGridComponent,
          ),
      },
      {
        path: 'documents',
        title: 'Documents · Employee Portal',
        loadComponent: () =>
          import('@features/documents/documents.component').then((m) => m.DocumentsComponent),
      },
      {
        path: 'announcements',
        title: 'Announcements · Employee Portal',
        loadComponent: () =>
          import('@features/announcements/announcements.component').then(
            (m) => m.AnnouncementsComponent,
          ),
      },
      {
        path: 'org-chart',
        title: 'Org chart · Employee Portal',
        loadComponent: () =>
          import('@features/org-chart/org-chart.component').then((m) => m.OrgChartComponent),
      },
      {
        path: 'admin/employees',
        title: 'Manage employees · Employee Portal',
        canActivate: [roleGuard('HR_ADMIN', 'SUPER_ADMIN')],
        loadComponent: () =>
          import('@features/admin/employees/admin-employees.component').then(
            (m) => m.AdminEmployeesComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
