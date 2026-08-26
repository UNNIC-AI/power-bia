import type {
  Card,
  ChartType,
  Dashboard,
  FilterSelection,
  Locale,
  Widget,
} from '@powerbia/contracts';
import { DEFAULT_WIDGET_SIZE } from '@powerbia/contracts';
import { IconLock, IconLockOpen, IconPencil, IconRefresh, IconX } from '@tabler/icons-react';
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
import { CardView } from '../cards/CardView.tsx';

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
      ? [{ table: widget.card.table, column: widget.card.column, values: widget.card.selected }]
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
  const [draft, setDraft] = useState(widget.query ?? '');

  return (
    <div className="card bg-base-100 border-base-300 flex h-full flex-col overflow-hidden border">
      <div className="widget-drag-handle border-base-300 flex cursor-move items-center gap-1 border-b px-3 py-1.5">
        <span className="flex-1 truncate text-xs font-semibold" title={widget.card.title ?? ''}>
          {widget.card.title ?? widget.card.kind}
        </span>

        <button
          type="button"
          className={`btn btn-ghost btn-square btn-xs ${widget.pinned ? 'text-primary' : ''}`}
          title={widget.pinned ? t('dashboards.unpin') : t('dashboards.pin')}
          aria-label={widget.pinned ? t('dashboards.unpin') : t('dashboards.pin')}
          onClick={onTogglePin}
        >
          {widget.pinned ? (
            <IconLock size={14} stroke={1.75} />
          ) : (
            <IconLockOpen size={14} stroke={1.75} />
          )}
        </button>

        {widget.query && (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-square btn-xs"
              title={t('dashboards.refresh')}
              aria-label={t('dashboards.refresh')}
              onClick={onRefresh}
            >
              <IconRefresh size={14} stroke={1.75} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-square btn-xs"
              title={t('dashboards.edit')}
              aria-label={t('dashboards.edit')}
              onClick={() => {
                setDraft(widget.query ?? '');
                setEditing(true);
              }}
            >
              <IconPencil size={14} stroke={1.75} />
            </button>
          </>
        )}

        <button
          type="button"
          className="btn btn-ghost btn-square btn-xs"
          title={t('dashboards.remove')}
          aria-label={t('dashboards.remove')}
          onClick={onRemove}
        >
          <IconX size={14} stroke={1.75} />
        </button>
      </div>

      {widget.card.subtitle && (
        <p className="text-base-content/60 px-3 pt-1 text-[11px]">{widget.card.subtitle}</p>
      )}

      <div className="min-h-0 flex-1 p-3">
        {editing ? (
          <div className="flex h-full flex-col gap-2">
            <textarea
              className="textarea textarea-bordered min-h-0 flex-1 text-xs"
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

  const [question, setQuestion] = useState('');
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

  const ask = async () => {
    const text = question.trim();
    if (!text) return;
    setQuestion('');

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
                        card: { ...filter, selected: [] },
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
                    updateWidget.mutate({ widgetId: widget.id, pinned: !widget.pinned })
                  }
                  onFilterChange={(selected) => {
                    const filter = widget.card.kind === 'filter' ? widget.card : null;
                    if (!filter) return;

                    void updateWidget
                      .mutateAsync({ widgetId: widget.id, card: { ...filter, selected } })
                      .then(scheduleFilterRun);
                  }}
                />
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      <div className="border-base-300 shrink-0 border-t p-3 print:hidden">
        <div className="flex gap-2">
          <input
            className="input input-bordered input-sm w-full"
            placeholder={t('dashboards.askPlaceholder')}
            value={question}
            disabled={runQuery.isPending}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void ask();
            }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={runQuery.isPending || !question.trim()}
            onClick={() => void ask()}
          >
            {runQuery.isPending ? <span className="loading loading-spinner loading-xs" /> : '+'}
          </button>
        </div>
      </div>
    </div>
  );
}
