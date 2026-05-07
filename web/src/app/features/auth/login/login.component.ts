import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '@core/services/auth.service';
import { NotificationService } from '@core/services/notification.service';
import { UiButtonComponent } from '@shared/ui-button/ui-button.component';
import type { ApiErrorEnvelope } from '@core/models';

interface DemoAccount {
  label: string;
  email: string;
  password: string;
  description: string;
}

/** Seeded credentials, surfaced so a reviewer can explore every role quickly. */
const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    label: 'Employee',
    email: 'employee@portal.dev',
    password: 'Employee@12345',
    description: 'Own leave, timesheets and documents',
  },
  {
    label: 'Manager',
    email: 'manager@portal.dev',
    password: 'Manager@12345',
    description: 'Approvals for direct reports',
  },
  {
    label: 'People Ops',
    email: 'hr@portal.dev',
    password: 'HrAdmin@12345',
    description: 'Company-wide HR administration',
  },
];

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, UiButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen">
      <!-- Brand panel -->
      <div class="hidden w-1/2 flex-col justify-between bg-brand-800 p-12 text-white lg:flex">
        <div class="flex items-center gap-3">
          <span
            class="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-sm font-bold"
            aria-hidden="true"
            >EP</span
          >
          <span class="text-sm font-semibold tracking-wide">Enterprise Employee Portal</span>
        </div>

        <div class="max-w-md">
          <h1 class="text-3xl font-semibold leading-tight text-white">
            HR self-service, without the email threads.
          </h1>
          <p class="mt-4 text-brand-100">
            Leave balances, a two-stage approval workflow, weekly timesheets, documents and the
            company org chart — in one place, with an audit trail behind every decision.
          </p>
          <ul class="mt-8 space-y-2 text-sm text-brand-100">
            <li>• Role-based access for employees, managers and People Operations</li>
            <li>• Overlap and balance validation before a request is ever submitted</li>
            <li>• Every approval recorded against the request it belongs to</li>
          </ul>
        </div>

        <p class="text-xs text-brand-200">Angular 18 · Express · MySQL 8 · Jenkins CI/CD</p>
      </div>

      <!-- Form panel -->
      <div class="flex w-full items-center justify-center px-5 py-10 lg:w-1/2">
        <div class="w-full max-w-sm">
          <h2 class="text-xl font-semibold text-slate-900">Sign in</h2>
          <p class="mt-1 text-sm text-slate-500">Use your work email address to continue.</p>

          <form class="mt-7 space-y-4" [formGroup]="form" (ngSubmit)="submit()">
            <div>
              <label class="form-label" for="email">Work email</label>
              <input
                id="email"
                type="email"
                autocomplete="username"
                class="form-control"
                [class.form-control-invalid]="invalid('email')"
                formControlName="email"
              />
              @if (invalid('email')) {
                <p class="form-error">
                  @if (form.controls.email.hasError('required')) {
                    Enter your work email address.
                  } @else {
                    That does not look like a valid email address.
                  }
                </p>
              }
            </div>

            <div>
              <label class="form-label" for="password">Password</label>
              <div class="relative">
                <input
                  id="password"
                  [type]="showPassword() ? 'text' : 'password'"
                  autocomplete="current-password"
                  class="form-control pr-16"
                  [class.form-control-invalid]="invalid('password')"
                  formControlName="password"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-700"
                  (click)="showPassword.set(!showPassword())"
                >
                  {{ showPassword() ? 'Hide' : 'Show' }}
                </button>
              </div>
              @if (invalid('password')) {
                <p class="form-error">Passwords are at least 8 characters.</p>
              }
            </div>

            @if (errorMessage()) {
              <div
                class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                role="alert"
              >
                {{ errorMessage() }}
              </div>
            }

            <app-ui-button type="submit" [block]="true" [loading]="submitting()">
              Sign in
            </app-ui-button>
          </form>

          <div class="mt-8 rounded-xl border border-surface-border bg-surface-muted p-4">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Demo accounts
            </p>
            <ul class="mt-2.5 space-y-1.5">
              @for (account of demoAccounts; track account.email) {
                <li>
                  <button
                    type="button"
                    class="w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-white"
                    (click)="useDemoAccount(account)"
                  >
                    <span class="text-sm font-medium text-slate-800">{{ account.label }}</span>
                    <span class="ml-2 text-xs text-slate-500">{{ account.description }}</span>
                  </button>
                </li>
              }
            </ul>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  protected readonly demoAccounts = DEMO_ACCOUNTS;
  protected readonly submitting = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /** Typed, non-nullable form group — `form.value.email` is `string`. */
  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected invalid(control: 'email' | 'password'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.dirty || field.touched);
  }

  protected useDemoAccount(account: DemoAccount): void {
    this.form.setValue({ email: account.email, password: account.password });
    this.errorMessage.set(null);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    const { email, password } = this.form.getRawValue();

    this.auth.login(email, password).subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.notifications.success(`Welcome back, ${result.user.firstName ?? 'there'}`);

        // Honour ?returnUrl= so a deep link survives the sign-in detour.
        const returnUrl = new URLSearchParams(window.location.search).get('returnUrl');
        void this.router.navigateByUrl(returnUrl ?? '/dashboard');
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        const envelope = (error as HttpErrorResponse)?.error as ApiErrorEnvelope | undefined;
        this.errorMessage.set(
          envelope?.error?.message ?? 'Sign-in failed. Please check your details and try again.',
        );
      },
    });
  }
}
