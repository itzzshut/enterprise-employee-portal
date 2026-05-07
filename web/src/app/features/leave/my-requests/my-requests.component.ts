import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { LeaveService } from '../leave.service';
import { NotificationService } from '@core/services/notification.service';
import { UiBadgeComponent } from '@shared/ui-badge/ui-badge.component';
import { UiButtonComponent } from '@shared/ui-button/ui-button.component';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import { UiEmptyStateComponent } from '@shared/ui-empty-state/ui-empty-state.component';
import { UiModalComponent } from '@shared/ui-modal/ui-modal.component';
import { DurationPipe } from '@shared/pipes/duration.pipe';
import type { LeaveBalance, LeaveRequest, PageMeta } from '@core/models';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'MANAGER_APPROVED', label: 'With People Ops' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const;

@Component({
  selector: 'app-my-requests',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    DurationPipe,
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
          <h1>My leave</h1>
          <p class="mt-1 text-sm text-slate-500">
            Balances, requests in flight and everything already decided.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <a
            routerLink="/leave/calendar"
            class="rounded-lg border border-surface-border bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >Calendar</a
          >
          <a
            routerLink="/leave/new"
            class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
            >Request leave</a
          >
        </div>
      </div>

      <!-- Balance strip -->
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        @if (loadingBalances()) {
          @for (placeholder of [1, 2, 3, 4]; track placeholder) {
            <div class="rounded-xl border border-surface-border bg-white p-4 shadow-card">
              <span class="skeleton block h-3 w-20"></span>
              <span class="skeleton mt-3 block h-7 w-14"></span>
            </div>
          }
        } @else {
          @for (balance of balances(); track balance.leaveTypeId) {
            <div class="rounded-xl border border-surface-border bg-white p-4 shadow-card">
              <p class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span
                  class="h-2 w-2 rounded-full"
                  [style.background-color]="balance.colorHex"
                  aria-hidden="true"
                ></span>
                {{ balance.name }}
              </p>
              <p class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                {{ balance.availableDays }}
                <span class="text-sm font-normal text-slate-500">days left</span>
              </p>
              <p class="mt-1 text-xs text-slate-400">
                {{ balance.usedDays }} used · {{ balance.pendingDays }} pending
              </p>
            </div>
          }
        }
      </div>

      <app-ui-card heading="Requests" [subheading]="summaryLine()" [flush]="true">
        <div cardActions class="flex flex-wrap gap-1">
          @for (filter of statusFilters; track filter.value) {
            <button
              type="button"
              class="rounded-lg px-2.5 py-1 text-xs font-medium transition"
              [class]="
                status() === filter.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100'
              "
              (click)="setStatus(filter.value)"
            >
              {{ filter.label }}
            </button>
          }
        </div>

        @if (loading()) {
          <div class="divide-y divide-surface-border">
            @for (placeholder of [1, 2, 3]; track placeholder) {
              <div class="px-5 py-4">
                <span class="skeleton block h-4 w-48"></span>
                <span class="skeleton mt-2 block h-3 w-72"></span>
              </div>
            }
          </div>
        } @else if (requests().length === 0) {
          <app-ui-empty-state
            icon="⛱"
            heading="No leave requests yet"
            [message]="
              status()
                ? 'Nothing matches this filter. Try another status.'
                : 'When you request time off it will appear here with its approval trail.'
            "
          >
            <a
              routerLink="/leave/new"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
              >Request leave</a
            >
          </app-ui-empty-state>
        } @else {
          <ul class="divide-y divide-surface-border">
            @for (request of requests(); track request.id) {
              <li class="flex flex-wrap items-center gap-4 px-5 py-4">
                <span
                  class="h-9 w-1 shrink-0 rounded-full"
                  [style.background-color]="request.colorHex"
                  aria-hidden="true"
                ></span>

                <div class="min-w-0 flex-1">
                  <p class="flex items-center gap-2 text-sm font-medium text-slate-900">
                    {{ request.leaveTypeName }}
                    <app-ui-badge [status]="request.status" />
                  </p>
                  <p class="mt-0.5 text-xs text-slate-500">
                    {{ request.startDate | date: 'mediumDate' }} →
                    {{ request.endDate | date: 'mediumDate' }} ·
                    {{ request.totalDays | duration: 'days' }}
                    @if (request.currentApproverName) {
                      · waiting on {{ request.currentApproverName }}
                    }
                  </p>
                  <p class="mt-1 truncate text-xs text-slate-400">{{ request.reason }}</p>
                </div>

                @if (isCancellable(request)) {
                  <app-ui-button size="sm" variant="ghost" (pressed)="promptCancel(request)">
                    Withdraw
                  </app-ui-button>
                }
              </li>
            }
          </ul>

          @if (meta(); as page) {
            @if (page.totalPages > 1) {
              <nav
                class="flex items-center justify-between border-t border-surface-border px-5 py-3 text-sm"
                aria-label="Pagination"
              >
                <button
                  type="button"
                  class="rounded-lg border border-surface-border px-3 py-1.5 text-slate-600 disabled:opacity-40"
                  [disabled]="!page.hasPrevious"
                  (click)="goToPage(page.page - 1)"
                >
                  Previous
                </button>
                <span class="text-slate-500">Page {{ page.page }} of {{ page.totalPages }}</span>
                <button
                  type="button"
                  class="rounded-lg border border-surface-border px-3 py-1.5 text-slate-600 disabled:opacity-40"
                  [disabled]="!page.hasNext"
                  (click)="goToPage(page.page + 1)"
                >
                  Next
                </button>
              </nav>
            }
          }
        }
      </app-ui-card>
    </div>

    <app-ui-modal
      heading="Withdraw this request?"
      [subheading]="cancelTarget()?.leaveTypeName ?? null"
      [open]="cancelTarget() !== null"
      width="sm"
      (closed)="cancelTarget.set(null)"
    >
      <p class="text-sm text-slate-600">
        The reserved days go straight back onto your balance. You can submit a new request
        afterwards.
      </p>

      <div modalFooter class="flex gap-2">
        <app-ui-button variant="secondary" size="sm" (pressed)="cancelTarget.set(null)">
          Keep it
        </app-ui-button>
        <app-ui-button variant="danger" size="sm" [loading]="cancelling()" (pressed)="confirmCancel()">
          Withdraw request
        </app-ui-button>
      </div>
    </app-ui-modal>
  `,
})
export class MyRequestsComponent {
  private readonly leave = inject(LeaveService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly statusFilters = STATUS_FILTERS;

  protected readonly requests = signal<LeaveRequest[]>([]);
  protected readonly balances = signal<LeaveBalance[]>([]);
  protected readonly meta = signal<PageMeta | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingBalances = signal(true);
  protected readonly status = signal<string>('');
  protected readonly page = signal(1);
  protected readonly cancelTarget = signal<LeaveRequest | null>(null);
  protected readonly cancelling = signal(false);

  protected readonly summaryLine = computed(() => {
    const total = this.meta()?.total ?? 0;
    if (total === 0) return 'Nothing to show';
    return `${total} request${total === 1 ? '' : 's'}`;
  });

  constructor() {
    this.loadBalances();
    this.load();
  }

  protected setStatus(value: string): void {
    this.status.set(value);
    this.page.set(1);
    this.load();
  }

  protected goToPage(next: number): void {
    this.page.set(next);
    this.load();
  }

  protected isCancellable(request: LeaveRequest): boolean {
    return request.status === 'PENDING' || request.status === 'MANAGER_APPROVED';
  }

  protected promptCancel(request: LeaveRequest): void {
    this.cancelTarget.set(request);
  }

  protected confirmCancel(): void {
    const target = this.cancelTarget();
    if (!target) return;

    this.cancelling.set(true);
    this.leave
      .cancel(target.id, 'Withdrawn by the requester')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.cancelling.set(false);
          this.cancelTarget.set(null);
          this.notifications.success('Request withdrawn', 'Your balance has been restored.');
          this.loadBalances();
          this.load();
        },
        error: () => {
          this.cancelling.set(false);
          this.cancelTarget.set(null);
        },
      });
  }

  private load(): void {
    this.loading.set(true);
    this.leave
      .myRequests({
        status: this.status() || undefined,
        page: this.page(),
        pageSize: 10,
        sortBy: 'start_date',
        sortDir: 'desc',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.requests.set(result.data);
          this.meta.set(result.meta);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  private loadBalances(): void {
    this.loadingBalances.set(true);
    this.leave
      .balances()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.balances.set(data);
          this.loadingBalances.set(false);
        },
        error: () => this.loadingBalances.set(false),
      });
  }
}
