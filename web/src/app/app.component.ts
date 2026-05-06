import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UiToastComponent } from '@shared/ui-toast/ui-toast.component';

/**
 * Root component: a router outlet plus the global toast host.
 *
 * All chrome (sidebar, topbar) belongs to the shell layout, which is itself a
 * lazily loaded route — that keeps the login screen free of the authenticated
 * layout code.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, UiToastComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <app-ui-toast />
  `,
})
export class AppComponent {}
