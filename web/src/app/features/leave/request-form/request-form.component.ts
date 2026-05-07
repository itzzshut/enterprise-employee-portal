import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import {
  type AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { LeaveService } from '../leave.service';
import { NotificationService } from '@core/services/notification.service';
import { UiButtonComponent } from '@shared/ui-button/ui-button.component';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import { DurationPipe } from '@shared/pipes/duration.pipe';
import type { ApiErrorEnvelope, LeaveBalance, LeaveType } from '@core/models';

/**
 * Counts chargeable weekdays in a range — the client-side mirror of
 * `calculateLeaveDays` on the API.
 *
 * The duplication is intentional and one-directional: this exists so the form
 * can show "5 working days" and pre-empt an over-budget request before the user
 * submits. The server still recomputes it and remains the only authority.
 */
export function countWorkingDays(startDate: string, endDate: string, halfDay = false): number {
  if (!startDate || !endDate) return 0;

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  if (halfDay) return start.getTime() === end.getTime() ? 0.5 : 0;

  let days = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

/** Cross-field: the end date cannot precede the start date. */
export function dateRangeValidator(group: AbstractControl): ValidationErrors | null {
  const startDate = group.get('startDate')?.value as string;
  const endDate = group.get('endDate')?.value as string;
  if (!startDate || !endDate) return null;
  return endDate < startDate ? { dateRange: true } : null;
}

/** Cross-field: a half day is a single calendar day by definition. */
export function halfDayValidator(group: AbstractControl): ValidationErrors | null {
  const halfDay = Boolean(group.get('halfDay')?.value);
  const startDate = group.get('startDate')?.value as string;
  const endDate = group.get('endDate')?.value as string;
  if (!halfDay || !startDate || !endDate) return null;
  return startDate === endDate ? null : { halfDaySpan: true };
}

/** Cross-field: reject a range that contains no working days at all. */
export function workingDaysValidator(group: AbstractControl): ValidationErrors | null {
  const startDate = group.get('startDate')?.value as string;
  const endDate = group.get('endDate')?.value as string;
  const halfDay = Boolean(group.get('halfDay')?.value);
  if (!startDate || !endDate || endDate < startDate) return null;
  return countWorkingDays(startDate, endDate, halfDay) === 0 ? { noWorkingDays: true } : null;
}

/** Back-dating window — matches the API's 14-day allowance for late sick leave. */
export function backdateValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value as string;
  if (!value) return null;
  const earliest = new Date();
  earliest.setDate(earliest.getDate() - 14);
  earliest.setHours(0, 0, 0, 0);
  return new Date(`${value}T00:00:00`) < earliest ? { tooFarInPast: true } : null;
}

@Component({
  selector: 'app-request-form',
  standalone: true,
  imports: [ReactiveFormsModule, DatePipe, DurationPipe, UiCardComponent, UiButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl space-y-6">
      <div>
        <h1>Request leave</h1>
        <p class="mt-1 text-sm text-slate-500">
          Your manager reviews the request first, then People Operations confirms it.
        </p>
      </div>

      <form [formGroup]="form" (ngSubmit)="submit()">
        <app-ui-card heading="Request details">
          <div class="space-y-5">
            <div>
              <label class="form-label" for="leaveTypeId">Leave type</label>
              <select id="leaveTypeId" class="form-control" formControlName="leaveTypeId">
                <option [value]="0" disabled>Select a leave type…</option>
                @for (type of leaveTypes(); track type.id) {
                  <option [value]="type.id">
                    {{ type.name }}{{ type.is_paid ? '' : ' (unpaid)' }}
                  </option>
                }
              </select>
              @if (showError('leaveTypeId')) {
                <p class="form-error">Choose the type of leave you are requesting.</p>
              }
              @if (selectedBalance(); as balance) {
                <p class="form-hint">
                  {{ balance.availableDays | duration: 'days' }} available ·
                  {{ balance.pendingDays }} day(s) already awaiting approval
                </p>
              }
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div>
                <label class="form-label" for="startDate">First day away</label>
                <input
                  id="startDate"
                  type="date"
                  class="form-control"
                  [class.form-control-invalid]="showError('startDate')"
                  formControlName="startDate"
                />
                @if (form.controls.startDate.hasError('tooFarInPast')) {
                  <p class="form-error">Leave cannot start more than 14 days in the past.</p>
                }
              </div>

              <div>
                <label class="form-label" for="endDate">Last day away</label>
                <input
                  id="endDate"
                  type="date"
                  class="form-control"
                  [class.form-control-invalid]="showError('endDate') || form.hasError('dateRange')"
                  formControlName="endDate"
                />
              </div>
            </div>

            <label class="flex items-start gap-2.5">
              <input
                type="checkbox"
                class="mt-0.5 h-4 w-4 rounded border-surface-border text-brand-600"
                formControlName="halfDay"
              />
              <span class="text-sm text-slate-700">
                Half day
                <span class="block text-xs text-slate-500">
                  Charges 0.5 days. Only valid for a single date.
                </span>
              </span>
            </label>

            <div>
              <label class="form-label" for="reason">Reason</label>
              <textarea
                id="reason"
                rows="3"
                class="form-control"
                [class.form-control-invalid]="showError('reason')"
                formControlName="reason"
                placeholder="A short note for your manager — at least 10 characters."
              ></textarea>
              @if (showError('reason')) {
                <p class="form-error">
                  @if (form.controls.reason.hasError('required')) {
                    A reason is required.
                  } @else {
                    Give your manager a little more detail (10 characters minimum).
                  }
                </p>
              }
            </div>

            <!-- Cross-field feedback -->
            @if (crossFieldError(); as message) {
              <div
                class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                role="alert"
              >
                {{ message }}
              </div>
            }

            @if (requestedDays() > 0) {
              <div class="rounded-lg border border-surface-border bg-surface-muted px-4 py-3">
                <div class="flex items-center justify-between text-sm">
                  <span class="text-slate-600">This request</span>
                  <span class="font-semibold text-slate-900">{{
                    requestedDays() | duration: 'days'
                  }}</span>
                </div>
                <div class="mt-1 flex items-center justify-between text-sm">
                  <span class="text-slate-600">Balance after approval</span>
                  <span
                    class="font-semibold"
                    [class]="exceedsBalance() ? 'text-rose-600' : 'text-emerald-700'"
                  >
                    {{ remainingAfter() | duration: 'days' }}
                  </span>
                </div>
                <p class="mt-1.5 text-xs text-slate-500">
                  {{ form.controls.startDate.value | date: 'fullDate' }} →
                  {{ form.controls.endDate.value | date: 'fullDate' }}
                </p>
              </div>
            }
          </div>

          <div cardFooter class="flex items-center justify-end gap-2 px-5 py-4">
            <app-ui-button variant="secondary" (pressed)="cancel()">Cancel</app-ui-button>
            <app-ui-button
              type="submit"
              [loading]="submitting()"
              [disabled]="form.invalid || exceedsBalance()"
            >
              Submit request
            </app-ui-button>
          </div>
        </app-ui-card>
      </form>
    </div>
  `,
})
export class RequestFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly leave = inject(LeaveService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly leaveTypes = signal<LeaveType[]>([]);
  protected readonly balances = signal<LeaveBalance[]>([]);
  protected readonly submitting = signal(false);

  protected readonly form = this.fb.nonNullable.group(
    {
      leaveTypeId: [0, [Validators.required, Validators.min(1)]],
      startDate: ['', [Validators.required, backdateValidator]],
      endDate: ['', [Validators.required]],
      reason: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(500)]],
      halfDay: [false],
    },
    { validators: [dateRangeValidator, halfDayValidator, workingDaysValidator] },
  );

  /**
   * Form value as a signal, so every derived figure below is a `computed`
   * rather than a `valueChanges` subscription writing into component fields.
   */
  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly requestedDays = computed(() => {
    const current = this.value();
    return countWorkingDays(
      current?.startDate ?? '',
      current?.endDate ?? '',
      Boolean(current?.halfDay),
    );
  });

  protected readonly selectedBalance = computed<LeaveBalance | null>(() => {
    const typeId = Number(this.value()?.leaveTypeId ?? 0);
    if (!typeId) return null;
    return this.balances().find((balance) => balance.leaveTypeId === typeId) ?? null;
  });

  protected readonly remainingAfter = computed(() => {
    const balance = this.selectedBalance();
    if (!balance) return 0;
    return Number((balance.availableDays - this.requestedDays()).toFixed(1));
  });

  /**
   * The balance rule cannot be a plain `ValidatorFn`: it depends on data
   * fetched after the form is built. Keeping it as a computed signal that gates
   * the submit button avoids re-running `updateValueAndValidity` every time the
   * balances arrive.
   */
  protected readonly exceedsBalance = computed(() => {
    const balance = this.selectedBalance();
    if (!balance) return false;
    const unpaid = this.leaveTypes().find((type) => type.id === balance.leaveTypeId)?.is_paid === false;
    if (unpaid) return false;
    return this.requestedDays() > balance.availableDays;
  });

  protected readonly crossFieldError = computed(() => {
    if (this.form.hasError('dateRange')) return 'The last day away cannot be before the first day.';
    if (this.form.hasError('halfDaySpan')) return 'A half day must start and end on the same date.';
    if (this.form.hasError('noWorkingDays')) {
      return 'That range only covers weekends, so there is nothing to charge.';
    }
    if (this.exceedsBalance()) {
      const balance = this.selectedBalance();
      return `This request needs ${this.requestedDays()} day(s) but only ${balance?.availableDays} remain.`;
    }
    return null;
  });

  constructor() {
    this.leave
      .listTypes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ data }) => this.leaveTypes.set(data));

    this.leave
      .balances()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ data }) => this.balances.set(data));
  }

  protected showError(control: 'leaveTypeId' | 'startDate' | 'endDate' | 'reason'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.dirty || field.touched);
  }

  protected submit(): void {
    if (this.form.invalid || this.exceedsBalance()) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    this.submitting.set(true);

    this.leave
      .submit({
        leaveTypeId: Number(raw.leaveTypeId),
        startDate: raw.startDate,
        endDate: raw.endDate,
        reason: raw.reason,
        halfDay: raw.halfDay,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ request }) => {
          this.submitting.set(false);
          this.notifications.success(
            'Leave request submitted',
            `${request.totalDays} day(s) sent to ${request.currentApproverName ?? 'your approver'}.`,
          );
          void this.router.navigate(['/leave']);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          const envelope = (error as HttpErrorResponse)?.error as ApiErrorEnvelope | undefined;
          // 409 (overlap) and 422 (balance) are silenced by the error
          // interceptor precisely so they can be shown in context here.
          this.notifications.error(
            'Request not submitted',
            envelope?.error?.message ?? 'Please review the dates and try again.',
          );
        },
      });
  }

  protected cancel(): void {
    void this.router.navigate(['/leave']);
  }
}
