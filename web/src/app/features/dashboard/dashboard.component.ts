import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiService } from '@core/services/api.service';
import { AuthService } from '@core/services/auth.service';
import { UiBadgeComponent } from '@shared/ui-badge/ui-badge.component';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import { UiEmptyStateComponent } from '@shared/ui-empty-state/ui-empty-state.component';
import { DurationPipe } from '@shared/pipes/duration.pipe';
import type { DashboardSummary } from '@core/models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    DecimalPipe,
    DurationPipe,
    UiCardComponent,
    UiBadgeComponent,
    UiEmptyStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Good {{ partOfDay() }}, {{ firstName() }}</h1>
          <p class="mt-1 text-sm text-slate-500">
            Here is what needs your attention today.
            @if (summary(); as data) {
              <span class="text-slate-400">· updated {{ data.generatedAt | date: 'shortTime' }}</span>
            }
          </p>
        </div>
        <a
          routerLink="/leave/new"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          Request leave
        </a>
      </div>

      <!-- KPI tiles -->
      @if (loading()) {
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          @for (placeholder of [1, 2, 3, 4]; track placeholder) {
            <div class="rounded-xl border border-surface-border bg-white p-5 shadow-card">
              <span class="skeleton block h-3 w-24"></span>
              <span class="skeleton mt-3 block h-8 w-16"></span>
              <span class="skeleton mt-3 block h-3 w-32"></span>
            </div>
          }
        </div>
      } @else {
       @if (summary(); as data) {
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          @for (kpi of data.kpis; track kpi.key) {
            <div class="rounded-xl border border-surface-border bg-white p-5 shadow-card">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {{ kpi.label }}
              </p>
              <p class="mt-2 flex items-baseline gap-1.5">
                <span class="text-3xl font-semibold tracking-tight text-slate-900">{{
                  kpi.value | number: '1.0-1'
                }}</span>
                @if (kpi.unit) {
                  <span class="text-sm text-slate-500">{{ kpi.unit }}</span>
                }
              </p>
              @if (kpi.hint) {
                <p class="mt-1.5 text-xs text-slate-500">{{ kpi.hint }}</p>
              }
            </div>
          }
        </div>

        <div class="grid gap-6 lg:grid-cols-3">
          <!-- Leave balances -->
          <app-ui-card class="lg:col-span-1" heading="Leave balances" [subheading]="balanceYear()">
            @if (data.leaveBalances.length === 0) {
              <p class="text-sm text-slate-500">No balances have been allocated yet.</p>
            } @else {
              <ul class="space-y-4">
                @for (balance of data.leaveBalances; track balance.leaveTypeId) {
                  <li>
                    <div class="flex items-center justify-between text-sm">
                      <span class="flex items-center gap-2 font-medium text-slate-700">
                        <span
                          class="h-2.5 w-2.5 rounded-full"
                          [style.background-color]="balance.colorHex"
                          aria-hidden="true"
                        ></span>
                        {{ balance.name }}
                      </span>
                      <span class="text-slate-500">
                        {{ balance.availableDays | duration: 'days' }} left
                      </span>
                    </div>
                    <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        class="h-full rounded-full transition-all"
                        [style.width.%]="usedPercent(balance.usedDays, balance.entitledDays + balance.carriedOverDays)"
                        [style.background-color]="balance.colorHex"
                      ></div>
                    </div>
                    <p class="mt-1 text-xs text-slate-400">
                      {{ balance.usedDays }} used ·
                      {{ balance.pendingDays }} pending ·
                      {{ balance.entitledDays + balance.carriedOverDays }} entitled
                    </p>
                  </li>
                }
              </ul>
            }
          </app-ui-card>

          <!-- Upcoming absences -->
          <app-ui-card
            class="lg:col-span-2"
            heading="Upcoming absences"
            subheading="Next 14 days"
            [flush]="true"
          >
            @if (data.upcomingAbsences.length === 0) {
              <app-ui-empty-state
                icon="🗓"
                heading="Nobody is away"
                message="No approved absences start in the next fortnight."
              />
            } @else {
              <ul class="divide-y divide-surface-border">
                @for (absence of data.upcomingAbsences; track absence.id) {
                  <li class="flex items-center justify-between gap-4 px-5 py-3">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium text-slate-800">
                        {{ absence.employeeName }}
                      </p>
                      <p class="text-xs text-slate-500">
                        {{ absence.leaveTypeName }} ·
                        {{ absence.startDate | date: 'mediumDate' }} →
                        {{ absence.endDate | date: 'mediumDate' }}
                      </p>
                    </div>
                    <div class="flex shrink-0 items-center gap-3">
                      <span class="text-sm text-slate-500">{{
                        absence.totalDays | duration: 'days'
                      }}</span>
                      <app-ui-badge [status]="absence.status" />
                    </div>
                  </li>
                }
              </ul>
            }
          </app-ui-card>
        </div>

        <!-- Headcount -->
        @if (data.headcountByDepartment.length > 0) {
          <app-ui-card heading="Headcount by team" subheading="Active employees">
            <ul class="space-y-3">
              @for (department of data.headcountByDepartment; track department.code) {
                <li class="flex items-center gap-3">
                  <span class="w-32 shrink-0 truncate text-sm text-slate-700">{{
                    department.name
                  }}</span>
                  <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      class="h-full rounded-full bg-brand-500"
                      [style.width.%]="headcountPercent(department.headcount)"
                    ></div>
                  </div>
                  <span class="w-8 shrink-0 text-right text-sm font-medium text-slate-700">{{
                    department.headcount
                  }}</span>
                </li>
              }
            </ul>
          </app-ui-card>
        }
       } @else {
        <app-ui-empty-state
          icon="⚠"
          heading="Dashboard unavailable"
          message="The summary could not be loaded. Try reloading the page."
        />
      }
      }
    </div>
  `,
})
export class DashboardComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly summary = signal<DashboardSummary | null>(null);
  protected readonly loading = signal(true);

  protected readonly firstName = computed(() => this.auth.user()?.firstName ?? 'there');
  protected readonly balanceYear = computed(() => {
    const balances = this.summary()?.leaveBalances ?? [];
    return balances.length ? `${balances[0].year} entitlement` : 'Current year';
  });

  private readonly maxHeadcount = computed(() =>
    Math.max(1, ...(this.summary()?.headcountByDepartment.map((row) => row.headcount) ?? [1])),
  );

  constructor() {
    // One composed request per screen — see dashboard.service.ts on the API.
    this.api
      .get<DashboardSummary>('/dashboard/summary')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.summary.set(data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected partOfDay(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }

  protected usedPercent(used: number, entitled: number): number {
    if (entitled <= 0) return 0;
    return Math.min(100, Math.round((used / entitled) * 100));
  }

  protected headcountPercent(headcount: number): number {
    return Math.round((headcount / this.maxHeadcount()) * 100);
  }
}
