import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DashboardCanvas } from '../../components/dashboard/DashboardCanvas.tsx';
import { Sidebar } from '../../components/Sidebar.tsx';

import { formatDay } from '../../lib/format.ts';
import {
  useCreateDashboard,
  useDashboard,
  useDashboards,
  useDataset,
  useDeleteDashboard,
  useRegenerateDashboardName,
  useRenameDashboard,
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

  const dataset = useDataset();
  const dashboards = useDashboards();
  const createDashboard = useCreateDashboard();
  const renameDashboard = useRenameDashboard();
  const regenerateName = useRegenerateDashboardName();
  const deleteDashboard = useDeleteDashboard();

  /** Deleting is irreversible, so the row is held here until it is confirmed. */
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const activeId = selectedId ?? dashboards.data?.[0]?.id;
  const dashboard = useDashboard(activeId ?? null);

  if (!dataset.data) return null;

  const select = (id: string) => void navigate({ to: '/dashboards', search: { d: id } });

  /*
   * A view is created with a placeholder name and renamed from the row's menu,
   * the way a new chat is titled after the fact. The alternative - a name field
   * in the sidebar - is the one thing the two lists could not share.
   */
  const create = async () => {
    const created = await createDashboard.mutateAsync({ name: t('dashboards.defaultName') });
    select(created.id);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;

    deleteDashboard.mutate(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <div className="flex h-full min-h-0">
      <Sidebar
        items={(dashboards.data ?? []).map((entry) => ({
          id: entry.id,
          title: entry.name,
          meta: t('common.createdOn', { day: formatDay(entry.createdAt, locale) }),
        }))}
        activeId={activeId}
        newLabel={t('dashboards.create')}
        emptyLabel={t('dashboards.noDashboards')}
        busy={createDashboard.isPending}
        onNew={() => void create()}
        onSelect={select}
        onRename={(id, name) => renameDashboard.mutate({ id, name })}
        onRegenerate={(id) => regenerateName.mutate({ id, locale })}
        pendingId={regenerateName.isPending ? regenerateName.variables?.id : undefined}
        onDelete={(item) => setPendingDelete({ id: item.id, name: item.title })}
      />

      <section className="min-w-0 flex-1">
        {dashboard.data ? (
          <DashboardCanvas dashboard={dashboard.data} locale={locale} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-base-content/60 text-sm">{t('dashboards.noDashboards')}</p>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('dashboards.confirmDeleteTitle')}
        body={t('dashboards.confirmDeleteBody', { name: pendingDelete?.name ?? '' })}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
