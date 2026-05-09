import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '@core/services/auth.service';
import { ApiService } from '@core/services/api.service';
import { UiAvatarComponent } from '@shared/ui-avatar/ui-avatar.component';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [RouterLink, UiAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header
      class="flex h-16 items-center justify-between gap-4 border-b border-surface-border bg-white px-4 sm:px-6"
    >
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 lg:hidden"
          aria-label="Toggle navigation"
          (click)="menuToggled.emit()"
        >
          ☰
        </button>

        <form class="hidden sm:block" (submit)="search($event)">
          <label class="sr-only" for="global-search">Search the directory</label>
          <input
            id="global-search"
            name="q"
            type="search"
            class="form-control w-64 lg:w-80"
            placeholder="Search people, titles, teams…"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
        </form>
      </div>

      <div class="flex items-center gap-2 sm:gap-3">
        <a
          routerLink="/announcements"
          class="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"
          aria-label="Announcements"
        >
          📣
          @if (unread() > 0) {
            <span
              class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white"
              >{{ unread() > 9 ? '9+' : unread() }}</span
            >
          }
        </a>

        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-slate-100"
            [attr.aria-expanded]="menuOpen()"
            aria-haspopup="menu"
            (click)="menuOpen.set(!menuOpen())"
          >
            <app-ui-avatar
              size="sm"
              [name]="auth.displayName()"
              [src]="auth.user()?.avatarUrl ?? null"
            />
            <span class="hidden text-left leading-tight sm:block">
              <span class="block text-sm font-medium text-slate-900">{{ auth.displayName() }}</span>
              <span class="block text-[11px] text-slate-500">{{ auth.user()?.jobTitle }}</span>
            </span>
            <span class="text-[10px] text-slate-400" aria-hidden="true">▾</span>
          </button>

          @if (menuOpen()) {
            <div
              class="absolute right-0 top-full z-40 mt-1 w-56 animate-fade-in rounded-xl border border-surface-border bg-white py-1.5 shadow-raised"
              role="menu"
            >
              <div class="border-b border-surface-border px-4 py-2">
                <p class="truncate text-sm font-medium text-slate-900">{{ auth.user()?.email }}</p>
                <p class="text-xs text-slate-500">{{ auth.user()?.departmentName ?? 'No team' }}</p>
              </div>
              <a
                routerLink="/profile"
                role="menuitem"
                class="block px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                (click)="menuOpen.set(false)"
                >My profile</a
              >
              <a
                routerLink="/leave"
                role="menuitem"
                class="block px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                (click)="menuOpen.set(false)"
                >My leave</a
              >
              <button
                type="button"
                role="menuitem"
                class="block w-full px-4 py-2 text-left text-sm text-rose-600 transition hover:bg-rose-50"
                (click)="signOut()"
              >
                Sign out
              </button>
            </div>
          }
        </div>
      </div>
    </header>
  `,
})
export class TopbarComponent {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly menuToggled = output<void>();

  protected readonly query = signal('');
  protected readonly menuOpen = signal(false);
  protected readonly unread = signal(0);

  constructor() {
    // Unread count is fetched once per shell mount; `takeUntilDestroyed` means
    // a fast sign-out cannot leave the response writing into a dead component.
    this.api
      .get<{ unread: number }>('/announcements/unread-count')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ unread }) => this.unread.set(unread),
        error: () => this.unread.set(0),
      });
  }

  protected search(event: Event): void {
    event.preventDefault();
    const term = this.query().trim();
    void this.router.navigate(['/directory'], {
      queryParams: term ? { q: term } : {},
    });
  }

  protected signOut(): void {
    this.menuOpen.set(false);
    this.auth.logout();
  }
}
