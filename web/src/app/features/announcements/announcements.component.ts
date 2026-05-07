import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '@core/services/api.service';
import { AuthService } from '@core/services/auth.service';
import { NotificationService } from '@core/services/notification.service';
import { UiBadgeComponent } from '@shared/ui-badge/ui-badge.component';
import { UiButtonComponent } from '@shared/ui-button/ui-button.component';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import { UiEmptyStateComponent } from '@shared/ui-empty-state/ui-empty-state.component';
import { UiModalComponent } from '@shared/ui-modal/ui-modal.component';
import { HasRoleDirective } from '@shared/directives/has-role.directive';
import type { Announcement, Department, Paginated } from '@core/models';

@Component({
  selector: 'app-announcements',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    HasRoleDirective,
    UiCardComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Announcements</h1>
          <p class="mt-1 text-sm text-slate-500">
            Company news. Opening an item marks it as read.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-medium transition hover:bg-slate-50"
            [class.text-brand-700]="unreadOnly()"
            (click)="toggleUnread()"
          >
            {{ unreadOnly() ? 'Showing unread' : 'Show unread only' }}
          </button>

          <app-ui-button *appHasRole="['HR_ADMIN', 'SUPER_ADMIN']" (pressed)="composeOpen.set(true)">
            New announcement
          </app-ui-button>
        </div>
      </div>

      @if (loading()) {
        <div class="space-y-4">
          @for (placeholder of [1, 2, 3]; track placeholder) {
            <div class="rounded-xl border border-surface-border bg-white p-5 shadow-card">
              <span class="skeleton block h-4 w-64"></span>
              <span class="skeleton mt-3 block h-3 w-full"></span>
              <span class="skeleton mt-2 block h-3 w-4/5"></span>
            </div>
          }
        </div>
      } @else if (announcements().length === 0) {
        <app-ui-card>
          <app-ui-empty-state
            icon="📣"
            heading="Nothing to read"
            [message]="
              unreadOnly()
                ? 'You are all caught up — no unread announcements.'
                : 'People Operations has not published anything yet.'
            "
          />
        </app-ui-card>
      } @else {
        <div class="space-y-4">
          @for (item of announcements(); track item.id) {
            <article
              class="rounded-xl border bg-white p-5 shadow-card transition"
              [class]="item.isRead ? 'border-surface-border' : 'border-brand-200 ring-1 ring-brand-100'"
            >
              <header class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <h2 class="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
                    {{ item.title }}
                    @if (item.isPinned) {
                      <app-ui-badge tone="warning" [dot]="false" text="Pinned" />
                    }
                    @if (!item.isRead) {
                      <app-ui-badge tone="brand" [dot]="false" text="New" />
                    }
                  </h2>
                  <p class="mt-1 text-xs text-slate-500">
                    {{ item.authorName }} ·
                    {{ item.publishedAt | date: 'medium' }} ·
                    {{ audienceLabel(item) }}
                  </p>
                </div>

                <div class="flex shrink-0 items-center gap-2">
                  <span *appHasRole="['HR_ADMIN', 'SUPER_ADMIN']" class="text-xs text-slate-500">
                    {{ item.readCount }} read
                  </span>
                  @if (!item.isRead) {
                    <app-ui-button size="sm" variant="secondary" (pressed)="markRead(item)">
                      Mark as read
                    </app-ui-button>
                  }
                </div>
              </header>

              <p class="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                {{ item.body }}
              </p>
            </article>
          }
        </div>
      }
    </div>

    <app-ui-modal
      heading="New announcement"
      subheading="It is published immediately unless you save it as a draft."
      width="lg"
      [open]="composeOpen()"
      (closed)="composeOpen.set(false)"
    >
      <form [formGroup]="form" class="space-y-4">
        <div>
          <label class="form-label" for="ann-title">Title</label>
          <input id="ann-title" type="text" class="form-control" formControlName="title" />
        </div>

        <div>
          <label class="form-label" for="ann-body">Body</label>
          <textarea id="ann-body" rows="6" class="form-control" formControlName="body"></textarea>
          <p class="form-hint">Minimum 20 characters. Line breaks are preserved.</p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="form-label" for="ann-audience">Audience</label>
            <select id="ann-audience" class="form-control" formControlName="audience">
              <option value="ALL">Everyone</option>
              <option value="MANAGERS">Managers only</option>
              <option value="DEPARTMENT">A single team</option>
            </select>
          </div>

          @if (form.controls.audience.value === 'DEPARTMENT') {
            <div>
              <label class="form-label" for="ann-department">Team</label>
              <select id="ann-department" class="form-control" formControlName="departmentId">
                <option [value]="0" disabled>Select a team…</option>
                @for (department of departments(); track department.id) {
                  <option [value]="department.id">{{ department.name }}</option>
                }
              </select>
            </div>
          }
        </div>

        <div class="flex flex-wrap gap-4">
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" class="h-4 w-4 rounded" formControlName="isPinned" />
            Pin to the top of the feed
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" class="h-4 w-4 rounded" formControlName="publishNow" />
            Publish now
          </label>
        </div>
      </form>

      <div modalFooter class="flex gap-2">
        <app-ui-button variant="secondary" size="sm" (pressed)="composeOpen.set(false)">
          Cancel
        </app-ui-button>
        <app-ui-button size="sm" [loading]="publishing()" [disabled]="form.invalid" (pressed)="publish()">
          {{ form.controls.publishNow.value ? 'Publish' : 'Save draft' }}
        </app-ui-button>
      </div>
    </app-ui-modal>
  `,
})
export class AnnouncementsComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  protected readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly announcements = signal<Announcement[]>([]);
  protected readonly departments = signal<Department[]>([]);
  protected readonly loading = signal(true);
  protected readonly unreadOnly = signal(false);
  protected readonly composeOpen = signal(false);
  protected readonly publishing = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(180)]],
    body: ['', [Validators.required, Validators.minLength(20)]],
    audience: ['ALL' as 'ALL' | 'DEPARTMENT' | 'MANAGERS', [Validators.required]],
    departmentId: [0],
    isPinned: [false],
    publishNow: [true],
  });

  constructor() {
    this.load();

    if (this.auth.isHrAdmin()) {
      this.api
        .get<{ data: Department[] }>('/departments')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(({ data }) => this.departments.set(data));
    }
  }

  protected audienceLabel(item: Announcement): string {
    if (item.audience === 'DEPARTMENT') return item.departmentName ?? 'One team';
    return item.audience === 'MANAGERS' ? 'Managers' : 'Everyone';
  }

  protected toggleUnread(): void {
    this.unreadOnly.set(!this.unreadOnly());
    this.load();
  }

  protected markRead(item: Announcement): void {
    this.api
      .post<{ announcement: Announcement }>(`/announcements/${item.id}/read`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ announcement }) => {
        this.announcements.update((items) =>
          items.map((current) => (current.id === announcement.id ? announcement : current)),
        );
      });
  }

  protected publish(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    this.publishing.set(true);

    this.api
      .post<{ announcement: Announcement }>('/announcements', {
        title: raw.title,
        body: raw.body,
        audience: raw.audience,
        departmentId: raw.audience === 'DEPARTMENT' ? Number(raw.departmentId) : null,
        isPinned: raw.isPinned,
        publishNow: raw.publishNow,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.publishing.set(false);
          this.composeOpen.set(false);
          this.form.reset({ audience: 'ALL', departmentId: 0, isPinned: false, publishNow: true });
          this.notifications.success('Announcement saved');
          this.load();
        },
        error: () => this.publishing.set(false),
      });
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .get<Paginated<Announcement>>('/announcements', {
        unreadOnly: this.unreadOnly() ? 'true' : undefined,
        pageSize: 20,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.announcements.set(result.data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
