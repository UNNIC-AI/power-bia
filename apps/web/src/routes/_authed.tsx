import type { Locale } from '@powerbia/contracts';
import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { setLocale, storedLocale } from '../lib/i18n.ts';
import { useDatasets, useLogout, useMe } from '../lib/queries.ts';
import { useTheme } from '../lib/theme-context.tsx';

export const Route = createFileRoute('/_authed')({ component: AuthedLayout });

function AuthedLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const logout = useLogout();
  const datasets = useDatasets();
  const { theme, toggle } = useTheme();

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="loading loading-spinner" />
      </div>
    );
  }

  if (!me.data) {
    void navigate({ to: '/login' });
    return null;
  }

  const dataset = datasets.data?.[0];

  return (
    <div className="bg-base-200 flex h-screen flex-col">
      <header className="navbar bg-base-100 border-base-300 min-h-0 shrink-0 gap-2 border-b px-4 py-1.5 print:hidden">
        <span className="font-semibold">{t('appName')}</span>

        <div role="tablist" className="tabs tabs-sm tabs-box ml-4">
          <Link
            to="/chat"
            search={{ c: undefined }}
            role="tab"
            className="tab"
            activeProps={{ className: 'tab tab-active' }}
          >
            {t('nav.chat')}
          </Link>
          <Link
            to="/dashboards"
            search={{ d: undefined }}
            role="tab"
            className="tab"
            activeProps={{ className: 'tab tab-active' }}
          >
            {t('nav.dashboards')}
          </Link>
        </div>

        <div className="flex-1" />

        {dataset && (
          <span className="text-base-content/60 hidden text-xs lg:inline">
            {dataset.name} · {dataset.dateRange.min} → {dataset.dateRange.max} ·{' '}
            {dataset.tableCount} · {dataset.measureCount}
          </span>
        )}

        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => setLocale(storedLocale() === 'es' ? 'en' : 'es')}
        >
          {storedLocale().toUpperCase()}
        </button>

        <button type="button" className="btn btn-ghost btn-xs" onClick={toggle}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>

        <div className="dropdown dropdown-end">
          <button type="button" className="btn btn-ghost btn-xs">
            {me.data.displayName}
          </button>
          <ul className="dropdown-content menu bg-base-100 rounded-box border-base-300 z-10 w-40 border p-1 shadow-sm">
            <li>
              <button
                type="button"
                onClick={() => void logout.mutateAsync().then(() => navigate({ to: '/login' }))}
              >
                {t('auth.signOut')}
              </button>
            </li>
          </ul>
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {dataset ? (
          <Outlet />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="text-base-content/60 text-sm">
              No hay ningún modelo de datos configurado todavía.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export function useActiveLocale(): Locale {
  const { i18n } = useTranslation();

  return i18n.language === 'en' ? 'en' : 'es';
}
