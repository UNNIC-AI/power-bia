import type { Card, CardKind, Locale } from '@powerbia/contracts';
import { formatNumber } from '../../lib/format.ts';
import { ComboChart } from '../charts/ComboChart.tsx';
import { PieChart } from '../charts/PieChart.tsx';
import { SeriesChart } from '../charts/SeriesChart.tsx';
import { FilterCard } from './FilterCard.tsx';
import { TableCard } from './TableCard.tsx';

export interface CardViewProps {
  card: Card;
  locale: Locale;
  onFilterChange?: (selected: string[]) => void;
  onChoice?: (choiceId: string, label: string) => void;
}

function KpiValue({ value, unit, locale }: { value: number; unit: string | null; locale: Locale }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1">
      <span className="text-3xl font-semibold tabular-nums">{formatNumber(value, locale)}</span>
      {unit && <span className="text-base-content/60 text-xs">{unit}</span>}
    </div>
  );
}

/**
 * The exhaustive switch is the point: the discriminated union in contracts means
 * a new card kind is a compile error here rather than a blank panel.
 */
export function CardView({ card, locale, onFilterChange, onChoice }: CardViewProps) {
  switch (card.kind) {
    case 'kpi':
      return <KpiValue value={card.value} unit={card.unit} locale={locale} />;

    case 'table':
      return <TableCard card={card} locale={locale} />;

    case 'pie':
      return <PieChart card={card} locale={locale} />;

    case 'combo':
      return <ComboChart card={card} locale={locale} />;

    case 'bar':
    case 'line':
    case 'area':
    case 'multi_line':
    case 'grouped_bar':
    case 'stacked_bar':
      return <SeriesChart card={card} locale={locale} />;

    case 'filter':
      return <FilterCard card={card} {...(onFilterChange ? { onChange: onFilterChange } : {})} />;

    case 'choice':
      return (
        <div className="flex flex-wrap items-start gap-2 p-1">
          {card.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => onChoice?.(option.id, option.label)}
            >
              {option.label}
            </button>
          ))}
        </div>
      );

    case 'note':
      return <p className="text-base-content/80 p-1 text-sm whitespace-pre-wrap">{card.text}</p>;
  }
}

/** Kinds that size to their content instead of filling a chart-height box. */
const INTRINSIC_HEIGHT = new Set<CardKind>(['note', 'choice']);
const COMPACT_HEIGHT = new Set<CardKind>(['kpi']);

/** A card with its title, the data-reduction notice, and a framed surface. */
export function CardPanel({
  card,
  locale,
  actions,
  height,
  ...handlers
}: CardViewProps & { actions?: React.ReactNode; height?: string }) {
  const isPlain = INTRINSIC_HEIGHT.has(card.kind);
  const box = height ?? (COMPACT_HEIGHT.has(card.kind) ? 'h-28' : 'h-72');

  return (
    <div className="card bg-base-100 border-base-300 border">
      <div className="card-body gap-2 p-4">
        {(card.title || actions) && (
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold">{card.title}</h3>
            {actions}
          </div>
        )}
        {card.subtitle && <p className="text-base-content/60 text-xs">{card.subtitle}</p>}
        <div className={isPlain ? '' : box}>
          <CardView card={card} locale={locale} {...handlers} />
        </div>
      </div>
    </div>
  );
}
