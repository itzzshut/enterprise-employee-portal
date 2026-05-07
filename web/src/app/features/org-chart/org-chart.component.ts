import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '@core/services/api.service';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import { UiEmptyStateComponent } from '@shared/ui-empty-state/ui-empty-state.component';
import { UiSpinnerComponent } from '@shared/ui-spinner/ui-spinner.component';
import { OrgNodeComponent } from './org-node.component';
import type { OrgChartResponse } from '@core/models';

/**
 * Org chart.
 *
 * The whole subtree arrives in one response because the API builds it with a
 * MySQL recursive CTE (see api/src/modules/orgchart/orgchart.repository.ts).
 * That is what makes "focus on this person" instant — a new root is one
 * request, not a cascade of per-level fetches.
 */
@Component({
  selector: 'app-org-chart',
  standalone: true,
  imports: [OrgNodeComponent, UiCardComponent, UiSpinnerComponent, UiEmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Org chart</h1>
          <p class="mt-1 text-sm text-slate-500">
            Reporting lines, resolved server-side in a single recursive query.
          </p>
        </div>

        @if (chart(); as data) {
          <dl class="flex gap-6 text-sm">
            <div>
              <dt class="text-xs uppercase tracking-wide text-slate-500">People</dt>
              <dd class="font-semibold text-slate-900">{{ data.stats.totalActive }}</dd>
            </div>
            <div>
              <dt class="text-xs uppercase tracking-wide text-slate-500">Managers</dt>
              <dd class="font-semibold text-slate-900">{{ data.stats.managers }}</dd>
            </div>
            <div>
              <dt class="text-xs uppercase tracking-wide text-slate-500">Depth</dt>
              <dd class="font-semibold text-slate-900">{{ data.stats.maxDepth }}</dd>
            </div>
          </dl>
        }
      </div>

      @if (chart()?.breadcrumb?.length || rootId() !== null) {
        <nav class="flex flex-wrap items-center gap-1.5 text-sm" aria-label="Chart breadcrumb">
          <button
            type="button"
            class="rounded-lg px-2 py-1 font-medium text-brand-600 transition hover:bg-brand-50"
            (click)="focus(null)"
          >
            Whole company
          </button>
          @for (crumb of chart()?.breadcrumb ?? []; track crumb.id) {
            <span class="text-slate-300" aria-hidden="true">/</span>
            <button
              type="button"
              class="rounded-lg px-2 py-1 text-slate-600 transition hover:bg-slate-100"
              (click)="focus(crumb.id)"
            >
              {{ crumb.fullName }}
            </button>
          }
        </nav>
      }

      <app-ui-card>
        @if (loading()) {
          <div class="py-16">
            <app-ui-spinner size="lg" label="Building the reporting tree…" />
          </div>
        } @else {
         @if (chart(); as c) {
           @if (c.tree; as tree) {
          <div class="overflow-x-auto py-2 scrollbar-slim">
            <app-org-node [node]="tree" (focused)="focus($event)" />
          </div>
          <p class="mt-4 border-t border-surface-border pt-3 text-xs text-slate-400">
            Showing {{ c.stats.nodesReturned }} nodes, depth limit
            {{ c.stats.depthLimit }}. Branches deeper than three levels start collapsed.
          </p>
           } @else {
          <app-ui-empty-state
            icon="⑃"
            heading="No hierarchy to show"
            message="Nobody has a manager assigned yet, so there is no tree to build."
          />
           }
         } @else {
          <app-ui-empty-state
            icon="⑃"
            heading="No hierarchy to show"
            message="Nobody has a manager assigned yet, so there is no tree to build."
          />
         }
        }
      </app-ui-card>
    </div>
  `,
})
export class OrgChartComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly chart = signal<OrgChartResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly rootId = signal<number | null>(null);

  constructor() {
    this.load();
  }

  protected focus(employeeId: number | null): void {
    this.rootId.set(employeeId);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .get<OrgChartResponse>('/org-chart', { rootEmployeeId: this.rootId(), maxDepth: 8 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.chart.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.chart.set(null);
          this.loading.set(false);
        },
      });
  }
}
