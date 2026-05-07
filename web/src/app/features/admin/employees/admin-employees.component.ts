import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '@core/services/api.service';
import { NotificationService } from '@core/services/notification.service';
import { UiAvatarComponent } from '@shared/ui-avatar/ui-avatar.component';
import { UiBadgeComponent } from '@shared/ui-badge/ui-badge.component';
import { UiButtonComponent } from '@shared/ui-button/ui-button.component';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import { UiModalComponent } from '@shared/ui-modal/ui-modal.component';
import type { Department, Employee, PageMeta, Paginated } from '@core/models';

/**
 * People Operations screen: create employee records, provision logins and move
 * people between managers. Every action here is also gated server-side —
 * `roleGuard` only decides whether the route renders.
 */
@Component({
  selector: 'app-admin-employees',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    UiCardComponent,
    UiAvatarComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Manage employees</h1>
          <p class="mt-1 text-sm text-slate-500">
            {{ meta()?.total ?? 0 }} records, including anyone on leave or offboarded.
          </p>
        </div>
        <app-ui-button (pressed)="openCreate()">Add employee</app-ui-button>
      </div>

      <app-ui-card [flush]="true">
        <div class="flex flex-wrap gap-3 border-b border-surface-border p-4">
          <input
            type="search"
            class="form-control sm:max-w-xs"
            placeholder="Search records…"
            [value]="search()"
            (input)="onSearch($any($event.target).value)"
            aria-label="Search employee records"
          />
          <select
            class="form-control sm:w-48"
            [value]="status()"
            (change)="setStatus($any($event.target).value)"
            aria-label="Filter by status"
          >
            <option value="ACTIVE">Active</option>
            <option value="ON_LEAVE">On leave</option>
            <option value="TERMINATED">Offboarded</option>
          </select>
        </div>

        <div class="overflow-x-auto scrollbar-slim">
          <table>
            <thead class="bg-surface-muted text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" class="px-4 py-3 text-left font-semibold">Employee</th>
                <th scope="col" class="px-4 py-3 text-left font-semibold">Role</th>
                <th scope="col" class="hidden px-4 py-3 text-left font-semibold md:table-cell">Team</th>
                <th scope="col" class="hidden px-4 py-3 text-left font-semibold md:table-cell">
                  Manager
                </th>
                <th scope="col" class="px-4 py-3 text-left font-semibold">Status</th>
                <th scope="col" class="px-4 py-3 text-right font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-surface-border">
              @if (loading()) {
                @for (placeholder of [1, 2, 3, 4, 5]; track placeholder) {
                  <tr>
                    @for (cell of [1, 2, 3, 4, 5, 6]; track cell) {
                      <td class="px-4 py-3"><span class="skeleton block h-4 w-full"></span></td>
                    }
                  </tr>
                }
              } @else {
                @for (employee of employees(); track employee.id) {
                  <tr class="transition hover:bg-brand-50/40">
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-3">
                        <app-ui-avatar size="sm" [name]="employee.fullName" [src]="employee.avatarUrl" />
                        <div class="min-w-0">
                          <p class="truncate text-sm font-medium text-slate-900">
                            {{ employee.fullName }}
                          </p>
                          <p class="truncate text-xs text-slate-500">{{ employee.employeeCode }}</p>
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <p class="text-sm text-slate-700">{{ employee.jobTitle }}</p>
                      @if (employee.role) {
                        <p class="text-xs text-slate-400">{{ employee.role }}</p>
                      }
                    </td>
                    <td class="hidden px-4 py-3 text-sm text-slate-600 md:table-cell">
                      {{ employee.departmentName ?? '—' }}
                    </td>
                    <td class="hidden px-4 py-3 text-sm text-slate-600 md:table-cell">
                      {{ employee.managerName ?? '—' }}
                    </td>
                    <td class="px-4 py-3">
                      <app-ui-badge
                        [dot]="true"
                        [tone]="
                          employee.status === 'ACTIVE'
                            ? 'success'
                            : employee.status === 'ON_LEAVE'
                              ? 'warning'
                              : 'neutral'
                        "
                        [text]="employee.status.replace('_', ' ')"
                      />
                    </td>
                    <td class="px-4 py-3 text-right text-sm text-slate-600">
                      {{ employee.hireDate | date: 'mediumDate' }}
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        @if (meta(); as page) {
          @if (page.totalPages > 1) {
            <nav
              class="flex items-center justify-between border-t border-surface-border px-4 py-3 text-sm"
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
      </app-ui-card>
    </div>

    <app-ui-modal
      heading="Add an employee"
      subheading="Creates the HR record, and optionally a login."
      width="lg"
      [open]="createOpen()"
      (closed)="createOpen.set(false)"
    >
      <form [formGroup]="form" class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="form-label" for="employeeCode">Employee code</label>
            <input id="employeeCode" type="text" class="form-control" formControlName="employeeCode" />
            <p class="form-hint">Format: EMP-1234</p>
          </div>
          <div>
            <label class="form-label" for="hireDate">Start date</label>
            <input id="hireDate" type="date" class="form-control" formControlName="hireDate" />
          </div>
          <div>
            <label class="form-label" for="firstName">First name</label>
            <input id="firstName" type="text" class="form-control" formControlName="firstName" />
          </div>
          <div>
            <label class="form-label" for="lastName">Last name</label>
            <input id="lastName" type="text" class="form-control" formControlName="lastName" />
          </div>
          <div class="sm:col-span-2">
            <label class="form-label" for="workEmail">Work email</label>
            <input id="workEmail" type="email" class="form-control" formControlName="workEmail" />
          </div>
          <div class="sm:col-span-2">
            <label class="form-label" for="jobTitle">Job title</label>
            <input id="jobTitle" type="text" class="form-control" formControlName="jobTitle" />
          </div>
          <div>
            <label class="form-label" for="departmentId">Team</label>
            <select id="departmentId" class="form-control" formControlName="departmentId">
              <option [value]="0">Unassigned</option>
              @for (department of departments(); track department.id) {
                <option [value]="department.id">{{ department.name }}</option>
              }
            </select>
          </div>
          <div>
            <label class="form-label" for="managerId">Reports to</label>
            <select id="managerId" class="form-control" formControlName="managerId">
              <option [value]="0">No manager</option>
              @for (manager of managerOptions(); track manager.id) {
                <option [value]="manager.id">{{ manager.fullName }} — {{ manager.jobTitle }}</option>
              }
            </select>
          </div>
        </div>

        <div class="rounded-lg border border-surface-border bg-surface-muted p-4">
          <label class="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" class="h-4 w-4 rounded" formControlName="createLogin" />
            Provision a portal login
          </label>

          @if (form.controls.createLogin.value) {
            <div class="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label class="form-label" for="role">Role</label>
                <select id="role" class="form-control" formControlName="role">
                  <option value="EMPLOYEE">Employee</option>
                  <option value="MANAGER">Manager</option>
                  <option value="HR_ADMIN">People Operations</option>
                </select>
              </div>
              <div>
                <label class="form-label" for="temporaryPassword">Temporary password</label>
                <input
                  id="temporaryPassword"
                  type="text"
                  class="form-control"
                  formControlName="temporaryPassword"
                />
                <p class="form-hint">They will be asked to change it at first sign-in.</p>
              </div>
            </div>
          }
        </div>
      </form>

      <div modalFooter class="flex gap-2">
        <app-ui-button variant="secondary" size="sm" (pressed)="createOpen.set(false)">
          Cancel
        </app-ui-button>
        <app-ui-button size="sm" [loading]="creating()" [disabled]="form.invalid" (pressed)="create()">
          Create record
        </app-ui-button>
      </div>
    </app-ui-modal>
  `,
})
export class AdminEmployeesComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly employees = signal<Employee[]>([]);
  protected readonly departments = signal<Department[]>([]);
  protected readonly meta = signal<PageMeta | null>(null);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly status = signal('ACTIVE');
  protected readonly page = signal(1);
  protected readonly createOpen = signal(false);
  protected readonly creating = signal(false);

  /** Anyone active can be a manager — the API rejects cycles. */
  protected readonly managerOptions = computed(() =>
    this.employees().filter((employee) => employee.status === 'ACTIVE'),
  );

  protected readonly form = this.fb.nonNullable.group({
    employeeCode: ['', [Validators.required, Validators.pattern(/^EMP-\d{4,6}$/)]],
    firstName: ['', [Validators.required, Validators.maxLength(80)]],
    lastName: ['', [Validators.required, Validators.maxLength(80)]],
    workEmail: ['', [Validators.required, Validators.email]],
    jobTitle: ['', [Validators.required, Validators.minLength(2)]],
    departmentId: [0],
    managerId: [0],
    hireDate: ['', [Validators.required]],
    createLogin: [true],
    role: ['EMPLOYEE'],
    temporaryPassword: ['', [Validators.minLength(10)]],
  });

  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.api
      .get<{ data: Department[] }>('/departments')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ data }) => this.departments.set(data));

    this.load();
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.page.set(1);
      this.load();
    }, 300);
  }

  protected setStatus(value: string): void {
    this.status.set(value);
    this.page.set(1);
    this.load();
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected openCreate(): void {
    this.form.reset({
      departmentId: 0,
      managerId: 0,
      createLogin: true,
      role: 'EMPLOYEE',
      employeeCode: this.suggestCode(),
    });
    this.createOpen.set(true);
  }

  protected create(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    this.creating.set(true);

    this.api
      .post<{ employee: Employee }>('/employees', {
        employeeCode: raw.employeeCode,
        firstName: raw.firstName,
        lastName: raw.lastName,
        workEmail: raw.workEmail,
        jobTitle: raw.jobTitle,
        departmentId: Number(raw.departmentId) || null,
        managerId: Number(raw.managerId) || null,
        hireDate: raw.hireDate,
        employmentType: 'FULL_TIME',
        createLogin: raw.createLogin,
        role: raw.role,
        temporaryPassword: raw.createLogin ? raw.temporaryPassword : undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ employee }) => {
          this.creating.set(false);
          this.createOpen.set(false);
          this.notifications.success('Employee created', `${employee.fullName} (${employee.employeeCode})`);
          this.load();
        },
        error: () => this.creating.set(false),
      });
  }

  /** Next code after the highest existing one, so HR rarely has to think. */
  private suggestCode(): string {
    const numbers = this.employees()
      .map((employee) => Number.parseInt(employee.employeeCode.replace('EMP-', ''), 10))
      .filter((value) => Number.isFinite(value));
    const next = (numbers.length ? Math.max(...numbers) : 1000) + 1;
    return `EMP-${next}`;
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .get<Paginated<Employee>>('/employees', {
        q: this.search().trim() || undefined,
        status: this.status(),
        page: this.page(),
        pageSize: 20,
        sortBy: 'employee_code',
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
