import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '@core/services/api.service';
import { AuthService } from '@core/services/auth.service';
import { NotificationService } from '@core/services/notification.service';
import { UiAvatarComponent } from '@shared/ui-avatar/ui-avatar.component';
import { UiBadgeComponent } from '@shared/ui-badge/ui-badge.component';
import { UiButtonComponent } from '@shared/ui-button/ui-button.component';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import type { Employee } from '@core/models';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    UiCardComponent,
    UiButtonComponent,
    UiAvatarComponent,
    UiBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <h1>My profile</h1>

      @if (employee(); as person) {
        <div class="grid gap-6 lg:grid-cols-3">
          <!-- Identity card -->
          <app-ui-card class="lg:col-span-1">
            <div class="flex flex-col items-center text-center">
              <app-ui-avatar size="lg" [name]="person.fullName" [src]="person.avatarUrl" />
              <h2 class="mt-3 text-lg font-semibold text-slate-900">{{ person.fullName }}</h2>
              <p class="text-sm text-slate-500">{{ person.jobTitle }}</p>
              <div class="mt-2 flex flex-wrap justify-center gap-1.5">
                <app-ui-badge tone="brand" [dot]="false" [text]="person.employeeCode" />
                @if (person.role) {
                  <app-ui-badge tone="neutral" [dot]="false" [text]="person.role" />
                }
              </div>

              <label
                class="mt-4 cursor-pointer text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                {{ uploading() ? 'Uploading…' : 'Change photo' }}
                <input
                  type="file"
                  class="sr-only"
                  accept="image/png,image/jpeg,image/webp"
                  (change)="uploadAvatar($event)"
                />
              </label>
            </div>

            <dl class="mt-6 space-y-3 border-t border-surface-border pt-4 text-sm">
              <div class="flex justify-between gap-3">
                <dt class="text-slate-500">Team</dt>
                <dd class="text-right font-medium text-slate-800">
                  {{ person.departmentName ?? '—' }}
                </dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-slate-500">Manager</dt>
                <dd class="text-right font-medium text-slate-800">{{ person.managerName ?? '—' }}</dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-slate-500">Joined</dt>
                <dd class="text-right font-medium text-slate-800">
                  {{ person.hireDate | date: 'mediumDate' }}
                </dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-slate-500">Employment</dt>
                <dd class="text-right font-medium text-slate-800">
                  {{ formatEmployment(person.employmentType) }}
                </dd>
              </div>
            </dl>
          </app-ui-card>

          <div class="space-y-6 lg:col-span-2">
            <!-- Editable contact details -->
            <form [formGroup]="contactForm" (ngSubmit)="saveContact()">
              <app-ui-card
                heading="Contact details"
                subheading="Only you and People Operations can change these."
              >
                <div class="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label class="form-label" for="phone">Phone</label>
                    <input id="phone" type="tel" class="form-control" formControlName="phone" />
                  </div>
                  <div>
                    <label class="form-label" for="location">Work location</label>
                    <input id="location" type="text" class="form-control" formControlName="location" />
                  </div>
                  <div class="sm:col-span-2">
                    <label class="form-label" for="workEmail">Work email</label>
                    <input
                      id="workEmail"
                      type="email"
                      class="form-control"
                      [value]="person.workEmail"
                      disabled
                    />
                    <p class="form-hint">
                      Changing your work email is an HR action — raise it with People Operations.
                    </p>
                  </div>
                </div>

                <div cardFooter class="flex justify-end px-5 py-4">
                  <app-ui-button
                    type="submit"
                    size="sm"
                    [loading]="savingContact()"
                    [disabled]="contactForm.pristine"
                  >
                    Save changes
                  </app-ui-button>
                </div>
              </app-ui-card>
            </form>

            <!-- Password -->
            <form [formGroup]="passwordForm" (ngSubmit)="changePassword()">
              <app-ui-card
                heading="Password"
                subheading="Changing it signs you out of every other device."
              >
                <div class="grid gap-4 sm:grid-cols-2">
                  <div class="sm:col-span-2">
                    <label class="form-label" for="currentPassword">Current password</label>
                    <input
                      id="currentPassword"
                      type="password"
                      autocomplete="current-password"
                      class="form-control"
                      formControlName="currentPassword"
                    />
                  </div>
                  <div class="sm:col-span-2">
                    <label class="form-label" for="newPassword">New password</label>
                    <input
                      id="newPassword"
                      type="password"
                      autocomplete="new-password"
                      class="form-control"
                      formControlName="newPassword"
                    />
                    <p class="form-hint">
                      At least 10 characters, with an uppercase letter, a lowercase letter and a digit.
                    </p>
                    @if (
                      passwordForm.controls.newPassword.touched &&
                      passwordForm.controls.newPassword.invalid
                    ) {
                      <p class="form-error">That password does not meet the policy.</p>
                    }
                  </div>
                </div>

                <div cardFooter class="flex justify-end px-5 py-4">
                  <app-ui-button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    [loading]="savingPassword()"
                    [disabled]="passwordForm.invalid"
                  >
                    Update password
                  </app-ui-button>
                </div>
              </app-ui-card>
            </form>
          </div>
        </div>
      } @else {
        <div class="grid gap-6 lg:grid-cols-3">
          <div class="rounded-xl border border-surface-border bg-white p-6 shadow-card">
            <span class="skeleton mx-auto block h-16 w-16 rounded-full"></span>
            <span class="skeleton mx-auto mt-4 block h-4 w-32"></span>
          </div>
          <div class="rounded-xl border border-surface-border bg-white p-6 shadow-card lg:col-span-2">
            <span class="skeleton block h-4 w-40"></span>
            <span class="skeleton mt-4 block h-10 w-full"></span>
            <span class="skeleton mt-3 block h-10 w-full"></span>
          </div>
        </div>
      }
    </div>
  `,
})
export class ProfileComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly employee = signal<Employee | null>(null);
  protected readonly savingContact = signal(false);
  protected readonly savingPassword = signal(false);
  protected readonly uploading = signal(false);

  protected readonly contactForm = this.fb.nonNullable.group({
    phone: ['', [Validators.maxLength(30)]],
    location: ['', [Validators.maxLength(120)]],
  });

  protected readonly passwordForm = this.fb.nonNullable.group({
    currentPassword: ['', [Validators.required, Validators.minLength(8)]],
    newPassword: [
      '',
      [
        Validators.required,
        Validators.minLength(10),
        Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/),
      ],
    ],
  });

  constructor() {
    this.load();
  }

  protected formatEmployment(value: string): string {
    const words = value.toLowerCase().split('_');
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  protected saveContact(): void {
    if (this.contactForm.invalid) return;

    this.savingContact.set(true);
    this.api
      .patch<{ employee: Employee }>('/employees/me', this.contactForm.getRawValue())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ employee }) => {
          this.employee.set(employee);
          this.contactForm.markAsPristine();
          this.savingContact.set(false);
          this.notifications.success('Profile updated');
        },
        error: () => this.savingContact.set(false),
      });
  }

  protected changePassword(): void {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    this.savingPassword.set(true);

    this.auth
      .changePassword(currentPassword, newPassword)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ message }) => {
          this.savingPassword.set(false);
          this.passwordForm.reset();
          this.notifications.success('Password updated', message);
        },
        error: () => this.savingPassword.set(false),
      });
  }

  protected uploadAvatar(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const employeeId = this.employee()?.id;
    if (!file || !employeeId) return;

    // Matches the API's MAX_UPLOAD_MB default; checked here so an oversized
    // file is rejected before it is uploaded.
    if (file.size > 5 * 1024 * 1024) {
      this.notifications.warning('That image is too large', 'Please choose a file under 5MB.');
      input.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    this.uploading.set(true);
    this.api
      .upload<{ employee: Employee }>(`/employees/${employeeId}/avatar`, formData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ employee }) => {
          this.employee.set(employee);
          this.uploading.set(false);
          this.notifications.success('Photo updated');
        },
        error: () => this.uploading.set(false),
      });
  }

  private load(): void {
    this.api
      .get<{ employee: Employee }>('/employees/me')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ employee }) => {
        this.employee.set(employee);
        this.contactForm.patchValue({
          phone: employee.phone ?? '',
          location: employee.location ?? '',
        });
        this.contactForm.markAsPristine();
      });
  }
}
