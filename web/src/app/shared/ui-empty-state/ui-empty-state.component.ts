import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Empty state.
 *
 * Every list in the app renders this instead of a blank panel — an empty table
 * with headers reads like a bug, while an empty state explains what the screen
 * is for and what to do next.
 */
@Component({
  selector: 'app-ui-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div
        class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-xl"
        aria-hidden="true"
      >
        {{ icon() }}
      </div>
      <h3 class="text-base font-semibold text-slate-900">{{ heading() }}</h3>
      @if (message()) {
        <p class="mt-1.5 max-w-sm text-sm text-slate-500">{{ message() }}</p>
      }
      <div class="mt-5">
        <ng-content />
      </div>
    </div>
  `,
})
export class UiEmptyStateComponent {
  readonly heading = input.required<string>();
  readonly message = input<string | null>(null);
  readonly icon = input('📭');
}
