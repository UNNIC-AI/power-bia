import type { Locale } from '@powerbia/contracts';
import {
  IconDatabase,
  IconLanguage,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMoon,
  IconSettings,
  IconSun,
} from '@tabler/icons-react';
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, MenuItem, MenuSeparator } from '../components/Menu.tsx';
import { SettingsDialog } from '../components/SettingsDialog.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { DatasetProvider, useDataset } from '../lib/dataset-context.tsx';
import { setLocale } from '../lib/i18n.ts';
import { useLogout, useMe } from '../lib/queries.ts';
import { useSidebar } from '../lib/sidebar-context.tsx';
import { useTheme } from '../lib/theme-context.tsx';

export const Route = createFileRoute('/_authed')({ component: AuthedLayout });

/**
 * The provider wraps the shell rather than sitting in `main.tsx` so that
 * `/datasets` is only requested once there is a session — at the root it would
 * fire a 401 on the login page.
 */
function AuthedLayout() {
  const navigate = useNavigate();
  const me = useMe();

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

  return (
    <DatasetProvider>
      <AuthedShell />
    </DatasetProvider>
  );
}

function AuthedShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const logout = useLogout();
  const locale = useActiveLocale();
  const { theme, toggle } = useTheme();
  const sidebar = useSidebar();
  const { datasets, active, select } = useDataset();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!me.data) return null;
  const isAdmin = me.data.role === 'admin';

  return (
    <div className="bg-base-200 flex h-screen flex-col">
      <header className="navbar bg-base-100 border-base-300 min-h-0 shrink-0 gap-2 border-b px-4 py-1.5 print:hidden">
        <Tooltip label={sidebar.open ? t('nav.hideSidebar') : t('nav.showSidebar')}>
          <button
            type="button"
            className="btn btn-ghost btn-square btn-sm"
            aria-label={sidebar.open ? t('nav.hideSidebar') : t('nav.showSidebar')}
            aria-expanded={sidebar.open}
            onClick={sidebar.toggle}
          >
            {sidebar.open ? (
              <IconLayoutSidebarLeftCollapse size={18} stroke={1.75} />
            ) : (
              <IconLayoutSidebarLeftExpand size={18} stroke={1.75} />
            )}
          </button>
        </Tooltip>

        <span className="font-semibold">{t('appName')}</span>

        <div className="flex-1" />

        {/* A picker only earns its place once there is something to pick. */}
        {datasets.length > 1 && (
          <label className="flex items-center gap-1">
            <IconDatabase size={14} stroke={1.75} className="text-base-content/50" />
            <span className="sr-only">{t('nav.dataset')}</span>
            <select
              className="select select-ghost select-xs w-40"
              value={active?.id ?? ''}
              onChange={(event) => select(event.target.value)}
            >
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {active && (
          <span className="text-base-content/60 hidden text-xs lg:inline">
            {datasets.length > 1 ? '' : `${active.name} · `}
            {active.dateRange.min} → {active.dateRange.max} · {active.tableCount} ·{' '}
            {active.measureCount}
          </span>
        )}

        <Menu
          header={me.data.email}
          trigger={
            <button type="button" className="btn btn-ghost btn-xs">
              {me.data.displayName}
            </button>
          }
        >
          <MenuItem onSelect={toggle}>
            {theme === 'dark' ? (
              <IconSun size={14} stroke={1.75} />
            ) : (
              <IconMoon size={14} stroke={1.75} />
            )}
            {theme === 'dark' ? t('common.lightMode') : t('common.darkMode')}
          </MenuItem>

          {/* Two locales, so the item is named after the one it switches to. */}
          <MenuItem onSelect={() => setLocale(locale === 'es' ? 'en' : 'es')}>
            <IconLanguage size={14} stroke={1.75} />
            {locale === 'es' ? 'English' : 'Español'}
          </MenuItem>

          {/* Introspection hits the customer's capacity, so it is admin-only. */}
          {isAdmin && (
            <MenuItem onSelect={() => setSettingsOpen(true)}>
              <IconSettings size={14} stroke={1.75} />
              {t('settings.title')}
            </MenuItem>
          )}

          <MenuSeparator />

          <MenuItem
            onSelect={() => void logout.mutateAsync().then(() => navigate({ to: '/login' }))}
          >
            <IconLogout size={14} stroke={1.75} />
            {t('auth.signOut')}
          </MenuItem>
        </Menu>
      </header>

      <main className="min-h-0 flex-1">
        {active ? (
          <Outlet />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-base-content/60 text-sm">{t('settings.noDataset')}</p>
            {isAdmin && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setSettingsOpen(true)}
              >
                <IconSettings size={14} stroke={1.75} />
                {t('settings.connectFirst')}
              </button>
            )}
          </div>
        )}
      </main>

      {/*
        Outside the `active` guard above: the settings dialog is how the first
        model gets connected, so it has to be reachable when there is none.
      */}
      <SettingsDialog
        open={settingsOpen}
        dataset={active}
        locale={locale}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

export function useActiveLocale(): Locale {
  const { i18n } = useTranslation();

  return i18n.language === 'en' ? 'en' : 'es';
}
