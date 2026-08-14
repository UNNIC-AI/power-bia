import type { Locale, PieCard } from '@powerbia/contracts';
import { Cell, Legend, Pie, PieChart as RePieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatNumber } from '../../lib/format.ts';
import { useTheme } from '../../lib/theme-context.tsx';
import { SURFACE, seriesColor } from './palette.ts';

const MIN_LABELLED_SHARE = 0.05;

function renderShare({ x, y, percent }: { x?: number; y?: number; percent?: number }) {
  if (percent === undefined || percent < MIN_LABELLED_SHARE) return <text />;

  return (
    <text
      x={x}
      y={y}
      fill="var(--color-base-content)"
      fontSize={11}
      textAnchor="middle"
      dominantBaseline="central"
    >
      {Math.round(percent * 100)}%
    </text>
  );
}

export function PieChart({ card, locale }: { card: PieCard; locale: Locale }) {
  const { theme } = useTheme();
  const total = card.data.reduce((sum, point) => sum + point.value, 0);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RePieChart>
        <Pie
          data={card.data}
          dataKey="value"
          nameKey="label"
          innerRadius="45%"
          outerRadius="72%"
          paddingAngle={1}
          stroke={SURFACE}
          strokeWidth={2}
          isAnimationActive={false}
          // Rendered as an explicit <text> so the share wears text ink. Recharts
          // otherwise inherits the slice colour, and a value is not a mark.
          label={renderShare}
          labelLine={false}
        >
          {card.data.map((point, index) => (
            <Cell key={point.label} fill={seriesColor(theme, index)} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: 'var(--color-base-100)',
            border: '1px solid var(--color-base-300)',
            borderRadius: 'var(--radius-box)',
            fontSize: 12,
          }}
          formatter={(value) => {
            const numeric = Number(value);
            const share = total > 0 ? ` (${((numeric / total) * 100).toFixed(1)}%)` : '';
            return `${formatNumber(numeric, locale)}${share}`;
          }}
        />
        <Legend
          verticalAlign="bottom"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11 }}
        />
      </RePieChart>
    </ResponsiveContainer>
  );
}
