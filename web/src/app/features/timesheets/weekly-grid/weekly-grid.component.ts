import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '@core/services/api.service';
import { NotificationService } from '@core/services/notification.service';
import { UiBadgeComponent } from '@shared/ui-badge/ui-badge.component';
import { UiButtonComponent } from '@shared/ui-button/ui-button.component';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import { DurationPipe } from '@shared/pipes/duration.pipe';
import type { Project, TimesheetWeek } from '@core/models';

interface GridRow {
  projectId: number;
  projectCode: string;
  projectName: string;
  billable: boolean;
  hours: number[];
}

function isoMonday(from = new Date()): string {
  const date = new Date(from);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  date.setHours(12, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Weekly time entry grid: projects down, days across.
 *
 * The grid is held as a plain `GridRow[]` signal rather than a reactive form.
 * A 7x N matrix of numeric inputs is one of the few cases where a FormArray
 * costs more than it gives: there is no per-cell validation message, the totals
 * are derived, and the whole week is saved in one request.
 */
@Component({
  selector: 'app-weekly-grid',
  standalone: true,
  imports: [DatePipe, DurationPipe, UiCardComponent, UiButtonComponent, UiBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Timesheets</h1>
          <p class="mt-1 text-sm text-slate-500">
            Log hours against the projects you worked on, then submit the week for approval.
          </p>
        </div>

        <div class="flex items-center rounded-lg border border-surface-border bg-white">
          <button
            type="button"
            class="px-3 py-2 text-slate-500 transition hover:bg-slate-50"
            aria-label="Previous week"
            (click)="shiftWeek(-7)"
          >
            ‹
          </button>
          <span class="min-w-[13rem] px-2 text-center text-sm font-medium text-slate-800">
            {{ weekStart() | date: 'd MMM' }} – {{ weekEnd() | date: 'd MMM y' }}
          </span>
          <button
            type="button"
            class="px-3 py-2 text-slate-500 transition hover:bg-slate-50"
            aria-label="Next week"
            (click)="shiftWeek(7)"
          >
            ›
          </button>
        </div>
      </div>

      <app-ui-card [flush]="true">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border px-5 py-3">
          <div class="flex items-center gap-3">
            @if (timesheet(); as sheet) {
              <app-ui-badge [status]="sheet.status" />
              @if (sheet.approverComments) {
                <span class="text-xs text-rose-600">“{{ sheet.approverComments }}”</span>
              }
            }
          </div>
          <p class="text-sm text-slate-600">
            Week total
            <span class="ml-1.5 font-semibold text-slate-900">{{ weekTotal() | duration }}</span>
          </p>
        </div>

        @if (loading()) {
          <div class="space-y-3 p-5">
            @for (placeholder of [1, 2, 3]; track placeholder) {
              <span class="skeleton block h-10 w-full"></span>
            }
          </div>
        } @else {
          <div class="overflow-x-auto scrollbar-slim">
            <table>
              <thead class="bg-surface-muted text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" class="px-4 py-3 text-left font-semibold">Project</th>
                  @for (day of days(); track day.iso) {
                    <th scope="col" class="px-2 py-3 text-center font-semibold" [class.text-slate-400]="day.weekend">
                      <span class="block">{{ day.iso | date: 'EEE' }}</span>
                      <span class="block text-[10px] font-normal">{{ day.iso | date: 'd MMM' }}</span>
                    </th>
                  }
                  <th scope="col" class="px-4 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>

              <tbody class="divide-y divide-surface-border">
                @for (row of rows(); track row.projectId; let rowIndex = $index) {
                  <tr>
                    <td class="px-4 py-2">
                      <span class="block text-sm font-medium text-slate-800">{{ row.projectCode }}</span>
                      <span class="block text-xs text-slate-500">{{ row.projectName }}</span>
                    </td>

                    @for (day of days(); track day.iso; let dayIndex = $index) {
                      <td class="px-1.5 py-2 text-center">
                        <input
                          type="number"
                          min="0"
                          max="16"
                          step="0.25"
                          class="w-16 rounded-lg border border-surface-border px-2 py-1.5 text-center text-sm
                                 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100
                                 disabled:bg-slate-50 disabled:text-slate-400"
                          [class.bg-surface-muted]="day.weekend"
                          [disabled]="!editable()"
                          [value]="row.hours[dayIndex] || ''"
                          [attr.aria-label]="row.projectCode + ' hours on ' + day.iso"
                          (input)="setHours(rowIndex, dayIndex, $any($event.target).value)"
                        />
                      </td>
                    }

                    <td class="px-4 py-2 text-right text-sm font-medium text-slate-800">
                      {{ rowTotal(row) | duration }}
                    </td>
                  </tr>
                }

                <tr class="bg-surface-muted font-medium">
                  <td class="px-4 py-2.5 text-sm text-slate-700">Daily total</td>
                  @for (day of days(); track day.iso; let dayIndex = $index) {
                    <td
                      class="px-2 py-2.5 text-center text-sm"
                      [class]="dayTotal(dayIndex) > 12 ? 'text-rose-600' : 'text-slate-700'"
                    >
                      {{ dayTotal(dayIndex) || '—' }}
                    </td>
                  }
                  <td class="px-4 py-2.5 text-right text-sm text-slate-900">
                    {{ weekTotal() | duration }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-surface-border px-5 py-3">
            <p class="text-xs text-slate-500">
              Quarter-hour increments, 16 hours per day maximum. Drafts save without notifying anyone.
            </p>
            <div class="flex gap-2">
              <app-ui-button
                size="sm"
                variant="secondary"
                [disabled]="!editable()"
                [loading]="saving()"
                (pressed)="saveDraft()"
              >
                Save draft
              </app-ui-button>
              <app-ui-button
                size="sm"
                [disabled]="!editable() || weekTotal() === 0"
                [loading]="submitting()"
                (pressed)="submitWeek()"
              >
                Submit for approval
              </app-ui-button>
            </div>
          </div>
        }
      </app-ui-card>
    </div>
  `,
})
export class WeeklyGridComponent {
  private readonly api = inject(ApiService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly weekStart = signal(isoMonday());
  protected readonly projects = signal<Project[]>([]);
  protected readonly rows = signal<GridRow[]>([]);
  protected readonly timesheet = signal<TimesheetWeek | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly submitting = signal(false);

  protected readonly weekEnd = computed(() => addDays(this.weekStart(), 6));
  protected readonly editable = computed(() => this.timesheet()?.editable ?? true);

  protected readonly days = computed(() =>
    Array.from({ length: 7 }, (_, index) => {
      const iso = addDays(this.weekStart(), index);
      return { iso, weekend: index >= 5 };
    }),
  );

  protected readonly weekTotal = computed(() =>
    this.rows().reduce((sum, row) => sum + row.hours.reduce((a, b) => a + b, 0), 0),
  );

  constructor() {
    this.api
      .get<{ data: Project[] }>('/timesheets/projects')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ data }) => {
        this.projects.set(data);
        this.load();
      });
  }

  protected shiftWeek(days: number): void {
    this.weekStart.set(addDays(this.weekStart(), days));
    this.load();
  }

  protected rowTotal(row: GridRow): number {
    return row.hours.reduce((sum, hours) => sum + hours, 0);
  }

  protected dayTotal(dayIndex: number): number {
    return this.rows().reduce((sum, row) => sum + (row.hours[dayIndex] ?? 0), 0);
  }

  protected setHours(rowIndex: number, dayIndex: number, raw: string): void {
    const parsed = Number.parseFloat(raw);
    // Clamp and quantise on input so the payload always satisfies the API's
    // quarter-hour and 0-24 constraints.
    const hours = Number.isFinite(parsed)
      ? Math.min(16, Math.max(0, Math.round(parsed * 4) / 4))
      : 0;

    this.rows.update((rows) =>
      rows.map((row, index) =>
        index === rowIndex
          ? { ...row, hours: row.hours.map((value, day) => (day === dayIndex ? hours : value)) }
          : row,
      ),
    );
  }

  protected saveDraft(): void {
    this.saving.set(true);
    this.api
      .put<{ timesheet: TimesheetWeek }>('/timesheets/week', {
        weekStart: this.weekStart(),
        entries: this.toEntries(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ timesheet }) => {
          this.timesheet.set(timesheet);
          this.saving.set(false);
          this.notifications.success('Draft saved', `${timesheet.totalHours} hours this week.`);
        },
        error: () => this.saving.set(false),
      });
  }

  protected submitWeek(): void {
    this.submitting.set(true);

    // Save first: submitting an unsaved grid would approve stale numbers.
    this.api
      .put<{ timesheet: TimesheetWeek }>('/timesheets/week', {
        weekStart: this.weekStart(),
        entries: this.toEntries(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.api
            .post<{ timesheet: TimesheetWeek }>('/timesheets/week/submit', {
              weekStart: this.weekStart(),
            })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: ({ timesheet }) => {
                this.timesheet.set(timesheet);
                this.submitting.set(false);
                this.notifications.success(
                  'Timesheet submitted',
                  'Your manager will see it in their approval queue.',
                );
              },
              error: () => this.submitting.set(false),
            });
        },
        error: () => this.submitting.set(false),
      });
  }

  private toEntries(): Array<{ projectId: number; workDate: string; hours: number }> {
    const days = this.days();
    return this.rows().flatMap((row) =>
      row.hours
        .map((hours, index) => ({ projectId: row.projectId, workDate: days[index].iso, hours }))
        .filter((entry) => entry.hours > 0),
    );
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .get<{ timesheet: TimesheetWeek }>('/timesheets/week', { weekStart: this.weekStart() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ timesheet }) => {
          this.timesheet.set(timesheet);
          this.rows.set(this.buildRows(timesheet));
          this.loading.set(false);
        },
        error: () => {
          this.timesheet.set(null);
          this.rows.set(this.buildRows(null));
          this.loading.set(false);
        },
      });
  }

  /** Every active project gets a row, pre-filled from any saved entries. */
  private buildRows(timesheet: TimesheetWeek | null): GridRow[] {
    const days = this.days().map((day) => day.iso);

    return this.projects().map((project) => ({
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      billable: project.is_billable,
      hours: days.map(
        (iso) =>
          timesheet?.entries.find(
            (entry) => entry.projectId === project.id && entry.workDate === iso,
          )?.hours ?? 0,
      ),
    }));
  }
}
