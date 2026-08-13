import type { Locale, Point, Series } from '@powerbia/contracts';
import {
  columnIndex,
  distinctLabels,
  keepLabels,
  type ResultTable,
  sumByLabel,
  toLabel,
  toNumber,
} from './table.js';

/** Matches the frontend chart palette length — more series than this cannot be read. */
export const MAX_SERIES = 8;
export const MAX_CATEGORIES = 15;
/** ~10 years of monthly points; a safety net for time series. */
export const MAX_TEMPORAL_POINTS = 120;
export const MAX_PIE_SLICES = 10;
export const MAX_TABLE_ROWS = 1000;

const NOTICES = {
  topSeries: {
    es: (n: number) => `Mostrando las ${n} categorías principales; el resto agrupado en «Otros».`,
    en: (n: number) => `Showing the top ${n} categories; the rest grouped into "Other".`,
  },
  topCategories: {
    es: (n: number) => `Mostrando los ${n} valores principales del eje.`,
    en: (n: number) => `Showing the top ${n} axis values.`,
  },
  lastPeriods: {
    es: (n: number) => `Mostrando los últimos ${n} periodos.`,
    en: (n: number) => `Showing the last ${n} periods.`,
  },
  topSlices: {
    es: (n: number) => `Mostrando las ${n} categorías principales.`,
    en: (n: number) => `Showing the top ${n} categories.`,
  },
} as const;

function notice(key: keyof typeof NOTICES, locale: Locale, count: number): string {
  return NOTICES[key][locale](count);
}

const OTHERS_LABEL = { es: 'Otros', en: 'Other' } as const;

export interface Reduced<T> {
  value: T;
  notice: string | null;
}

export function toPoints(table: ResultTable, labelColumn: string, valueColumn: string): Point[] {
  const labelIdx = columnIndex(table, labelColumn);
  const valueIdx = columnIndex(table, valueColumn);
  if (labelIdx === -1 || valueIdx === -1) return [];

  return table.rows.map((row) => ({
    label: toLabel(row[labelIdx] ?? null),
    value: toNumber(row[valueIdx] ?? null),
  }));
}

/** Long-format rows (x, series, value) become one entry per series. */
export function pivotToSeries(
  table: ResultTable,
  xColumn: string,
  seriesColumn: string,
  valueColumn: string,
): Series[] {
  const labels = distinctLabels(table, xColumn);
  const xIdx = columnIndex(table, xColumn);
  const seriesIdx = columnIndex(table, seriesColumn);
  const valueIdx = columnIndex(table, valueColumn);
  if (xIdx === -1 || seriesIdx === -1 || valueIdx === -1) return [];

  const byName = new Map<string, Map<string, number>>();

  for (const row of table.rows) {
    const name = toLabel(row[seriesIdx] ?? null);
    const points = byName.get(name) ?? new Map<string, number>();
    points.set(toLabel(row[xIdx] ?? null), toNumber(row[valueIdx] ?? null));
    byName.set(name, points);
  }

  return [...byName].map(([name, points]) => ({
    name,
    data: labels.map((label) => ({ label, value: points.get(label) ?? 0 })),
  }));
}

function seriesTotal(series: Series): number {
  return series.data.reduce((sum, point) => sum + point.value, 0);
}

export function limitSeries(series: Series[], locale: Locale): Reduced<Series[]> {
  if (series.length <= MAX_SERIES) return { value: series, notice: null };

  const ranked = [...series].sort((a, b) => seriesTotal(b) - seriesTotal(a));
  const kept = ranked.slice(0, MAX_SERIES - 1);
  const folded = ranked.slice(MAX_SERIES - 1);
  const labels = series[0]?.data.map((point) => point.label) ?? [];

  const others: Series = {
    name: OTHERS_LABEL[locale],
    data: labels.map((label) => ({
      label,
      value: folded.reduce(
        (sum, s) => sum + (s.data.find((p) => p.label === label)?.value ?? 0),
        0,
      ),
    })),
  };

  return {
    value: [...kept, others],
    notice: notice('topSeries', locale, MAX_SERIES - 1),
  };
}

/**
 * For non-temporal axes (store, product): keep the highest-value categories.
 * A model with ~1900 stores otherwise produces a payload the browser cannot draw.
 */
export function limitCategoriesByValue(
  table: ResultTable,
  xColumn: string,
  valueColumn: string,
  locale: Locale,
): Reduced<ResultTable> {
  if (distinctLabels(table, xColumn).length <= MAX_CATEGORIES) {
    return { value: table, notice: null };
  }

  const top = [...sumByLabel(table, xColumn, valueColumn)]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CATEGORIES)
    .map(([label]) => label);

  return {
    value: keepLabels(table, xColumn, new Set(top)),
    notice: notice('topCategories', locale, MAX_CATEGORIES),
  };
}

/**
 * For temporal axes: keep the most recent points. Never truncate by value, or
 * the series stops being chronologically continuous.
 */
export function limitTemporalPoints(
  table: ResultTable,
  xColumn: string,
  locale: Locale,
): Reduced<ResultTable> {
  const labels = distinctLabels(table, xColumn);
  if (labels.length <= MAX_TEMPORAL_POINTS) return { value: table, notice: null };

  const recent = new Set(labels.slice(-MAX_TEMPORAL_POINTS));

  return {
    value: keepLabels(table, xColumn, recent),
    notice: notice('lastPeriods', locale, MAX_TEMPORAL_POINTS),
  };
}

export function limitPieSlices(points: Point[], locale: Locale): Reduced<Point[]> {
  const sorted = [...points].filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_PIE_SLICES) return { value: sorted, notice: null };

  return {
    value: sorted.slice(0, MAX_PIE_SLICES),
    notice: notice('topSlices', locale, MAX_PIE_SLICES),
  };
}

export function limitBarCategories(points: Point[], locale: Locale): Reduced<Point[]> {
  if (points.length <= MAX_CATEGORIES) return { value: points, notice: null };

  return {
    value: [...points].sort((a, b) => b.value - a.value).slice(0, MAX_CATEGORIES),
    notice: notice('topSlices', locale, MAX_CATEGORIES),
  };
}
