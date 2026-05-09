import { Pipe, type PipeTransform } from '@angular/core';

/**
 * "Priya Raman" -> "PR". Falls back to the first two characters for a
 * single-word name, and to "?" for an empty one.
 */
@Pipe({ name: 'initials', standalone: true, pure: true })
export class InitialsPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '?';

    const words = value
      .trim()
      .split(/\s+/)
      .filter((word) => /[a-z0-9]/i.test(word));

    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

    const first = words[0].charAt(0);
    const last = words[words.length - 1].charAt(0);
    return `${first}${last}`.toUpperCase();
  }
}
