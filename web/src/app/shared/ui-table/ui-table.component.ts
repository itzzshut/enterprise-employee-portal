import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type TemplateRef,
  computed,
  input,
  output,
} from '@angular/core';
import type { PageMeta } from '@core/models';

export interface TableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  /** Tailwind width utility, e.g. 'w-40'. */
  width?: string;
  hideOnMobile?: boolean;
}

export interface SortChange {
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export type TableRow = Record<string, unknown>;

/**
 * Presentational table with server-side sorting and pagination.
 *
 * It owns no data: the parent passes the current page plus its `meta`, and the
 * component emits `sortChanged` / `pageChanged` for the parent to turn into a
 * new request. Keeping it dumb means the same table renders the directory, the
 * leave list and the approvals inbox without any of them sharing state.
 *
 * Cells are rendered through an optional row template, so a feature can format
 * a status badge or an avatar without this component knowing what a leave
 * request is.
 */
@Component({
  selector: 'app-ui-table',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overflow-x-auto scrollbar-slim">
      <table>
        <thead class="bg-surface-muted text-xs uppercase tracking-wide text-slate-500">
          <tr>
            @for (column of columns(); track column.key) {
              <th
                scope="col"
                class="whitespace-nowrap px-4 py-3 font-semibold"
                [class]="headerClass(column)"
                [attr.aria-sort]="ariaSort(column)"
              >
                @if (column.sortable) {
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 transition hover:text-slate-800"
                    (click)="toggleSort(column.key)"
                  >
                    {{ column.label }}
                    <span class="text-[10px] leading-none" aria-hidden="true">
                      {{ sortIndicator(column.key) }}
                    </span>
                  </button>
                } @else {
                  {{ column.label }}
                }
              </th>
            }
          </tr>
        </thead>

        <tbody class="divide-y divide-surface-border">
          @if (loading()) {
            @for (placeholder of skeletonRows(); track placeholder) {
              <tr>
                @for (column of columns(); track column.key) {
                  <td class="px-4 py-3" [class]="headerClass(column)">
                    <span class="skeleton block h-4 w-full max-w-[160px]"></span>
                  </td>
                }
              </tr>
            }
          } @else {
            @for (row of rows(); track trackRow(row)) {
              <tr class="transition hover:bg-brand-50/40">
                @if (rowTemplate()) {
                  <ng-container
                    [ngTemplateOutlet]="rowTemplate()!"
                    [ngTemplateOutletContext]="{ $implicit: row }"
                  />
                } @else {
                  @for (column of columns(); track column.key) {
                    <td class="px-4 py-3 text-sm text-slate-700" [class]="headerClass(column)">
                      {{ display(row, column.key) }}
                    </td>
                  }
                }
              </tr>
            }
          }
        </tbody>
      </table>
    </div>

    @if (meta(); as page) {
      @if (page.total > 0) {
        <nav
          class="flex flex-col items-center justify-between gap-3 border-t border-surface-border px-4 py-3 text-sm sm:flex-row"
          aria-label="Pagination"
        >
          <p class="text-slate-500">
            Showing {{ rangeStart() }}–{{ rangeEnd() }} of {{ page.total }}
          </p>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-lg border border-surface-border px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              [disabled]="!page.hasPrevious"
              (click)="pageChanged.emit(page.page - 1)"
            >
              Previous
            </button>
            <span class="px-1 text-slate-500">Page {{ page.page }} of {{ page.totalPages }}</span>
            <button
              type="button"
              class="rounded-lg border border-surface-border px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              [disabled]="!page.hasNext"
              (click)="pageChanged.emit(page.page + 1)"
            >
              Next
            </button>
          </div>
        </nav>
      }
    }
  `,
})
export class UiTableComponent {
  readonly columns = input.required<TableColumn[]>();
  readonly rows = input<TableRow[]>([]);
  readonly meta = input<PageMeta | null>(null);
  readonly loading = input(false);
  readonly sortBy = input<string | null>(null);
  readonly sortDir = input<'asc' | 'desc'>('asc');
  readonly rowKey = input<string>('id');
  readonly rowTemplate = input<TemplateRef<{ $implicit: TableRow }> | null>(null);

  readonly sortChanged = output<SortChange>();
  readonly pageChanged = output<number>();

  protected readonly skeletonRows = computed(() => Array.from({ length: 5 }, (_, index) => index));

  protected readonly rangeStart = computed(() => {
    const page = this.meta();
    if (!page || page.total === 0) return 0;
    return (page.page - 1) * page.pageSize + 1;
  });

  protected readonly rangeEnd = computed(() => {
    const page = this.meta();
    if (!page) return 0;
    return Math.min(page.page * page.pageSize, page.total);
  });

  protected toggleSort(key: string): void {
    const nextDir = this.sortBy() === key && this.sortDir() === 'asc' ? 'desc' : 'asc';
    this.sortChanged.emit({ sortBy: key, sortDir: nextDir });
  }

  protected sortIndicator(key: string): string {
    if (this.sortBy() !== key) return '↕';
    return this.sortDir() === 'asc' ? '↑' : '↓';
  }

  protected ariaSort(column: TableColumn): string | null {
    if (!column.sortable) return null;
    if (this.sortBy() !== column.key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  protected headerClass(column: TableColumn): string {
    return [
      column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
      column.width ?? '',
      column.hideOnMobile ? 'hidden md:table-cell' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  protected trackRow(row: TableRow): unknown {
    return row[this.rowKey()] ?? row;
  }

  protected display(row: TableRow, key: string): string {
    const value = row[key];
    if (value === null || value === undefined) return '—';
    return String(value);
  }
}
