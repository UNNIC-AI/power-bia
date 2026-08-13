import type { Locale } from '@powerbia/contracts';

const LOCALES: Record<Locale, string> = { es: 'es-ES', en: 'en-US' };

/**
 * The MVP formatted numbers server-side with en-US separators regardless of the
 * selected language. Formatting on the client fixes that.
 */
export function formatNumber(value: number, locale: Locale): string {
  const fractionDigits = Number.isInteger(value) ? 0 : 2;

  return new Intl.NumberFormat(LOCALES[locale], {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

/** Axis and tooltip labels, where 1.2M reads better than 1,200,000. */
export function formatCompact(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALES[locale], {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatCell(value: string | number | boolean | null, locale: Locale): string {
  if (value === null) return '';
  if (typeof value === 'number') return formatNumber(value, locale);
  if (typeof value === 'boolean') return value ? '✓' : '—';

  return value;
}

export function formatDay(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALES[locale], { dateStyle: 'medium' }).format(new Date(iso));
}

export function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALES[locale], { timeStyle: 'short' }).format(new Date(iso));
}
