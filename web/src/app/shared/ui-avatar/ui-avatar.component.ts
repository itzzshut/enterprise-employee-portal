import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { InitialsPipe } from '@shared/pipes/initials.pipe';

/**
 * Avatar with a deterministic colour fallback.
 *
 * The colour is derived from the name, so the same person always gets the same
 * tile — which makes a directory of initials scannable rather than noisy.
 */
const PALETTE = [
  'bg-brand-100 text-brand-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-800',
  'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700',
  'bg-rose-100 text-rose-700',
];

@Component({
  selector: 'app-ui-avatar',
  standalone: true,
  imports: [InitialsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (src() && !failed()) {
      <img
        [src]="src()"
        [alt]="name()"
        [class]="'shrink-0 rounded-full object-cover ' + sizeClass()"
        (error)="failed.set(true)"
      />
    } @else {
      <span
        [class]="
          'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ' +
          sizeClass() +
          ' ' +
          colourClass()
        "
        [attr.aria-label]="name()"
        [title]="name()"
      >
        {{ name() | initials }}
      </span>
    }
  `,
})
export class UiAvatarComponent {
  readonly name = input.required<string>();
  readonly src = input<string | null>(null);
  readonly size = input<'xs' | 'sm' | 'md' | 'lg'>('md');

  protected readonly failed = signal(false);

  protected readonly sizeClass = computed(
    () =>
      ({
        xs: 'h-6 w-6 text-[10px]',
        sm: 'h-8 w-8 text-xs',
        md: 'h-10 w-10 text-sm',
        lg: 'h-16 w-16 text-lg',
      })[this.size()],
  );

  protected readonly colourClass = computed(() => {
    const name = this.name();
    let hash = 0;
    for (let index = 0; index < name.length; index += 1) {
      hash = (hash * 31 + name.charCodeAt(index)) % 100_000;
    }
    return PALETTE[hash % PALETTE.length];
  });
}
