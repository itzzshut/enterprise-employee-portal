import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '@layout/sidebar/sidebar.component';
import { TopbarComponent } from '@layout/topbar/topbar.component';

/**
 * Authenticated application frame.
 *
 * Fixed sidebar on desktop, off-canvas drawer below `lg`. The shell is itself a
 * lazily loaded route component, so none of this ships in the bundle that
 * renders the login screen.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen bg-surface-muted">
      <!-- Desktop sidebar -->
      <div class="hidden lg:block">
        <app-sidebar class="sticky top-0 block h-screen" />
      </div>

      <!-- Mobile drawer -->
      @if (drawerOpen()) {
        <div class="fixed inset-0 z-40 lg:hidden">
          <div
            class="absolute inset-0 bg-slate-900/40"
            (click)="drawerOpen.set(false)"
            aria-hidden="true"
          ></div>
          <div class="absolute inset-y-0 left-0 animate-fade-in shadow-raised">
            <app-sidebar (navigated)="drawerOpen.set(false)" />
          </div>
        </div>
      }

      <div class="flex min-w-0 flex-1 flex-col">
        <app-topbar (menuToggled)="drawerOpen.set(!drawerOpen())" />

        <main class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <router-outlet />
        </main>

        <footer class="border-t border-surface-border px-4 py-4 text-center text-xs text-slate-400 sm:px-6">
          Enterprise Employee Portal · built with Angular 18, Express and MySQL 8
        </footer>
      </div>
    </div>
  `,
})
export class ShellComponent {
  protected readonly drawerOpen = signal(false);
}
