import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LeaveService } from '../leave.service';
import { AuthService } from '@core/services/auth.service';
import { NotificationService } from '@core/services/notification.service';
import { UiAvatarComponent } from '@shared/ui-avatar/ui-avatar.component';
import { UiBadgeComponent } from '@shared/ui-badge/ui-badge.component';
import { UiButtonComponent } from '@shared/ui-button/ui-button.component';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import { UiEmptyStateComponent } from '@shared/ui-empty-state/ui-empty-state.component';
import { UiModalComponent } from '@shared/ui-modal/ui-modal.component';
import { DurationPipe } from '@shared/pipes/duration.pipe';
import type { LeaveRequest } from '@core/models';

/**
 * Approvals inbox.
 *
 * The API decides what belongs here: a manager sees requests routed to them, a
 * People Ops user sees everything at the HR stage. The component never filters
 * by role itself — that would be a second, drift-prone copy of the rule.
 */
@Component({
  selector: 'app-approvals',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    DurationPipe,
    UiCardComponent,
    UiAvatarComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div>
        <h1>Leave approvals</h1>
        <p class="mt-1 text-sm text-slate-500">{{ scopeDescription() }}</p>
      </div>

      <app-ui-card [heading]="'Awaiting decision'" [subheading]="countLine()" [flush]="true">
        @if (loading()) {
          <div class="divide-y divide-surface-border">
            @for (placeholder of [1, 2, 3]; track placeholder) {
              <div class="flex items-center gap-4 px-5 py-4">
                <span class="skeleton h-10 w-10 rounded-full"></span>
                <div class="flex-1">
                  <span class="skeleton block h-4 w-40"></span>
                  <span class="skeleton mt-2 block h-3 w-64"></span>
                </div>
              </div>
            }
          </div>
        } @else if (requests().length === 0) {
          <app-ui-empty-state
            icon="✅"
            heading="Your queue is clear"
            message="Nothing is waiting on you right now. New requests appear here as soon as they are submitted."
          />
        } @else {
          <ul class="divide-y divide-surface-border">
            @for (request of requests(); track request.id) {
              <li class="px-5 py-4">
                <div class="flex flex-wrap items-start gap-4">
                  <app-ui-avatar
                    size="md"
                    [name]="request.employeeName"
                    [src]="request.avatarUrl"
                  />

                  <div class="min-w-0 flex-1">
                    <p class="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                      {{ request.employeeName }}
                      <span class="text-slate-400">·</span>
                      <span class="text-slate-600">{{ request.leaveTypeName }}</span>
                      <app-ui-badge [status]="request.status" />
                    </p>
                    <p class="mt-1 text-xs text-slate-500">
                      {{ request.startDate | date: 'mediumDate' }} →
                      {{ request.endDate | date: 'mediumDate' }} ·
                      {{ request.totalDays | duration: 'days' }} ·
                      {{ request.departmentName ?? 'No team' }} · submitted
                      {{ request.submittedAt | date: 'short' }}
                    </p>
                    <p class="mt-2 rounded-lg bg-surface-muted px-3 py-2 text-sm text-slate-700">
                      {{ request.reason }}
                    </p>
                  </div>

                  <div class="flex shrink-0 gap-2">
                    <app-ui-button
                      size="sm"
                      variant="secondary"
                      (pressed)="openDecision(request, 'REJECTED')"
                      >Reject</app-ui-button
                    >
                    <app-ui-button
                      size="sm"
                      variant="success"
                      [loading]="busyId() === request.id"
                      (pressed)="openDecision(request, 'APPROVED')"
                      >Approve</app-ui-button
                    >
                  </div>
                </div>
              </li>
            }
          </ul>
        }
      </app-ui-card>
    </div>

    <app-ui-modal
      [heading]="decision() === 'APPROVED' ? 'Approve this request?' : 'Reject this request?'"
      [subheading]="target()?.employeeName ?? null"
      [open]="target() !== null"
      (closed)="close()"
    >
      @if (target(); as request) {
        <dl class="mb-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt class="text-slate-500">Leave type</dt>
            <dd class="font-medium text-slate-800">{{ request.leaveTypeName }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">Duration</dt>
            <dd class="font-medium text-slate-800">{{ request.totalDays | duration: 'days' }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-slate-500">Dates</dt>
            <dd class="font-medium text-slate-800">
              {{ request.startDate | date: 'fullDate' }} → {{ request.endDate | date: 'fullDate' }}
            </dd>
          </div>
        </dl>

        <label class="form-label" for="comments">
          Comments {{ decision() === 'REJECTED' ? '(required)' : '(optional)' }}
        </label>
        <textarea
          id="comments"
          rows="3"
          class="form-control"
          [class.form-control-invalid]="commentError()"
          [(ngModel)]="comments"
          [placeholder]="
            decision() === 'REJECTED'
              ? 'Explain why, so the employee can resubmit sensibly.'
              : 'Anything the employee should know.'
          "
        ></textarea>
        @if (commentError()) {
          <p class="form-error">A comment is required when rejecting a request.</p>
        }
      }

      <div modalFooter class="flex gap-2">
        <app-ui-button variant="secondary" size="sm" (pressed)="close()">Cancel</app-ui-button>
        <app-ui-button
          size="sm"
          [variant]="decision() === 'APPROVED' ? 'success' : 'danger'"
          [loading]="submitting()"
          (pressed)="confirm()"
        >
          {{ decision() === 'APPROVED' ? 'Approve' : 'Reject' }}
        </app-ui-button>
      </div>
    </app-ui-modal>
  `,
})
export class ApprovalsComponent {
  private readonly leave = inject(LeaveService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly requests = signal<LeaveRequest[]>([]);
  protected readonly loading = signal(true);
  protected readonly busyId = signal<number | null>(null);
  protected readonly target = signal<LeaveRequest | null>(null);
  protected readonly decision = signal<'APPROVED' | 'REJECTED'>('APPROVED');
  protected readonly submitting = signal(false);
  protected readonly commentError = signal(false);
  protected comments = '';

  protected readonly countLine = computed(() => {
    const count = this.requests().length;
    return count === 0 ? 'Nothing pending' : `${count} request${count === 1 ? '' : 's'}`;
  });

  protected readonly scopeDescription = computed(() =>
    this.auth.isHrAdmin()
      ? 'Requests that have cleared their line manager and need People Operations to finalise them.'
      : 'Requests from your direct reports, waiting on your decision.',
  );

  constructor() {
    this.load();
  }

  protected openDecision(request: LeaveRequest, decision: 'APPROVED' | 'REJECTED'): void {
    this.comments = '';
    this.commentError.set(false);
    this.decision.set(decision);
    this.target.set(request);
  }

  protected close(): void {
    this.target.set(null);
    this.comments = '';
    this.commentError.set(false);
    this.submitting.set(false);
  }

  protected confirm(): void {
    const request = this.target();
    if (!request) return;

    // Mirrors the API's `decisionSchema`: a rejection must carry a reason.
    if (this.decision() === 'REJECTED' && this.comments.trim().length === 0) {
      this.commentError.set(true);
      return;
    }

    this.commentError.set(false);
    this.submitting.set(true);
    this.busyId.set(request.id);

    this.leave
      .decide(request.id, this.decision(), this.comments.trim() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ request: updated }) => {
          this.notifications.success(
            this.decision() === 'APPROVED' ? 'Request approved' : 'Request rejected',
            `${updated.employeeName} · ${updated.status}`,
          );
          this.close();
          this.busyId.set(null);
          this.load();
        },
        error: () => {
          this.submitting.set(false);
          this.busyId.set(null);
        },
      });
  }

  private load(): void {
    this.loading.set(true);
    this.leave
      .approvalQueue({ pageSize: 25, sortBy: 'submitted_at', sortDir: 'asc' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.requests.set(result.data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
