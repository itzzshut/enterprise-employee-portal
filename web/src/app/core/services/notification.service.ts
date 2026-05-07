import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  /** Milliseconds before auto-dismissal; 0 keeps the toast until dismissed. */
  duration: number;
}

const DEFAULT_DURATIONS: Record<ToastKind, number> = {
  success: 3500,
  info: 4000,
  warning: 6000,
  // Errors stay put: they usually carry a reason the user needs to read.
  error: 0,
};

/**
 * Toast queue held in a signal, so `ui-toast` re-renders without a subscription
 * and without any change-detection plumbing.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly items = signal<Toast[]>([]);
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly toasts = this.items.asReadonly();

  success(title: string, message?: string): number {
    return this.push('success', title, message);
  }

  error(title: string, message?: string): number {
    return this.push('error', title, message);
  }

  info(title: string, message?: string): number {
    return this.push('info', title, message);
  }

  warning(title: string, message?: string): number {
    return this.push('warning', title, message);
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.items.update((toasts) => toasts.filter((toast) => toast.id !== id));
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.items.set([]);
  }

  private push(kind: ToastKind, title: string, message?: string): number {
    const id = this.nextId++;
    const toast: Toast = { id, kind, title, message, duration: DEFAULT_DURATIONS[kind] };

    // Cap the stack so a failing poll cannot bury the screen in toasts.
    this.items.update((toasts) => [...toasts.slice(-4), toast]);

    if (toast.duration > 0) {
      this.timers.set(
        id,
        setTimeout(() => this.dismiss(id), toast.duration),
      );
    }
    return id;
  }
}
