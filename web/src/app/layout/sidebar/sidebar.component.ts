import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import type { Role } from '@core/models';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  /** Empty means "every signed-in role". */
  roles: Role[];
  group: 'Workspace' | 'Team' | 'Administration';
}

const NAV: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: '▤', roles: [], group: 'Workspace' },
  { label: 'My profile', path: '/profile', icon: '☺', roles: [], group: 'Workspace' },
  { label: 'Leave', path: '/leave', icon: '⛱', roles: [], group: 'Workspace' },
  { label: 'Timesheets', path: '/timesheets', icon: '⏱', roles: [], group: 'Workspace' },
  { label: 'Documents', path: '/documents', icon: '🗎', roles: [], group: 'Workspace' },
  { label: 'Announcements', path: '/announcements', icon: '📣', roles: [], group: 'Workspace' },
  { label: 'Directory', path: '/directory', icon: '☰', roles: [], group: 'Team' },
  { label: 'Org chart', path: '/org-chart', icon: '⑃', roles: [], group: 'Team' },
  {
    label: 'Approvals',
    path: '/leave/approvals',
    icon: '✓',
    roles: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'],
    group: 'Team',
  },
  {
    label: 'Manage employees',
    path: '/admin/employees',
    icon: '⚙',
    roles: ['HR_ADMIN', 'SUPER_ADMIN'],
    group: 'Administration',
  },
];

/**
 * Role-gated navigation.
 *
 * The visible item list is a `computed` over the session signal, so a role
 * change (or a sign-out) re-renders the nav with no subscription and no manual
 * change detection.
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside
      class="flex h-full w-64 flex-col border-r border-surface-border bg-white"
      aria-label="Primary navigation"
    >
      <div class="flex h-16 shrink-0 items-center gap-2.5 border-b border-surface-border px-5">
        <span
          class="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white"
          aria-hidden="true"
          >EP</span
        >
        <div class="leading-tight">
          <p class="text-sm font-semibold text-slate-900">Employee Portal</p>
          <p class="text-[11px] uppercase tracking-wide text-slate-400">HR self-service</p>
        </div>
      </div>

      <nav class="flex-1 overflow-y-auto px-3 py-4 scrollbar-slim">
        @for (group of groups(); track group.name) {
          <div class="mb-5">
            <p class="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {{ group.name }}
            </p>
            <ul class="space-y-0.5">
              @for (item of group.items; track item.path) {
                <li>
                  <a
                    class="nav-link"
                    routerLinkActive="nav-link-active"
                    [routerLink]="item.path"
                    [routerLinkActiveOptions]="{ exact: item.path === '/leave' }"
                    (click)="navigated.emit()"
                  >
                    <span class="w-4 text-center text-base leading-none" aria-hidden="true">{{
                      item.icon
                    }}</span>
                    {{ item.label }}
                  </a>
                </li>
              }
            </ul>
          </div>
        }
      </nav>

      <div class="shrink-0 border-t border-surface-border px-5 py-3">
        <p class="text-[11px] text-slate-400">
          v{{ version() }} · signed in as {{ auth.role() }}
        </p>
      </div>
    </aside>
  `,
})
export class SidebarComponent {
  protected readonly auth = inject(AuthService);

  readonly version = input('1.4.0');
  /** Lets the shell close the mobile drawer after a navigation. */
  readonly navigated = output<void>();

  protected readonly visibleItems = computed(() =>
    NAV.filter((item) => item.roles.length === 0 || this.auth.hasRole(...item.roles)),
  );

  protected readonly groups = computed(() => {
    const order: NavItem['group'][] = ['Workspace', 'Team', 'Administration'];
    return order
      .map((name) => ({ name, items: this.visibleItems().filter((item) => item.group === name) }))
      .filter((group) => group.items.length > 0);
  });
}
