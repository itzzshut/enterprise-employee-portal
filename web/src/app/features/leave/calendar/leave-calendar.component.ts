import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LeaveService } from '../leave.service';
import { AuthService } from '@core/services/auth.service';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import { UiEmptyStateComponent } from '@shared/ui-empty-state/ui-empty-state.component';
import type { CalendarEntry } from '@core/models';

interface CalendarCell {
  date: Date;
  iso: string;
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  entries: CalendarEntry[];
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Month grid built from the API's range response.
 *
 * The server returns one row per absence (not per day), so the component
 * expands each range across the cells it covers. Doing it here keeps the
 * payload small — a two-week absence is one row, not fourteen.
 */
@Component({
  selector: 'app-leave-calendar',
  standalone: true,
  imports: [DatePipe, UiCardComponent, UiEmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Leave calendar</h1>
          <p class="mt-1 text-sm text-slate-500">Who is away, and when.</p>
        </div>

        <div class="flex items-center gap-2">
          <select
            class="form-control w-auto"
            [value]="scope()"
            (change)="setScope($any($event.target).value)"
            aria-label="Calendar scope"
          >
            <option value="ME">Just me</option>
            <option value="TEAM">My team</option>
            @if (auth.isHrAdmin()) {
              <option value="COMPANY">Whole company</option>
            }
          </select>

          <div class="flex items-center rounded-lg border border-surface-border bg-white">
            <button
              type="button"
              class="px-3 py-2 text-slate-500 transition hover:bg-slate-50"
              aria-label="Previous month"
              (click)="shiftMonth(-1)"
            >
              ‹
            </button>
            <span class="min-w-[9rem] px-2 text-center text-sm font-medium text-slate-800">
              {{ monthStart() | date: 'MMMM y' }}
            </span>
            <button
              type="button"
              class="px-3 py-2 text-slate-500 transition hover:bg-slate-50"
              aria-label="Next month"
              (click)="shiftMonth(1)"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <app-ui-card [flush]="true">
        @if (loading()) {
          <div class="grid grid-cols-7 gap-px bg-surface-border p-px">
            @for (placeholder of skeletonCells(); track placeholder) {
              <div class="h-24 bg-white p-2"><span class="skeleton block h-3 w-6"></span></div>
            }
          </div>
        } @else {
          <div class="grid grid-cols-7 border-b border-surface-border bg-surface-muted">
            @for (label of weekdayLabels; track label) {
              <div class="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {{ label }}
              </div>
            }
          </div>

          <div class="grid grid-cols-7 gap-px bg-surface-border p-px">
            @for (cell of cells(); track cell.iso) {
              <div
                class="min-h-[6rem] bg-white p-2"
                [class.bg-surface-muted]="!cell.inMonth || cell.isWeekend"
                [class.ring-2]="cell.isToday"
                [class.ring-inset]="cell.isToday"
                [class.ring-brand-400]="cell.isToday"
              >
                <p
                  class="mb-1 text-xs font-medium"
                  [class]="cell.inMonth ? 'text-slate-600' : 'text-slate-300'"
                >
                  {{ cell.date | date: 'd' }}
                </p>

                <ul class="space-y-1">
                  @for (entry of cell.entries.slice(0, 3); track entry.id) {
                    <li
                      class="truncate rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
                      [style.background-color]="entry.colorHex"
                      [style.opacity]="entry.status === 'APPROVED' ? 1 : 0.65"
                      [title]="entry.employeeName + ' · ' + entry.leaveTypeName + ' · ' + entry.status"
                    >
                      {{ entry.employeeName }}
                    </li>
                  }
                  @if (cell.entries.length > 3) {
                    <li class="px-1.5 text-[11px] text-slate-500">
                      +{{ cell.entries.length - 3 }} more
                    </li>
                  }
                </ul>
              </div>
            }
          </div>

          @if (entries().length === 0) {
            <app-ui-empty-state
              icon="🗓"
              heading="No absences this month"
              message="Nothing is booked in the selected scope for this month."
            />
          }
        }
      </app-ui-card>

      <div class="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span class="font-medium text-slate-600">Legend:</span>
        <span class="flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-full bg-slate-400" aria-hidden="true"></span>
          Faded = awaiting approval
        </span>
        <span class="flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-full bg-brand-500" aria-hidden="true"></span>
          Solid = approved
        </span>
      </div>
    </div>
  `,
})
export class LeaveCalendarComponent {
  private readonly leave = inject(LeaveService);
  protected readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  protected readonly skeletonCells = computed(() => Array.from({ length: 35 }, (_, i) => i));

  protected readonly monthStart = signal(startOfMonth(new Date()));
  protected readonly scope = signal<'ME' | 'TEAM' | 'COMPANY'>('TEAM');
  protected readonly entries = signal<CalendarEntry[]>([]);
  protected readonly loading = signal(true);

  /** Six weeks of cells, Monday-first, with absences expanded per day. */
  protected readonly cells = computed<CalendarCell[]>(() => {
    const month = this.monthStart();
    const gridStart = new Date(month);
    // getDay(): 0=Sun. Shift so Monday is the first column.
    const offset = (month.getDay() + 6) % 7;
    gridStart.setDate(gridStart.getDate() - offset);

    const todayIso = toIso(new Date());
    const byDay = new Map<string, CalendarEntry[]>();

    for (const entry of this.entries()) {
      const cursor = new Date(`${entry.startDate}T00:00:00`);
      const end = new Date(`${entry.endDate}T00:00:00`);
      while (cursor <= end) {
        const iso = toIso(cursor);
        byDay.set(iso, [...(byDay.get(iso) ?? []), entry]);
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(date.getDate() + index);
      const iso = toIso(date);
      const weekday = date.getDay();

      return {
        date,
        iso,
        inMonth: date.getMonth() === month.getMonth(),
        isToday: iso === todayIso,
        isWeekend: weekday === 0 || weekday === 6,
        entries: byDay.get(iso) ?? [],
      };
    });
  });

  constructor() {
    this.load();
  }

  protected shiftMonth(delta: number): void {
    const next = new Date(this.monthStart());
    next.setMonth(next.getMonth() + delta);
    this.monthStart.set(startOfMonth(next));
    this.load();
  }

  protected setScope(scope: 'ME' | 'TEAM' | 'COMPANY'): void {
    this.scope.set(scope);
    this.load();
  }

  private load(): void {
    this.loading.set(true);

    // Fetch the visible grid, not just the month, so absences that spill over
    // the edges still render in the leading and trailing cells.
    const from = new Date(this.monthStart());
    from.setDate(from.getDate() - 7);
    const to = new Date(this.monthStart());
    to.setMonth(to.getMonth() + 1);
    to.setDate(to.getDate() + 7);

    this.leave
      .calendar(toIso(from), toIso(to), this.scope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data }) => {
          this.entries.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.entries.set([]);
          this.loading.set(false);
        },
      });
  }
}

function startOfMonth(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), 1);
  result.setHours(12, 0, 0, 0); // midday avoids DST edge cases in toISOString
  return result;
}
