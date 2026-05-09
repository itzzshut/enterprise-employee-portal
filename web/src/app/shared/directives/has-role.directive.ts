import {
  Directive,
  type EmbeddedViewRef,
  Input,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { AuthService } from '@core/services/auth.service';
import type { Role } from '@core/models';

/**
 * Structural directive: `<button *appHasRole="'HR_ADMIN'">`.
 *
 * Accepts a single role or an array. Because `AuthService.role` is a signal,
 * the `effect` below re-evaluates automatically when the session changes — for
 * example after a refresh returns an updated role, the nav re-renders with no
 * manual subscription and no change-detection hint.
 *
 * This is presentation only. The API re-checks every rule; see role.guard.ts.
 */
@Directive({
  selector: '[appHasRole]',
  standalone: true,
})
export class HasRoleDirective {
  private readonly template = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);

  private readonly allowed = signal<Role[]>([]);
  private view: EmbeddedViewRef<unknown> | null = null;

  @Input({ required: true })
  set appHasRole(value: Role | Role[]) {
    this.allowed.set(Array.isArray(value) ? value : [value]);
  }

  constructor() {
    effect(() => {
      const roles = this.allowed();
      const permitted = roles.length === 0 || this.auth.hasRole(...roles);

      if (permitted && !this.view) {
        this.view = this.viewContainer.createEmbeddedView(this.template);
      } else if (!permitted && this.view) {
        this.viewContainer.clear();
        this.view = null;
      }
    });
  }
}
