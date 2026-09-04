import type { Locale, TableCard as TableCardType } from '@powerbia/contracts';
import { IconCheck, IconChevronLeft, IconChevronRight, IconMinus } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCell, fractionDigitsFor } from '../../lib/format.ts';
import { Tooltip } from '../Tooltip.tsx';

const PAGE_SIZE = 25;

/** A boolean result cell. An icon, never a glyph in a string - see `formatCell`. */
function BooleanCell({ value, label }: { value: boolean; label: string }) {
  return value ? (
    <IconCheck size={16} stroke={2} aria-label={label} />
  ) : (
    <IconMinus size={16} stroke={2} className="text-base-content/40" aria-label={label} />
  );
}

export function TableCard({ card, locale }: { card: TableCardType; locale: Locale }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);

  const pages = Math.max(1, Math.ceil(card.rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = card.rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  /*
   * Read from every row, not just the visible page: paging must not change how
   * a column is formatted.
   */
  const digits = useMemo(
    () =>
      card.columns.map((_column, index) =>
        fractionDigitsFor(card.rows.map((row) => row[index] ?? null)),
      ),
    [card.columns, card.rows],
  );

  if (card.rows.length === 0) {
    return <p className="text-base-content/60 p-4 text-sm">{t('table.noRows')}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="table-zebra table-pin-rows table table-sm">
          <thead>
            <tr>
              {card.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              // Row identity is positional: results have no stable key.
              <tr key={`${current}-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={card.columns[cellIndex] ?? cellIndex}
                    className={typeof cell === 'number' ? 'text-right tabular-nums' : ''}
                  >
                    {typeof cell === 'boolean' ? (
                      <BooleanCell value={cell} label={t(cell ? 'table.yes' : 'table.no')} />
                    ) : (
                      formatCell(cell, locale, digits[cellIndex])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex shrink-0 items-center justify-between gap-2 pt-2">
          <span className="text-base-content/60 text-xs">
            {t('table.page', { page: current + 1, pages })}
          </span>
          <div className="join">
            <Tooltip label={t('table.previous')}>
              <button
                type="button"
                className="btn join-item btn-square btn-xs"
                aria-label={t('table.previous')}
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                <IconChevronLeft size={14} stroke={1.75} />
              </button>
            </Tooltip>
            <Tooltip label={t('table.next')}>
              <button
                type="button"
                className="btn join-item btn-square btn-xs"
                aria-label={t('table.next')}
                disabled={current >= pages - 1}
                onClick={() => setPage(current + 1)}
              >
                <IconChevronRight size={14} stroke={1.75} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}
