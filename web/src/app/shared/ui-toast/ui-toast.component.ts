import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NotificationService, type ToastKind } from '@core/services/notification.service';

const TONES: Record<ToastKind, { container: string; icon: string }> = {
  success: { container: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: '✓' },
  error: { container: 'border-rose-200 bg-rose-50 text-rose-900', icon: '!' },
  warning: { container: 'border-amber-200 bg-amber-50 text-amber-900', icon: '△' },
  info: { container: 'border-sky-200 bg-sky-50 text-sky-900', icon: 'i' },
};

/**
 * Global toast host, mounted once by the root component.
 *
 * It reads the notification signal directly, so no component ever has to wire
 * up a subscription to show feedback.
 */
@Component({
  selector: 'app-ui-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
      aria-live="polite"
      aria-atomic="false"
    >
      @for (toast of notifications.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-3 rounded-xl border px-4 py-3 shadow-raised"
          [class]="tone(toast.kind).container"
          role="alert"
        >
          <span
            class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/70 text-xs font-bold"
            aria-hidden="true"
          >
            {{ tone(toast.kind).icon }}
          </span>

          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">{{ toast.title }}</p>
            @if (toast.message) {
              <p class="mt-0.5 break-words text-xs opacity-90">{{ toast.message }}</p>
            }
          </div>

          <button
            type="button"
            class="shrink-0 rounded p-1 text-xs opacity-60 transition hover:opacity-100"
            aria-label="Dismiss notification"
            (click)="notifications.dismiss(toast.id)"
          >
            &#10005;
          </button>
        </div>
      }
    </div>
  `,
})
export class UiToastComponent {
  protected readonly notifications = inject(NotificationService);

  protected tone(kind: ToastKind): { container: string; icon: string } {
    return TONES[kind];
  }
}
