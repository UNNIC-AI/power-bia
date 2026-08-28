import type { Locale } from '@powerbia/contracts';
import {
  IconLanguage,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMoon,
  IconSun,
} from '@tabler/icons-react';
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Menu, MenuItem, MenuSeparator } from '../components/Menu.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { setLocale } from '../lib/i18n.ts';
import { useDatasets, useLogout, useMe } from '../lib/queries.ts';
import { useSidebar } from '../lib/sidebar-context.tsx';
import { useTheme } from '../lib/theme-context.tsx';

export const Route = createFileRoute('/_authed')({ component: AuthedLayout });

function AuthedLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const logout = useLogout();
  const datasets = useDatasets();
  const locale = useActiveLocale();
  const { theme, toggle } = useTheme();
  const sidebar = useSidebar();

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

        {dataset && (
          <span className="text-base-content/60 hidden text-xs lg:inline">
            {dataset.name} · {dataset.dateRange.min} → {dataset.dateRange.max} ·{' '}
            {dataset.tableCount} · {dataset.measureCount}
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
