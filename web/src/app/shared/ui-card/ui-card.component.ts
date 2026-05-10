import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Surface container used by every panel in the app.
 *
 * Two named slots (`[cardActions]`, `[cardFooter]`) keep the header layout
 * consistent without each feature re-implementing it.
 */
@Component({
  selector: 'app-ui-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-xl border border-surface-border bg-white shadow-card"
      [class.overflow-hidden]="flush()"
    >
      @if (heading() || subheading()) {
        <header class="flex items-start justify-between gap-4 border-b border-surface-border px-5 py-4">
          <div class="min-w-0">
            @if (heading()) {
              <h2 class="truncate text-base font-semibold text-slate-900">{{ heading() }}</h2>
            }
            @if (subheading()) {
              <p class="mt-0.5 truncate text-sm text-slate-500">{{ subheading() }}</p>
            }
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <ng-content select="[cardActions]" />
          </div>
        </header>
      }

      <div [class]="flush() ? '' : 'px-5 py-4'">
        <ng-content />
      </div>

      <ng-content select="[cardFooter]" />
    </section>
  `,
})
export class UiCardComponent {
  readonly heading = input<string | null>(null);
  readonly subheading = input<string | null>(null);
  /** Removes body padding — used when the card wraps a full-bleed table. */
  readonly flush = input(false);
}
