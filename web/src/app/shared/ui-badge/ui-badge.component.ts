import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { LeaveStatus, TimesheetStatus } from '@core/models';

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'brand';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
};

/** Single source of truth for how a workflow state is coloured and worded. */
const STATUS_MAP: Record<LeaveStatus | TimesheetStatus, { tone: BadgeTone; label: string }> = {
  PENDING: { tone: 'warning', label: 'Pending manager' },
  MANAGER_APPROVED: { tone: 'info', label: 'With People Ops' },
  APPROVED: { tone: 'success', label: 'Approved' },
  REJECTED: { tone: 'danger', label: 'Rejected' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
  DRAFT: { tone: 'neutral', label: 'Draft' },
  SUBMITTED: { tone: 'info', label: 'Submitted' },
};

@Component({
  selector: 'app-ui-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset"
      [class]="toneClass()"
    >
      @if (dot()) {
        <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>
      }
      {{ label() }}
    </span>
  `,
})
export class UiBadgeComponent {
  /** Pass a workflow status to get the mapped tone and wording for free. */
  readonly status = input<LeaveStatus | TimesheetStatus | null>(null);
  readonly tone = input<BadgeTone>('neutral');
  readonly text = input<string | null>(null);
  readonly dot = input(true);

  protected readonly label = computed(() => {
    const status = this.status();
    if (status) return STATUS_MAP[status].label;
    return this.text() ?? '';
  });

  protected readonly toneClass = computed(() => {
    const status = this.status();
    return TONES[status ? STATUS_MAP[status].tone : this.tone()];
  });
}
