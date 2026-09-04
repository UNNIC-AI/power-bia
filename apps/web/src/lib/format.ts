import type { Locale } from '@powerbia/contracts';

const LOCALES: Record<Locale, string> = { es: 'es-ES', en: 'en-US' };

/**
 * The MVP formatted numbers server-side with en-US separators regardless of the
 * selected language. Formatting on the client fixes that.
 */
export function formatNumber(value: number, locale: Locale, fractionDigits?: number): string {
  const digits = fractionDigits ?? (Number.isInteger(value) ? 0 : 2);

  return new Intl.NumberFormat(LOCALES[locale], {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

/**
 * How many decimals a whole column should show.
 *
 * Deciding per value made one column render `74.290` directly under
 * `63.305,00` - the same measure, formatted two ways, which reads as two
 * different kinds of number. A column is either all whole or it is not.
 */
export function fractionDigitsFor(values: readonly (string | number | boolean | null)[]): number {
  const numbers = values.filter((value): value is number => typeof value === 'number');

  return numbers.every((value) => Number.isInteger(value)) ? 0 : 2;
}

/** Axis and tooltip labels, where 1.2M reads better than 1,200,000. */
export function formatCompact(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALES[locale], {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Text for one result cell. Booleans are deliberately absent: they render as a
 * Tabler icon, which is a node, not a string. See `TableCard`.
 */
export function formatCell(
  value: string | number | null,
  locale: Locale,
  fractionDigits?: number,
): string {
  if (value === null) return '';
  if (typeof value === 'number') return formatNumber(value, locale, fractionDigits);

  return value;
}

export function formatDay(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALES[locale], { dateStyle: 'medium' }).format(new Date(iso));
}

export function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALES[locale], { timeStyle: 'short' }).format(new Date(iso));
}
