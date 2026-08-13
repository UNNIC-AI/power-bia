import type { ComboCard, Locale } from '@powerbia/contracts';
import { Bar, BarChart, Line, LineChart, ResponsiveContainer } from 'recharts';
import { useTheme } from '../../lib/theme-context.tsx';
import { SURFACE, seriesColor } from './palette.ts';
import { ChartAxes, ChartTooltip, needsAngledLabels, toRows } from './primitives.tsx';

/**
 * Two measures of different scale are shown as stacked panels sharing one x
 * axis, not as a dual-axis chart. Two y-scales on one plot let any pair of
 * series be made to look correlated by choosing the scales, so the comparison
 * it appears to support is not one the reader can trust.
 */
export function ComboChart({ card, locale }: { card: ComboCard; locale: Locale }) {
  const { theme } = useTheme();

  const [primary, secondary] = card.series;
  if (!primary) return null;

  const primaryRows = toRows([{ name: primary.name, data: primary.data }]);
  const angled = needsAngledLabels(primaryRows.rows);

  if (!secondary) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={primaryRows.rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <ChartAxes locale={locale} angleLabels={angled} />
          <ChartTooltip locale={locale} />
          <Bar
            dataKey={primary.name}
            fill={seriesColor(theme, 0)}
            radius={[4, 4, 0, 0]}
            stroke={SURFACE}
            strokeWidth={1}
            maxBarSize={48}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  const secondaryRows = toRows([{ name: secondary.name, data: secondary.data }]);

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="min-h-0 flex-1">
        <div className="text-base-content/60 px-1 text-[11px] font-medium">{primary.name}</div>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={primaryRows.rows} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <ChartAxes locale={locale} angleLabels={false} />
            <ChartTooltip locale={locale} />
            <Bar
              dataKey={primary.name}
              fill={seriesColor(theme, 0)}
              radius={[4, 4, 0, 0]}
              stroke={SURFACE}
              strokeWidth={1}
              maxBarSize={48}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="min-h-0 flex-1">
        <div className="text-base-content/60 px-1 text-[11px] font-medium">{secondary.name}</div>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={secondaryRows.rows} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <ChartAxes locale={locale} angleLabels={angled} />
            <ChartTooltip locale={locale} />
            <Line
              type="monotone"
              dataKey={secondary.name}
              stroke={seriesColor(theme, 1)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, stroke: SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
