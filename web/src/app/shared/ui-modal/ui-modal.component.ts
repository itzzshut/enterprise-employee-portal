import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * Lightweight modal.
 *
 * Escape and backdrop clicks both emit `closed` rather than hiding the dialog
 * internally — the parent owns the open state, which keeps the component free
 * of a second source of truth.
 */
@Component({
  selector: 'app-ui-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          (click)="closed.emit()"
          aria-hidden="true"
        ></div>

        <div
          class="relative w-full animate-fade-in rounded-xl bg-white shadow-raised"
          [class]="widthClass()"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="heading()"
        >
          <header class="flex items-start justify-between gap-4 border-b border-surface-border px-5 py-4">
            <div>
              <h2 class="text-base font-semibold text-slate-900">{{ heading() }}</h2>
              @if (subheading()) {
                <p class="mt-0.5 text-sm text-slate-500">{{ subheading() }}</p>
              }
            </div>
            <button
              type="button"
              class="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close dialog"
              (click)="closed.emit()"
            >
              &#10005;
            </button>
          </header>

          <div class="max-h-[70vh] overflow-y-auto px-5 py-4 scrollbar-slim">
            <ng-content />
          </div>

          <footer
            class="flex items-center justify-end gap-2 border-t border-surface-border bg-surface-muted px-5 py-3"
          >
            <ng-content select="[modalFooter]" />
          </footer>
        </div>
      </div>
    }
  `,
})
export class UiModalComponent {
  readonly open = input(false);
  readonly heading = input.required<string>();
  readonly subheading = input<string | null>(null);
  readonly width = input<'sm' | 'md' | 'lg'>('md');

  readonly closed = output<void>();

  protected readonly widthClass = computed(
    () => ({ sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' })[this.width()],
  );

  protected onEscape(): void {
    if (this.open()) this.closed.emit();
  }
}
