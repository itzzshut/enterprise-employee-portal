import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiService } from '@core/services/api.service';
import { UiAvatarComponent } from '@shared/ui-avatar/ui-avatar.component';
import { UiBadgeComponent } from '@shared/ui-badge/ui-badge.component';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import { UiEmptyStateComponent } from '@shared/ui-empty-state/ui-empty-state.component';
import {
  UiTableComponent,
  type SortChange,
  type TableColumn,
} from '@shared/ui-table/ui-table.component';
import type { Department, Employee, PageMeta, Paginated } from '@core/models';

const COLUMNS: TableColumn[] = [
  { key: 'fullName', label: 'Employee', sortable: true },
  { key: 'jobTitle', label: 'Role', sortable: true, hideOnMobile: true },
  { key: 'departmentName', label: 'Team', hideOnMobile: true },
  { key: 'location', label: 'Location', hideOnMobile: true },
  { key: 'hireDate', label: 'Joined', sortable: true, align: 'right', width: 'w-32' },
];

/** Column key -> API sort column. The API only accepts whitelisted values. */
const SORT_MAP: Record<string, string> = {
  fullName: 'last_name',
  jobTitle: 'job_title',
  hireDate: 'hire_date',
};

@Component({
  selector: 'app-directory',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    UiCardComponent,
    UiTableComponent,
    UiAvatarComponent,
    UiBadgeComponent,
    UiEmptyStateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div>
        <h1>Directory</h1>
        <p class="mt-1 text-sm text-slate-500">
          {{ meta()?.total ?? 0 }} active colleagues. Search by name, title, email or employee code.
        </p>
      </div>

      <app-ui-card [flush]="true">
        <div class="flex flex-col gap-3 border-b border-surface-border p-4 sm:flex-row">
          <label class="sr-only" for="directory-search">Search</label>
          <input
            id="directory-search"
            type="search"
            class="form-control sm:max-w-xs"
            placeholder="Search people…"
            [value]="search()"
            (input)="onSearch($any($event.target).value)"
          />

          <label class="sr-only" for="directory-department">Team</label>
          <select
            id="directory-department"
            class="form-control sm:w-56"
            [value]="departmentId() ?? ''"
            (change)="onDepartment($any($event.target).value)"
          >
            <option value="">All teams</option>
            @for (department of departments(); track department.id) {
              <option [value]="department.id">
                {{ department.name }} ({{ department.headcount }})
              </option>
            }
          </select>
        </div>

        @if (!loading() && employees().length === 0) {
          <app-ui-empty-state
            icon="🔍"
            heading="No matches"
            message="Try a different name, or clear the team filter."
          />
        } @else {
          <app-ui-table
            [columns]="columns"
            [rows]="rows()"
            [meta]="meta()"
            [loading]="loading()"
            [sortBy]="sortBy()"
            [sortDir]="sortDir()"
            [rowTemplate]="rowTpl"
            (sortChanged)="onSort($event)"
            (pageChanged)="onPage($event)"
          />
        }
      </app-ui-card>
    </div>

    <!-- Cell rendering lives with the feature, not inside the table component. -->
    <ng-template #rowTpl let-row>
      <td class="px-4 py-3">
        <a class="flex items-center gap-3" [routerLink]="['/directory']" [queryParams]="{ q: row.fullName }">
          <app-ui-avatar size="sm" [name]="row.fullName" [src]="row.avatarUrl" />
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium text-slate-900">{{ row.fullName }}</span>
            <span class="block truncate text-xs text-slate-500">{{ row.workEmail }}</span>
          </span>
        </a>
      </td>
      <td class="hidden px-4 py-3 text-sm text-slate-700 md:table-cell">
        {{ row.jobTitle }}
        @if (row.managerName) {
          <span class="block text-xs text-slate-400">reports to {{ row.managerName }}</span>
        }
      </td>
      <td class="hidden px-4 py-3 md:table-cell">
        @if (row.departmentName) {
          <app-ui-badge tone="brand" [dot]="false" [text]="row.departmentName" />
        } @else {
          <span class="text-sm text-slate-400">—</span>
        }
      </td>
      <td class="hidden px-4 py-3 text-sm text-slate-600 md:table-cell">
        {{ row.location ?? '—' }}
      </td>
      <td class="px-4 py-3 text-right text-sm text-slate-600">
        {{ row.hireDate | date: 'MMM y' }}
      </td>
    </ng-template>
  `,
})
export class DirectoryComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Bound from `?q=` by `withComponentInputBinding()`. */
  readonly q = input<string>('');

  protected readonly columns = COLUMNS;
  protected readonly employees = signal<Employee[]>([]);
  protected readonly departments = signal<Department[]>([]);
  protected readonly meta = signal<PageMeta | null>(null);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly departmentId = signal<number | null>(null);
  protected readonly page = signal(1);
  protected readonly sortBy = signal('fullName');
  protected readonly sortDir = signal<'asc' | 'desc'>('asc');

  protected readonly rows = computed(
    () => this.employees() as unknown as Array<Record<string, unknown>>,
  );

  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.search.set(this.q());

    this.api
      .get<{ data: Department[] }>('/departments')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ data }) => this.departments.set(data));

    this.load();
  }

  /**
   * Debounced search: one request per pause in typing rather than one per
   * keystroke, which matters because the API query does a LIKE scan.
   */
  protected onSearch(value: string): void {
    this.search.set(value);
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, 300);
  }

  protected onDepartment(value: string): void {
    this.departmentId.set(value ? Number(value) : null);
    this.page.set(1);
    this.load();
  }

  protected onSort(change: SortChange): void {
    this.sortBy.set(change.sortBy);
    this.sortDir.set(change.sortDir);
    this.load();
  }

  protected onPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .get<Paginated<Employee>>('/employees', {
        q: this.search().trim() || undefined,
        departmentId: this.departmentId(),
        page: this.page(),
        pageSize: 20,
        sortBy: SORT_MAP[this.sortBy()] ?? 'last_name',
        sortDir: this.sortDir(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.employees.set(result.data);
          this.meta.set(result.meta);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
