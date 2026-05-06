import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => {
  // Bootstrap failures happen before the notification service exists, so this
  // is the one place a raw console write is the right answer.
  console.error('Failed to bootstrap the employee portal', error);
});
