import type { Card, ChartType, Locale, Series, VizDecision } from '@powerbia/contracts';
import { resolveColumn } from '../dax/columns.js';
import {
  limitBarCategories,
  limitCategoriesByValue,
  limitPieSlices,
  limitSeries,
  limitTemporalPoints,
  MAX_TABLE_ROWS,
  pivotToSeries,
  toPoints,
} from './reduce.js';
import {
  type Cell,
  categoricalColumns,
  cellAt,
  isEmpty,
  isNumericColumn,
  numericColumns,
  type ResultTable,
  toNumber,
} from './table.js';

export interface CardContext {
  locale: Locale;
  labelFor: (column: string) => string;
  /** Canonical value order for a column, when the catalogue discovered one. */
  orderFor?: (column: string) => readonly string[] | null;
  title: string | null;
}

const BY = { es: 'por', en: 'by' } as const;

const MULTI_SERIES_TYPES = new Set<ChartType>(['multi_line', 'grouped_bar', 'stacked_bar']);

function joinNotices(...notices: (string | null)[]): string | null {
  const present = notices.filter((n): n is string => Boolean(n));

  return present.length > 0 ? present.join(' ') : null;
}

function buildTableCard(table: ResultTable, ctx: CardContext): Card {
  return {
    kind: 'table',
    title: ctx.title || null,
    subtitle: null,
    columns: table.columns.map(ctx.labelFor),
    rows: table.rows.slice(0, MAX_TABLE_ROWS),
  };
}

function hasAnyValue(series: readonly Series[]): boolean {
  return series.some((s) => s.data.some((point) => point.value !== 0));
}

/**
 * Puts the rows in the order the catalogue says the axis runs in.
 *
 * Everything downstream reads row order as meaningful - a line chart draws it,
 * a table prints it, and `limitTemporalPoints` takes the last N as "the most
 * recent". So sorting here is what makes a month axis chronological, rather
 * than each of those places having to know about it. The generated DAX cannot
 * do this itself: ordering by the month number means projecting it, which puts
 * a column nobody asked for in the result.
 *
 * Rows whose label is not in the order keep their relative position at the end,
 * so a partial or unexpected value degrades to "unsorted" and never disappears.
 */
function applyCanonicalOrder(table: ResultTable, ctx: CardContext): ResultTable {
  if (!ctx.orderFor) return table;

  for (const [index, column] of table.columns.entries()) {
    const order = ctx.orderFor(column);
    if (!order) continue;

    const position = new Map(order.map((value, at) => [value, at]));
    const rank = (row: Cell[]) => position.get(String(row[index] ?? '')) ?? order.length;

    const sorted = table.rows
      .map((row, at) => ({ row, at }))
      .sort((a, b) => rank(a.row) - rank(b.row) || a.at - b.at)
      .map((entry) => entry.row);

    return { columns: table.columns, rows: sorted };
  }

  return table;
}

/**
 * Turns a result set into a card using the visualization decided before the DAX
 * was generated. Where the returned data cannot support that decision, it
 * degrades deterministically rather than rendering something broken:
 * combo without a second measure becomes a line, a multi-series chart without a
 * series column becomes its single-series equivalent, and anything unusable
 * becomes a table.
 */
export function buildCard(
  source: ResultTable,
  decision: VizDecision,
  ctx: CardContext,
): Card | null {
  if (isEmpty(source)) return null;

  const table = applyCanonicalOrder(source, ctx);
  const { locale } = ctx;
  const categorical = categoricalColumns(table);
  const numeric = numericColumns(table);

  const valueColumn = resolveColumn(decision.measure, table.columns) ?? numeric.at(-1) ?? null;
  if (!valueColumn) return buildTableCard(table, ctx);

  const secondaryColumn = resolveColumn(decision.secondaryMeasure, table.columns);
  const title = ctx.title || decision.suggestedTitle || '';

  // The shape of the data wins over the model's choice.
  if (table.rows.length === 1 && categorical.length === 0) {
    const label = title || ctx.labelFor(valueColumn);
    return {
      kind: 'kpi',
      title: label,
      subtitle: null,
      value: toNumber(cellAt(table, 0, valueColumn)),
      unit: null,
    };
  }

  if (decision.mode === 'table' || decision.chartType === 'table') {
    return buildTableCard(table, ctx);
  }

  let seriesColumn = resolveColumn(decision.seriesColumn, table.columns);
  const xColumn =
    resolveColumn(decision.xAxis, table.columns) ??
    categorical.find((c) => c !== seriesColumn) ??
    null;

  if (!xColumn) return buildTableCard(table, ctx);
  if (seriesColumn === xColumn) seriesColumn = null;

  const baseTitle = title || `${ctx.labelFor(valueColumn)} ${BY[locale]} ${ctx.labelFor(xColumn)}`;

  let chartType = decision.chartType;

  if (chartType === 'combo') {
    if (secondaryColumn && secondaryColumn !== valueColumn) {
      const reduced = limitTemporalPoints(table, xColumn, locale);
      return {
        kind: 'combo',
        title,
        subtitle: reduced.notice,
        series: [
          {
            name: ctx.labelFor(valueColumn),
            type: 'bar',
            axis: 'primary',
            data: toPoints(reduced.value, xColumn, valueColumn),
          },
          {
            name: ctx.labelFor(secondaryColumn),
            type: 'line',
            axis: 'secondary',
            data: toPoints(reduced.value, xColumn, secondaryColumn),
          },
        ],
      };
    }

    chartType = 'line';
  }

  if (MULTI_SERIES_TYPES.has(chartType) && seriesColumn) {
    const reduced =
      chartType === 'multi_line'
        ? limitTemporalPoints(table, xColumn, locale)
        : limitCategoriesByValue(table, xColumn, valueColumn, locale);

    const limited = limitSeries(
      pivotToSeries(reduced.value, xColumn, seriesColumn, valueColumn),
      locale,
    );

    if (hasAnyValue(limited.value)) {
      return {
        kind: chartType as 'multi_line' | 'grouped_bar' | 'stacked_bar',
        title: baseTitle,
        subtitle: joinNotices(reduced.notice, limited.notice),
        series: limited.value,
      };
    }
  }

  if (MULTI_SERIES_TYPES.has(chartType)) {
    chartType = chartType === 'multi_line' ? 'line' : 'bar';
  }

  if (chartType === 'pie') {
    const limited = limitPieSlices(toPoints(table, xColumn, valueColumn), locale);
    if (limited.value.length === 0) return buildTableCard(table, ctx);

    return { kind: 'pie', title: baseTitle, subtitle: limited.notice, data: limited.value };
  }

  if (chartType === 'bar') {
    const limited = limitBarCategories(toPoints(table, xColumn, valueColumn), locale);
    const data = isNumericColumn(table, xColumn)
      ? [...limited.value].sort((a, b) => Number(a.label) - Number(b.label))
      : limited.value;

    return {
      kind: 'bar',
      title: baseTitle,
      subtitle: limited.notice,
      series: [{ name: null, data }],
    };
  }

  const reduced = limitTemporalPoints(table, xColumn, locale);
  const data = toPoints(reduced.value, xColumn, valueColumn);

  if (data.length <= 1) {
    const label = title || ctx.labelFor(valueColumn);
    return {
      kind: 'kpi',
      title: label,
      subtitle: null,
      value: data[0]?.value ?? 0,
      unit: null,
    };
  }

  return {
    kind: chartType === 'area' ? 'area' : 'line',
    title: baseTitle,
    subtitle: reduced.notice,
    series: [{ name: null, data }],
    showTrend: decision.showTrend,
  };
}
