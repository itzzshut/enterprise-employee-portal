import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-ui-spinner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center justify-center gap-3" role="status" [attr.aria-label]="label()">
      <span
        class="animate-spin rounded-full border-brand-200 border-t-brand-600"
        [class]="sizeClass()"
        aria-hidden="true"
      ></span>
      @if (label()) {
        <span class="text-sm text-slate-500">{{ label() }}</span>
      }
    </div>
  `,
})
export class UiSpinnerComponent {
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly label = input<string | null>(null);

  protected readonly sizeClass = computed(
    () =>
      ({
        sm: 'h-4 w-4 border-2',
        md: 'h-6 w-6 border-2',
        lg: 'h-10 w-10 border-[3px]',
      })[this.size()],
  );
}
