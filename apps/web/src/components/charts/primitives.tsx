import type { Locale, Series } from '@powerbia/contracts';
import { CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompact, formatNumber } from '../../lib/format.ts';
import { AXIS_INK, GRID_INK } from './palette.ts';

export interface ChartRow {
  label: string;
  [seriesName: string]: string | number;
}

/** Series are column-oriented on the wire; Recharts wants one object per x value. */
export function toRows(series: readonly Series[]): { rows: ChartRow[]; names: string[] } {
  const names = series.map((s, index) => s.name ?? `s${index}`);
  const byLabel = new Map<string, ChartRow>();
  const order: string[] = [];

  series.forEach((entry, index) => {
    const name = names[index] ?? `s${index}`;

    for (const point of entry.data) {
      let row = byLabel.get(point.label);
      if (!row) {
        row = { label: point.label };
        byLabel.set(point.label, row);
        order.push(point.label);
      }
      row[name] = point.value;
    }
  });

  return { rows: order.map((label) => byLabel.get(label) as ChartRow), names };
}

const AXIS_PROPS = {
  stroke: AXIS_INK,
  tick: { fontSize: 11, fill: 'currentColor', opacity: 0.7 },
  tickLine: false,
} as const;

const MAX_TICK_CHARS = 24;
/** Enough band for an angled label of `MAX_TICK_CHARS` at the axis font size. */
const ANGLED_AXIS_HEIGHT = 132;

/**
 * An angled label longer than this runs off the left edge of the plot. Names
 * are what gets cut - "MIGUEL ANGEL NA..." - so the limit is as generous as the
 * reserved band allows; the tooltip carries the full text either way.
 */
function truncateTick(value: string): string {
  return value.length > MAX_TICK_CHARS ? `${value.slice(0, MAX_TICK_CHARS - 1)}...` : value;
}

export function ChartAxes({ locale, angleLabels }: { locale: Locale; angleLabels: boolean }) {
  return (
    <>
      <CartesianGrid stroke={GRID_INK} vertical={false} />
      <XAxis
        dataKey="label"
        {...AXIS_PROPS}
        interval="preserveStartEnd"
        {...(angleLabels
          ? {
              angle: -35,
              textAnchor: 'end' as const,
              height: ANGLED_AXIS_HEIGHT,
              tickFormatter: truncateTick,
            }
          : {})}
      />
      <YAxis
        {...AXIS_PROPS}
        axisLine={false}
        width={56}
        tickFormatter={(value: number) => formatCompact(value, locale)}
      />
    </>
  );
}

export function ChartTooltip({ locale }: { locale: Locale }) {
  return (
    <Tooltip
      cursor={{ stroke: AXIS_INK, strokeWidth: 1 }}
      contentStyle={{
        background: 'var(--color-base-100)',
        border: '1px solid var(--color-base-300)',
        borderRadius: 'var(--radius-box)',
        fontSize: 12,
      }}
      labelStyle={{ color: 'var(--color-base-content)', fontWeight: 600 }}
      formatter={(value) => formatNumber(Number(value), locale)}
    />
  );
}

/** Identity is never colour alone: two or more series always carry a legend. */
export function ChartLegend({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <Legend
      verticalAlign="bottom"
      height={28}
      iconType="circle"
      iconSize={8}
      wrapperStyle={{ fontSize: 11 }}
    />
  );
}

/** Long categorical labels need tilting; short or few labels do not. */
export function needsAngledLabels(rows: readonly ChartRow[]): boolean {
  if (rows.length > 8) return true;

  return rows.some((row) => row.label.length > 10);
}
