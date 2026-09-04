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
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccountDialog } from '../components/AccountDialog.tsx';
import { Menu, MenuItem, MenuSeparator } from '../components/Menu.tsx';
import { SettingsDialog } from '../components/SettingsDialog.tsx';
import { Tooltip } from '../components/Tooltip.tsx';
import { UsersDialog } from '../components/UsersDialog.tsx';
import { setLocale } from '../lib/i18n.ts';
import { useDataset, useLogout, useMe } from '../lib/queries.ts';
import { useSidebar } from '../lib/sidebar-context.tsx';
import { useTheme } from '../lib/theme-context.tsx';

export const Route = createFileRoute('/_authed')({ component: AuthedLayout });

/**
 * The shell only mounts once there is a session: `/dataset` is authenticated,
 * and requesting it from the root would fire a 401 on the login page.
 */
function AuthedLayout() {
  const navigate = useNavigate();
  const me = useMe();
  const signedOut = !me.isLoading && !me.data;

  /*
   * In an effect, not in the render body: navigating while rendering updates
   * the router from inside another component's render, which React reports as
   * "Cannot update a component while rendering a different component" on every
   * load. `beforeLoad` is the usual home for this, but the session lives in a
   * query rather than in the router's context.
   */
  useEffect(() => {
    if (signedOut) void navigate({ to: '/login' });
  }, [signedOut, navigate]);

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="loading loading-spinner" />
      </div>
    );
  }

  if (!me.data) return null;

  return <AuthedShell />;
}

function AuthedShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMe();
  const logout = useLogout();
  const locale = useActiveLocale();
  const { theme, toggle } = useTheme();
  const sidebar = useSidebar();
  const dataset = useDataset();
  const active = dataset.data;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);

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

        {/*
          No picker. There is one model, the environment names it, and switching
          is an `.env` edit plus a restart - see `datasets/provision.ts`.
        */}
        {active && (
          <span className="text-base-content/60 hidden items-center gap-1 text-xs lg:inline-flex">
            <IconDatabase size={14} stroke={1.75} className="text-base-content/50" />
            {active.name} &middot; {active.dateRange.min} - {active.dateRange.max} &middot;{' '}
            {active.tableCount} &middot; {active.measureCount}
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

          <MenuItem onSelect={() => setAccountOpen(true)}>
            <IconUser size={14} stroke={1.75} />
            {t('account.title')}
          </MenuItem>

          {/* Introspection hits the customer's capacity, so it is admin-only. */}
          {isAdmin && (
            <MenuItem onSelect={() => setSettingsOpen(true)}>
              <IconSettings size={14} stroke={1.75} />
              {t('settings.title')}
            </MenuItem>
          )}

          {/* Self-registration is closed: accounts only exist because an admin made them. */}
          {isAdmin && (
            <MenuItem onSelect={() => setUsersOpen(true)}>
              <IconUsers size={14} stroke={1.75} />
              {t('users.title')}
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
        {dataset.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <span className="loading loading-spinner" />
          </div>
        ) : active ? (
          <Outlet />
        ) : (
          /*
            No call to action: connecting a model is an environment change plus a
            restart, not something this screen can do.
          */
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-base-content/60 text-sm">{t('settings.noDataset')}</p>
            <p className="text-base-content/50 max-w-md text-xs">{t('settings.sourceHelp')}</p>
          </div>
        )}
      </main>

      {/*
        Outside the `active` guard above: an admin must be able to open Settings
        even when no model is connected, to see what the server is pointed at.
      */}
      <SettingsDialog
        open={settingsOpen}
        dataset={active}
        locale={locale}
        onClose={() => setSettingsOpen(false)}
      />

      <AccountDialog
        open={accountOpen}
        email={me.data.email}
        onClose={() => setAccountOpen(false)}
      />

      {isAdmin && (
        <UsersDialog
          open={usersOpen}
          currentUserId={me.data.id}
          onClose={() => setUsersOpen(false)}
        />
      )}
    </div>
  );
}

export function useActiveLocale(): Locale {
  const { i18n } = useTranslation();

  return i18n.language === 'en' ? 'en' : 'es';
}
