import { Pipe, type PipeTransform } from '@angular/core';

/**
 * Formats a decimal hour or day count the way people say it.
 *
 *   7.5  | duration          -> "7h 30m"
 *   0.5  | duration:'days'   -> "Half day"
 *   5    | duration:'days'   -> "5 days"
 */
@Pipe({ name: 'duration', standalone: true, pure: true })
export class DurationPipe implements PipeTransform {
  transform(value: number | string | null | undefined, unit: 'hours' | 'days' = 'hours'): string {
    if (value === null || value === undefined || value === '') return '—';

    const amount = typeof value === 'string' ? Number.parseFloat(value) : value;
    if (!Number.isFinite(amount)) return '—';

    return unit === 'days' ? this.formatDays(amount) : this.formatHours(amount);
  }

  private formatDays(amount: number): string {
    if (amount === 0) return 'None';
    if (amount === 0.5) return 'Half day';
    if (amount === 1) return '1 day';

    const whole = Math.floor(amount);
    const remainder = amount - whole;
    if (remainder === 0) return `${whole} days`;
    return remainder === 0.5 ? `${whole}½ days` : `${amount} days`;
  }

  private formatHours(amount: number): string {
    if (amount === 0) return '0h';

    const sign = amount < 0 ? '-' : '';
    const absolute = Math.abs(amount);
    const hours = Math.floor(absolute);
    const minutes = Math.round((absolute - hours) * 60);

    if (minutes === 0) return `${sign}${hours}h`;
    if (hours === 0) return `${sign}${minutes}m`;
    return `${sign}${hours}h ${minutes}m`;
  }
}
