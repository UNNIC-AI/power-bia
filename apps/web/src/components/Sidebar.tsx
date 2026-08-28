import { IconDots, IconPencil, IconPlus, IconSparkles, IconTrash } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSidebar } from '../lib/sidebar-context.tsx';
import { Menu, MenuItem } from './Menu.tsx';

export interface SidebarItem {
  id: string;
  title: string;
  /** When the row last mattered. Shown inside its menu, not on the row. */
  meta?: ReactNode;
}

interface Props {
  items: readonly SidebarItem[];
  activeId: string | undefined;
  newLabel: string;
  emptyLabel: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  /** Ask the model for a title from the row's own contents. */
  onRegenerate: (id: string) => void;
  /** The route decides what confirming a delete looks like. */
  onDelete: (item: SidebarItem) => void;
  busy?: boolean;
  /** Row whose title is being regenerated right now. */
  pendingId?: string | undefined;
}

/**
 * One list for both screens: chats and views differ only in what a row means.
 *
 * The row is a flex line with two siblings, the label button and the menu
 * trigger. It used to be a button nested inside a button — invalid HTML, and the
 * browser resolved the click to the outer one, so the trash icon selected the row
 * it was meant to delete.
 */
export function Sidebar({
  items,
  activeId,
  newLabel,
  emptyLabel,
  onNew,
  onSelect,
  onRename,
  onRegenerate,
  onDelete,
  busy,
  pendingId,
}: Props) {
  const { t } = useTranslation();
  const { open } = useSidebar();
  const [renaming, setRenaming] = useState<{
    id: string;
    draft: string;
  } | null>(null);

  if (!open) return null;

  /** Blur commits, so clicking away keeps the edit rather than dropping it. */
  const commit = () => {
    if (!renaming) return;

    const trimmed = renaming.draft.trim();
    const before = items.find((item) => item.id === renaming.id)?.title;
    setRenaming(null);

    if (trimmed && trimmed !== before) onRename(renaming.id, trimmed);
  };

  return (
    <aside className="bg-base-100 border-base-300 hidden w-64 shrink-0 flex-col border-r md:flex print:hidden">
      <div role="tablist" className="tabs tabs-box tabs-sm m-2 mb-0 rounded-full">
        <Link
          to="/chat"
          search={{ c: undefined }}
          role="tab"
          className="tab flex-1 rounded-full"
          activeProps={{ className: 'tab tab-active flex-1' }}
        >
          {t('nav.chat')}
        </Link>
        <Link
          to="/dashboards"
          search={{ d: undefined }}
          role="tab"
          className="tab flex-1 rounded-full"
          activeProps={{ className: 'tab tab-active flex-1' }}
        >
          {t('nav.dashboards')}
        </Link>
      </div>

      <div className="p-2">
        <button
          type="button"
          className="btn btn-primary btn-sm w-full"
          disabled={busy}
          onClick={onNew}
        >
          {busy ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <IconPlus size={16} stroke={1.75} />
          )}
          {newLabel}
        </button>
      </div>

      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {items.length === 0 && (
          <li className="text-base-content/50 px-2 py-2 text-xs">{emptyLabel}</li>
        )}

        {items.map((item) => (
          <li key={item.id}>
            {renaming?.id === item.id ? (
              <input
                className="input input-sm w-full"
                value={renaming.draft}
                // Autofocus is right here: the field exists because the user
                // just picked Rename, and it replaces the row it renames.
                // biome-ignore lint/a11y/noAutofocus: replaces the row on demand
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) =>
                  setRenaming({
                    id: item.id,
                    draft: event.target.value,
                  })
                }
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commit();
                  if (event.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <div
                className={`rounded-field flex items-center gap-1 pr-1 ${
                  item.id === activeId ? 'bg-base-200' : 'hover:bg-base-200/60'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                  title={item.title}
                  onClick={() => onSelect(item.id)}
                >
                  {item.title}
                </button>

                {item.id === pendingId && <span className="loading loading-spinner loading-xs" />}

                <Menu
                  label={t('common.actions')}
                  {...(item.meta ? { header: item.meta } : {})}
                  trigger={
                    <button type="button" className="btn btn-ghost btn-square btn-xs">
                      <IconDots size={14} stroke={1.75} />
                    </button>
                  }
                >
                  <MenuItem
                    onSelect={() =>
                      setRenaming({
                        id: item.id,
                        draft: item.title,
                      })
                    }
                  >
                    <IconPencil size={14} stroke={1.75} />
                    {t('common.rename')}
                  </MenuItem>
                  <MenuItem onSelect={() => onRegenerate(item.id)}>
                    <IconSparkles size={14} stroke={1.75} />
                    {t('common.regenerateTitle')}
                  </MenuItem>
                  <MenuItem destructive onSelect={() => onDelete(item)}>
                    <IconTrash size={14} stroke={1.75} />
                    {t('common.delete')}
                  </MenuItem>
                </Menu>
              </div>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
