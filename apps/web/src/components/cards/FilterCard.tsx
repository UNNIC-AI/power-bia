import type { FilterCard as FilterCardType } from '@powerbia/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  card: FilterCardType;
  onChange?: (selected: string[]) => void;
}

export function FilterCard({ card, onChange }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const selected = card.selected;

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return card.values;

    return card.values.filter((value) => value.toLowerCase().includes(needle));
  }, [card.values, search]);

  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((entry) => entry !== value)
      : [...selected, value];
    onChange?.(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex gap-1">
        <input
          type="search"
          className="input input-xs w-full"
          placeholder={t('dashboards.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {selected.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            title={t('dashboards.clearFilter')}
            onClick={() => onChange?.([])}
          >
            ×
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {visible.map((value) => (
          <label
            key={value}
            className="hover:bg-base-200 flex cursor-pointer items-center gap-2 rounded px-1 py-0.5"
          >
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={selected.includes(value)}
              onChange={() => toggle(value)}
              disabled={!onChange}
            />
            <span className="truncate text-xs" title={value}>
              {value}
            </span>
          </label>
        ))}
      </div>

      <p className="text-base-content/60 shrink-0 text-[11px]">
        {selected.length > 0
          ? t('dashboards.selectedOf', { selected: selected.length, total: card.values.length })
          : t('dashboards.valueCount', { count: card.values.length })}
      </p>
    </div>
  );
}
