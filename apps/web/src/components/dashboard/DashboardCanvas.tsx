import type {
  Card,
  ChartType,
  Dashboard,
  FilterSelection,
  Locale,
  Widget,
} from '@powerbia/contracts';
import { DEFAULT_WIDGET_SIZE } from '@powerbia/contracts';
import {
  IconDots,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { type Layout, useContainerWidth } from 'react-grid-layout';
import { useTranslation } from 'react-i18next';
import {
  useAddWidget,
  useRemoveWidget,
  useRunQuery,
  useSaveLayouts,
  useUpdateWidget,
} from '../../lib/queries.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { CardView } from '../cards/CardView.tsx';
import { Menu, MenuItem } from '../Menu.tsx';
import { Prompt } from '../Prompt.tsx';
import { Tooltip } from '../Tooltip.tsx';

const COLUMNS = 12;
const ROW_HEIGHT = 40;
const FILTER_DEBOUNCE_MS = 700;

const CONTROL_KINDS = new Set<Card['kind']>(['filter', 'choice', 'note']);

/** Re-running a widget keeps its chart type. Control kinds are not chart types. */
function asChartType(kind: Card['kind']): ChartType | null {
  return CONTROL_KINDS.has(kind) ? null : (kind as ChartType);
}

function collectFilters(widgets: readonly Widget[]): FilterSelection[] {
  return widgets.flatMap((widget) =>
    widget.card.kind === 'filter' && widget.card.selected.length > 0
      ? [
          {
            table: widget.card.table,
            column: widget.card.column,
            values: widget.card.selected,
          },
        ]
      : [],
  );
}

interface WidgetFrameProps {
  widget: Widget;
  locale: Locale;
  busy: boolean;
  onRefresh: () => void;
  onEdit: (query: string) => void;
  onRemove: () => void;
  onTogglePin: () => void;
  onFilterChange: (selected: string[]) => void;
}

function WidgetFrame({
  widget,
  locale,
  busy,
  onRefresh,
  onEdit,
  onRemove,
  onTogglePin,
  onFilterChange,
}: WidgetFrameProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [draft, setDraft] = useState(widget.query ?? '');

  return (
    <div
      className={`card bg-base-100 border-base-300 relative flex h-full flex-col border ${
        // While editing, the panel is allowed to grow past the widget: a KPI is
        // four rows tall and its DAX would otherwise be a two-line sliver.
        editing ? 'z-20' : 'overflow-hidden'
      }`}
    >
      <div className="widget-drag-handle border-base-300 flex cursor-move items-center gap-1 border-b px-3 py-1.5">
        <span className="flex-1 truncate text-xs font-semibold" title={widget.card.title ?? ''}>
          {widget.card.title ?? widget.card.kind}
        </span>

        {/* The header doubles as the drag handle, so its controls keep their
            pointer down to themselves: otherwise using one drags the widget. */}
        {widget.pinned && (
          <Tooltip label={t('dashboards.unpin')}>
            <button
              type="button"
              className="btn btn-ghost btn-square btn-xs text-primary"
              aria-label={t('dashboards.unpin')}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={onTogglePin}
            >
              <IconLock size={14} stroke={1.75} />
            </button>
          </Tooltip>
        )}

        <Menu
          label={t('common.actions')}
          trigger={
            <button
              type="button"
              className="btn btn-ghost btn-square btn-xs cursor-pointer"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <IconDots size={14} stroke={1.75} />
            </button>
          }
        >
          <MenuItem onSelect={onTogglePin}>
            {widget.pinned ? (
              <IconLockOpen size={14} stroke={1.75} />
            ) : (
              <IconLock size={14} stroke={1.75} />
            )}
            {widget.pinned ? t('dashboards.unpin') : t('dashboards.pin')}
          </MenuItem>

          {widget.query && (
            <>
              <MenuItem onSelect={onRefresh}>
                <IconRefresh size={14} stroke={1.75} />
                {t('dashboards.refresh')}
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  setDraft(widget.query ?? '');
                  setEditing(true);
                }}
              >
                <IconPencil size={14} stroke={1.75} />
                {t('dashboards.edit')}
              </MenuItem>
            </>
          )}

          <MenuItem destructive onSelect={() => setConfirmingRemove(true)}>
            <IconTrash size={14} stroke={1.75} />
            {t('dashboards.remove')}
          </MenuItem>
        </Menu>
      </div>

      {widget.card.subtitle && (
        <p className="text-base-content/60 px-3 pt-1 text-[11px]">{widget.card.subtitle}</p>
      )}

      <div className="min-h-0 flex-1 p-3">
        {editing ? (
          <div className="bg-base-100 border-base-300 rounded-box absolute inset-x-0 top-9 bottom-0 flex min-h-72 flex-col gap-2 border-x border-b p-3 shadow-lg">
            <textarea
              className="textarea textarea-bordered min-h-16 shrink-0 text-xs"
              value={draft}
              // Focus follows the editor the user just opened, rather than
              // autoFocus, which would also steal focus on mount.
              ref={(element) => element?.focus()}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(false);
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  setEditing(false);
                  onEdit(draft.trim());
                }
              }}
            />

            {/* The DAX sits under the question that generated it: editing one
                shows what the other produced. */}
            <div className="flex min-h-0 flex-1 flex-col gap-1">
              <span className="text-base-content/50 text-[10px] font-semibold tracking-wide uppercase">
                {t('dashboards.dax')}
              </span>
              {widget.dax ? (
                <pre className="bg-base-200 min-h-0 flex-1 overflow-auto rounded-box p-2 text-[10px] leading-relaxed">
                  <code>{widget.dax}</code>
                </pre>
              ) : (
                <p className="text-base-content/50 text-[11px]">
                  {CONTROL_KINDS.has(widget.card.kind)
                    ? t('dashboards.daxNotApplicable')
                    : t('dashboards.noDax')}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setEditing(false)}
              >
                {t('dashboards.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-xs"
                onClick={() => {
                  setEditing(false);
                  onEdit(draft.trim());
                }}
              >
                {t('dashboards.run')}
              </button>
            </div>
          </div>
        ) : busy ? (
          <div className="flex h-full items-center justify-center">
            <span className="loading loading-dots loading-sm" />
          </div>
        ) : (
          <CardView card={widget.card} locale={locale} onFilterChange={onFilterChange} />
        )}
      </div>

      <ConfirmDialog
        open={confirmingRemove}
        title={t('dashboards.confirmRemoveTitle')}
        body={t('dashboards.confirmRemoveBody', {
          title: widget.card.title ?? widget.card.kind,
        })}
        confirmLabel={t('dashboards.remove')}
        onConfirm={onRemove}
        onCancel={() => setConfirmingRemove(false)}
      />
    </div>
  );
}

interface Props {
  dashboard: Dashboard;
  locale: Locale;
}

export function DashboardCanvas({ dashboard, locale }: Props) {
  const { t } = useTranslation();
  const { width, containerRef } = useContainerWidth();

  const [busyWidgets, setBusyWidgets] = useState<ReadonlySet<string>>(new Set());
  const filterTimer = useRef<number | undefined>(undefined);

  const saveLayouts = useSaveLayouts(dashboard.id);
  const updateWidget = useUpdateWidget(dashboard.id);
  const removeWidget = useRemoveWidget(dashboard.id);
  const addWidget = useAddWidget(dashboard.id);
  const runQuery = useRunQuery();

  const widgets = dashboard.widgets;

  const layout: Layout = useMemo(
    () =>
      widgets.map((widget) => ({
        i: widget.id,
        x: widget.layout.x,
        y: widget.layout.y,
        w: widget.layout.width,
        h: widget.layout.height,
        static: widget.pinned,
      })),
    [widgets],
  );

  const markBusy = useCallback((id: string, busy: boolean) => {
    setBusyWidgets((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const rerun = useCallback(
    async (widget: Widget, filters: FilterSelection[], query?: string) => {
      const text = query ?? widget.query;
      if (!text) return;

      markBusy(widget.id, true);
      try {
        const result = await runQuery.mutateAsync({
          datasetId: dashboard.datasetId,
          text,
          locale,
          filters,
          forcedChartType: asChartType(widget.card.kind),
        });

        if (result.card) {
          await updateWidget.mutateAsync({
            widgetId: widget.id,
            card: result.card,
            dax: result.dax,
            ...(query ? { query } : {}),
          });
        }
      } finally {
        markBusy(widget.id, false);
      }
    },
    [dashboard.datasetId, locale, markBusy, runQuery, updateWidget],
  );

  /** A slicer change re-executes every other widget with the new filter context. */
  const scheduleFilterRun = useCallback(() => {
    window.clearTimeout(filterTimer.current);
    filterTimer.current = window.setTimeout(() => {
      const filters = collectFilters(widgets);

      for (const widget of widgets) {
        if (widget.card.kind === 'filter' || !widget.query) continue;
        void rerun(widget, filters);
      }
    }, FILTER_DEBOUNCE_MS);
  }, [rerun, widgets]);

  useEffect(() => () => window.clearTimeout(filterTimer.current), []);

  const activeFilters = collectFilters(widgets);

  const ask = async (text: string) => {
    const result = await runQuery.mutateAsync({
      datasetId: dashboard.datasetId,
      text,
      locale,
      filters: activeFilters,
      forcedChartType: null,
    });

    const card: Card = result.card ?? {
      kind: 'note',
      title: text,
      subtitle: null,
      text: result.text || '—',
    };
    const size = DEFAULT_WIDGET_SIZE[card.kind];
    const nextY = widgets.reduce(
      (lowest, widget) => Math.max(lowest, widget.layout.y + widget.layout.height),
      0,
    );

    await addWidget.mutateAsync({
      card,
      query: result.card ? text : null,
      dax: result.card ? result.dax : null,
      layout: { x: 0, y: nextY, width: size.width, height: size.height },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-base-300 flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 print:hidden">
        <h2 className="flex-1 text-sm font-semibold">{dashboard.name}</h2>

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-base-content/60 text-xs">{t('dashboards.filters')}:</span>
            {widgets.map((widget) => {
              const filter = widget.card.kind === 'filter' ? widget.card : null;
              if (!filter || filter.selected.length === 0) return null;

              return (
                <button
                  key={widget.id}
                  type="button"
                  className="badge badge-primary badge-sm gap-1"
                  title={filter.selected.join(', ')}
                  onClick={() => {
                    void updateWidget
                      .mutateAsync({
                        widgetId: widget.id,
                        card: {
                          ...filter,
                          selected: [],
                        },
                      })
                      .then(scheduleFilterRun);
                  }}
                >
                  {filter.title}: {filter.selected.length} ×
                </button>
              );
            })}
          </div>
        )}

        <button type="button" className="btn btn-ghost btn-xs" onClick={() => window.print()}>
          {t('dashboards.export')}
        </button>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto p-2">
        {widgets.length === 0 ? (
          <p className="text-base-content/60 p-8 text-center text-sm">{t('dashboards.empty')}</p>
        ) : (
          <GridLayout
            className="layout"
            width={width}
            gridConfig={{ cols: COLUMNS, rowHeight: ROW_HEIGHT }}
            dragConfig={{ handle: '.widget-drag-handle' }}
            layout={layout}
            onLayoutChange={(next) => {
              saveLayouts.mutate(
                next.map((item) => ({
                  id: item.i,
                  x: item.x,
                  y: item.y,
                  width: item.w,
                  height: item.h,
                })),
              );
            }}
          >
            {widgets.map((widget) => (
              <div key={widget.id}>
                <WidgetFrame
                  widget={widget}
                  locale={locale}
                  busy={busyWidgets.has(widget.id)}
                  onRefresh={() => void rerun(widget, activeFilters)}
                  onEdit={(query) => void rerun(widget, activeFilters, query)}
                  onRemove={() => removeWidget.mutate(widget.id)}
                  onTogglePin={() =>
                    updateWidget.mutate({
                      widgetId: widget.id,
                      pinned: !widget.pinned,
                    })
                  }
                  onFilterChange={(selected) => {
                    const filter = widget.card.kind === 'filter' ? widget.card : null;
                    if (!filter) return;

                    void updateWidget
                      .mutateAsync({
                        widgetId: widget.id,
                        card: { ...filter, selected },
                      })
                      .then(scheduleFilterRun);
                  }}
                />
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      <Prompt
        onSubmit={(text) => void ask(text)}
        busy={runQuery.isPending}
        icon={<IconPlus size={18} stroke={1.75} />}
        label={t('dashboards.add')}
      />
    </div>
  );
}
