import type { DatasetSummary, Locale } from '@powerbia/contracts';
import { IconPlus, IconRefresh } from '@tabler/icons-react';
import { Collapsible, Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDataset } from '../lib/dataset-context.tsx';
import { formatDay, formatTime } from '../lib/format.ts';
import { useIntrospectDataset, useUpdateDatasetSettings } from '../lib/queries.ts';
import { ConnectModelForm } from './ConnectModelForm.tsx';
import { DateRangePicker } from './DateRangePicker.tsx';

interface Props {
  open: boolean;
  dataset: DatasetSummary | undefined;
  locale: Locale;
  onClose: () => void;
}

const SURFACE =
  'bg-base-100 border-base-300 rounded-box fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border p-6 shadow-xl';

const EXTRA_CONTEXT_LIMIT = 8_000;

/**
 * Radix `Dialog` rather than the `AlertDialog` of `ConfirmDialog`: this is a form
 * the user can dismiss, not a question that demands an answer.
 *
 * Styled from DaisyUI tokens rather than with `modal-box`, which is transparent
 * and scaled down until an enclosing `.modal` opens it — on Radix content that
 * renders a perfectly invisible dialog.
 */
export function SettingsDialog({ open, dataset, locale, onClose }: Props) {
  const { t } = useTranslation();
  const save = useUpdateDatasetSettings();
  const { select } = useDataset();
  const [connecting, setConnecting] = useState(false);
  const introspect = useIntrospectDataset();

  const [extraContext, setExtraContext] = useState('');
  const [dateMin, setDateMin] = useState('');
  const [dateMax, setDateMax] = useState('');

  /*
   * Re-seeded whenever the dialog opens or a sync rewrites the date range, so a
   * draft is never silently based on values the server has since changed.
   */
  useEffect(() => {
    if (!open || !dataset) return;

    setExtraContext(dataset.extraContext);
    setDateMin(dataset.dateRange.min);
    setDateMax(dataset.dateRange.max);
  }, [open, dataset]);

  /*
   * With no model connected there is nothing to configure — but this dialog is
   * also how the first one gets connected, so it must still open and show only
   * the connection form.
   */
  if (!dataset) {
    return (
      <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className={SURFACE}>
            <Dialog.Title className="text-base font-semibold">
              {t('settings.connectTitle')}
            </Dialog.Title>
            <Dialog.Description className="text-base-content/70 mt-1 mb-4 text-sm">
              {t('settings.connectFirstHelp')}
            </Dialog.Description>
            <div className="-mx-1 overflow-y-auto px-1">
              <ConnectModelForm onConnected={() => onClose()} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  const report = introspect.data;
  const error = save.error ?? introspect.error;
  const dirty =
    extraContext !== dataset.extraContext ||
    dateMin !== dataset.dateRange.min ||
    dateMax !== dataset.dateRange.max;

  const close = () => {
    save.reset();
    introspect.reset();
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className={SURFACE}>
          <div>
            <Dialog.Title className="text-base font-semibold">{t('settings.title')}</Dialog.Title>
            <Dialog.Description className="text-base-content/70 mt-1 text-sm">
              {dataset.name} ·{' '}
              {t('settings.counts', {
                tables: dataset.tableCount,
                measures: dataset.measureCount,
              })}
            </Dialog.Description>
            <p className="text-base-content/50 mt-1 text-xs">
              {dataset.lastIntrospectedAt
                ? t('settings.lastSync', {
                    day: formatDay(dataset.lastIntrospectedAt, locale),
                    time: formatTime(dataset.lastIntrospectedAt, locale),
                  })
                : t('settings.neverSynced')}
            </p>
          </div>

          {/*
            The only scrolling region. A tall sync report would otherwise push the
            footer off-screen, precisely when the user wants to reach Save.
          */}
          <div className="-mx-1 flex flex-1 flex-col gap-4 overflow-y-auto px-1 py-4">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t('settings.extraContext')}</span>
              <span className="text-base-content/60 text-xs">{t('settings.extraContextHelp')}</span>
              <textarea
                className="textarea textarea-bordered min-h-40 w-full text-sm"
                value={extraContext}
                maxLength={EXTRA_CONTEXT_LIMIT}
                placeholder={t('settings.extraContextPlaceholder')}
                onChange={(event) => setExtraContext(event.target.value)}
              />
              <span className="text-base-content/40 self-end text-xs">
                {extraContext.length} / {EXTRA_CONTEXT_LIMIT}
              </span>
            </label>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium">{t('settings.dateRange')}</legend>
              <span className="text-base-content/60 text-xs">{t('settings.dateRangeHelp')}</span>
              <DateRangePicker
                min={dateMin}
                max={dateMax}
                locale={locale}
                onChange={({ min, max }) => {
                  setDateMin(min);
                  setDateMax(max);
                }}
              />
            </fieldset>

            {error && (
              <div role="alert" className="alert alert-error py-2 text-sm">
                <span>{error.message}</span>
              </div>
            )}

            {report && (
              <div className="bg-base-200 rounded-box flex flex-col gap-1 p-3 text-xs">
                <span className="font-medium">
                  {t('settings.syncDone', { seconds: Math.round(report.durationMs / 1000) })}
                </span>
                <span className="text-base-content/70">
                  {t('settings.syncCounts', {
                    tables: report.tables.created + report.tables.updated,
                    columns: report.columns.created + report.columns.updated,
                    measures: report.measures.created + report.measures.updated,
                    removed:
                      report.tables.removed + report.columns.removed + report.measures.removed,
                  })}
                </span>
                {report.warnings.length > 0 && (
                  <ul className="text-warning mt-1 list-inside list-disc">
                    {report.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <Collapsible.Root
              open={connecting}
              onOpenChange={setConnecting}
              className="border-base-300 border-t pt-4"
            >
              <Collapsible.Trigger asChild>
                <button type="button" className="btn btn-ghost btn-sm -ml-2">
                  <IconPlus size={14} stroke={1.75} />
                  {t('settings.connectTitle')}
                </button>
              </Collapsible.Trigger>
              <Collapsible.Content className="pt-3">
                <ConnectModelForm
                  onConnected={(id) => {
                    select(id);
                    setConnecting(false);
                  }}
                />
              </Collapsible.Content>
            </Collapsible.Root>
          </div>

          <div className="border-base-300 flex shrink-0 items-center justify-between gap-2 border-t pt-4">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={introspect.isPending}
              onClick={() => introspect.mutate(dataset.id)}
            >
              {introspect.isPending ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <IconRefresh size={14} stroke={1.75} />
              )}
              {t('settings.sync')}
            </button>

            <div className="flex gap-2">
              <Dialog.Close asChild>
                <button type="button" className="btn btn-ghost btn-sm">
                  {t('common.cancel')}
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!dirty || save.isPending}
                onClick={() =>
                  save.mutate({
                    id: dataset.id,
                    extraContext,
                    dateRange: { min: dateMin, max: dateMax },
                  })
                }
              >
                {save.isPending && <span className="loading loading-spinner loading-xs" />}
                {t('settings.save')}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
