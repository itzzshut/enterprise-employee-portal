import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { UiAvatarComponent } from '@shared/ui-avatar/ui-avatar.component';
import type { OrgNode } from '@core/models';

/**
 * Renders a whole subtree from one root node.
 *
 * The recursion is a self-referencing `ng-template` driven by
 * `ngTemplateOutlet` rather than a component that imports itself: it keeps the
 * expand/collapse state in a single `Set` here instead of scattering a boolean
 * across hundreds of component instances, and it renders in one pass.
 *
 * Branches deeper than three levels start collapsed — an expanded 4,000-person
 * tree would put tens of thousands of nodes in the DOM for no benefit.
 */
@Component({
  selector: 'app-org-node',
  standalone: true,
  imports: [NgTemplateOutlet, UiAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container
      [ngTemplateOutlet]="nodeTpl"
      [ngTemplateOutletContext]="{ $implicit: node(), last: true }"
    />

    <ng-template #nodeTpl let-item let-last="last">
      <div class="relative" [class.pl-6]="item.depth > 0">
        @if (item.depth > 0) {
          <span
            class="absolute left-0 top-0 w-px bg-surface-border"
            [class]="last ? 'h-7' : 'h-full'"
            aria-hidden="true"
          ></span>
          <span class="absolute left-0 top-7 h-px w-6 bg-surface-border" aria-hidden="true"></span>
        }

        <div
          class="mb-2 flex items-center gap-3 rounded-xl border border-surface-border bg-white px-3 py-2.5 shadow-card transition hover:border-brand-300"
        >
          <app-ui-avatar size="sm" [name]="item.fullName" [src]="item.avatarUrl" />

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-slate-900">{{ item.fullName }}</p>
            <p class="truncate text-xs text-slate-500">
              {{ item.jobTitle }}
              @if (item.departmentName) {
                · {{ item.departmentName }}
              }
            </p>
          </div>

          @if (item.directReports > 0) {
            <button
              type="button"
              class="shrink-0 rounded-lg bg-surface-muted px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-brand-50 hover:text-brand-700"
              [attr.aria-expanded]="isExpanded(item)"
              [attr.aria-label]="
                (isExpanded(item) ? 'Collapse ' : 'Expand ') + item.fullName + ' reports'
              "
              (click)="toggle(item.id)"
            >
              {{ isExpanded(item) ? '−' : '+' }} {{ item.directReports }}
              @if (item.totalReports > item.directReports) {
                <span class="text-slate-400">/ {{ item.totalReports }}</span>
              }
            </button>
          }

          <button
            type="button"
            class="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-50"
            (click)="focused.emit(item.id)"
          >
            Focus
          </button>
        </div>

        @if (isExpanded(item)) {
          @for (child of item.children; track child.id; let isLastChild = $last) {
            <ng-container
              [ngTemplateOutlet]="nodeTpl"
              [ngTemplateOutletContext]="{ $implicit: child, last: isLastChild }"
            />
          }
        }
      </div>
    </ng-template>
  `,
})
export class OrgNodeComponent {
  readonly node = input.required<OrgNode>();
  /** Depth at which branches are collapsed by default. */
  readonly autoCollapseDepth = input(3);

  readonly focused = output<number>();

  /** Ids the user has explicitly toggled, overriding the depth default. */
  private readonly toggled = signal<Set<number>>(new Set());

  protected readonly threshold = computed(() => this.autoCollapseDepth());

  protected isExpanded(item: OrgNode): boolean {
    const manuallyToggled = this.toggled().has(item.id);
    const expandedByDefault = item.depth < this.threshold();
    // A toggle flips whatever the default was for that node.
    return manuallyToggled ? !expandedByDefault : expandedByDefault;
  }

  protected toggle(id: number): void {
    this.toggled.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
}
