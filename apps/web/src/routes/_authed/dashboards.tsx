import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardCanvas } from '../../components/dashboard/DashboardCanvas.tsx';
import {
  useCreateDashboard,
  useDashboard,
  useDashboards,
  useDatasets,
  useDeleteDashboard,
} from '../../lib/queries.ts';
import { useActiveLocale } from '../_authed.tsx';

export const Route = createFileRoute('/_authed/dashboards')({
  validateSearch: (search: Record<string, unknown>) => ({
    d: typeof search.d === 'string' ? search.d : undefined,
  }),
  component: DashboardsRoute,
});

function DashboardsRoute() {
  const { t } = useTranslation();
  const locale = useActiveLocale();
  const navigate = useNavigate();
  const { d: selectedId } = Route.useSearch();

  const datasets = useDatasets();
  const dashboards = useDashboards();
  const createDashboard = useCreateDashboard();
  const deleteDashboard = useDeleteDashboard();

  const [name, setName] = useState('');

  const datasetId = datasets.data?.[0]?.id;
  const activeId = selectedId ?? dashboards.data?.[0]?.id;
  const dashboard = useDashboard(activeId ?? null);

  if (!datasetId) return null;

  const select = (id: string) => void navigate({ to: '/dashboards', search: { d: id } });

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setName('');

    const created = await createDashboard.mutateAsync({ name: trimmed, datasetId });
    select(created.id);
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="bg-base-100 border-base-300 hidden w-56 shrink-0 flex-col border-r md:flex print:hidden">
        <div className="flex gap-1 p-3">
          <input
            className="input input-bordered input-sm w-full"
            placeholder={t('dashboards.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!name.trim() || createDashboard.isPending}
            onClick={() => void create()}
          >
            +
          </button>
        </div>

        <ul className="menu menu-sm min-h-0 flex-1 overflow-y-auto">
          {dashboards.data?.length === 0 && (
            <li className="text-base-content/50 px-3 py-2 text-xs">
              {t('dashboards.noDashboards')}
            </li>
          )}
          {dashboards.data?.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={entry.id === activeId ? 'menu-active' : ''}
                onClick={() => select(entry.id)}
              >
                <span className="flex-1 truncate text-left">{entry.name}</span>
                <span className="badge badge-ghost badge-xs">{entry.widgetCount}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteDashboard.mutate(entry.id);
                  }}
                >
                  ×
                </button>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-w-0 flex-1">
        {dashboard.data ? (
          <DashboardCanvas dashboard={dashboard.data} locale={locale} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-base-content/60 text-sm">{t('dashboards.noDashboards')}</p>
          </div>
        )}
      </section>
    </div>
  );
}
