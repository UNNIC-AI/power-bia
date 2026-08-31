import type { DatasetSummary } from '@powerbia/contracts';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useDatasets } from './queries.ts';

const STORAGE_KEY = 'powerbia.dataset';

interface DatasetValue {
  datasets: DatasetSummary[];
  /** The model every route talks to. `undefined` only before the list loads. */
  active: DatasetSummary | undefined;
  select: (id: string) => void;
  isLoading: boolean;
}

const DatasetContext = createContext<DatasetValue | null>(null);

/**
 * Which model the app is talking to. Chat and dashboards both need it, and the
 * picker that changes it lives in the navbar above both, so the state sits here.
 *
 * Every route used to read `datasets[0]`, which meant a second registered model
 * was created and then unreachable. The choice is remembered per browser, like
 * the theme and the sidebar.
 */
export function DatasetProvider({ children }: { children: ReactNode }) {
  const datasets = useDatasets();
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  const select = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setSelected(id);
  }, []);

  const value = useMemo<DatasetValue>(() => {
    const list = datasets.data ?? [];

    return {
      datasets: list,
      // A remembered id that no longer exists falls back rather than blanking.
      active: list.find((dataset) => dataset.id === selected) ?? list[0],
      select,
      isLoading: datasets.isLoading,
    };
  }, [datasets.data, datasets.isLoading, selected, select]);

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset(): DatasetValue {
  const value = useContext(DatasetContext);
  if (!value) throw new Error('useDataset must be used inside DatasetProvider');

  return value;
}
