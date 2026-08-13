import type { Locale, SeriesCard } from '@powerbia/contracts';
import { Area, AreaChart, Bar, BarChart, Line, LineChart, ResponsiveContainer } from 'recharts';
import { useTheme } from '../../lib/theme-context.tsx';
import { SURFACE, seriesColor } from './palette.ts';
import {
  ChartAxes,
  ChartLegend,
  type ChartRow,
  ChartTooltip,
  needsAngledLabels,
  toRows,
} from './primitives.tsx';

const TREND_KEY = '__trend';
const DOT_LIMIT = 24;

/** Least-squares fit, so "is it going up?" gets an answer rather than a guess. */
function withTrend(rows: ChartRow[], key: string): ChartRow[] {
  const points = rows
    .map((row, index) => ({ x: index, y: Number(row[key]) }))
    .filter((point) => Number.isFinite(point.y));
  if (points.length < 2) return rows;

  const n = points.length;
  const sumX = points.reduce((total, p) => total + p.x, 0);
  const sumY = points.reduce((total, p) => total + p.y, 0);
  const sumXY = points.reduce((total, p) => total + p.x * p.y, 0);
  const sumXX = points.reduce((total, p) => total + p.x * p.x, 0);

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return rows;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return rows.map((row, index) => ({ ...row, [TREND_KEY]: intercept + slope * index }));
}

export function SeriesChart({ card, locale }: { card: SeriesCard; locale: Locale }) {
  const { theme } = useTheme();

  const { rows: baseRows, names } = toRows(card.series);
  const showTrend = 'showTrend' in card && card.showTrend && names.length === 1;
  const firstName = names[0];
  const rows = showTrend && firstName ? withTrend(baseRows, firstName) : baseRows;

  const angled = needsAngledLabels(rows);
  const showLegend = names.length > 1;
  const showDots = rows.length <= DOT_LIMIT;

  const shared = (
    <>
      <ChartAxes locale={locale} angleLabels={angled} />
      <ChartTooltip locale={locale} />
      <ChartLegend show={showLegend} />
    </>
  );

  if (card.kind === 'line' || card.kind === 'multi_line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          {shared}
          {names.map((name, index) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={seriesColor(theme, index)}
              strokeWidth={2}
              dot={showDots ? { r: 4, strokeWidth: 0 } : false}
              activeDot={{ r: 5, stroke: SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
          {showTrend && (
            <Line
              dataKey={TREND_KEY}
              stroke="currentColor"
              strokeOpacity={0.45}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={false}
              legendType="none"
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (card.kind === 'area') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          {shared}
          {names.map((name, index) => (
            <Area
              key={name}
              type="monotone"
              dataKey={name}
              stroke={seriesColor(theme, index)}
              strokeWidth={2}
              fill={seriesColor(theme, index)}
              fillOpacity={0.18}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  const stacked = card.kind === 'stacked_bar';

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
        {shared}
        {names.map((name, index) => (
          <Bar
            key={name}
            dataKey={name}
            fill={seriesColor(theme, index)}
            {...(stacked ? { stackId: 'total' } : {})}
            // A surface-coloured hairline keeps adjacent fills from reading as one mark.
            stroke={SURFACE}
            strokeWidth={1}
            radius={stacked ? 0 : [4, 4, 0, 0]}
            maxBarSize={48}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
