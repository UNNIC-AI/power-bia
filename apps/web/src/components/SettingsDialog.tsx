import type { DatasetSummary, Locale } from '@powerbia/contracts';
import { IconRefresh, IconSparkles } from '@tabler/icons-react';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDay, formatTime } from '../lib/format.ts';
import {
  useIntrospectDataset,
  useRegenerateDatasetContext,
  useUpdateDatasetSettings,
} from '../lib/queries.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

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
 * and scaled down until an enclosing `.modal` opens it - on Radix content that
 * renders a perfectly invisible dialog.
 *
 * What this dialog does NOT do is change which Power BI model the app talks to.
 * That comes from `PBI_*` in the server environment; here it is shown read-only.
 */
export function SettingsDialog({ open, dataset, locale, onClose }: Props) {
  const { t } = useTranslation();
  const save = useUpdateDatasetSettings();
  const introspect = useIntrospectDataset();
  const regenerate = useRegenerateDatasetContext();
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);

  const [extraContext, setExtraContext] = useState('');

  /*
   * Re-seeded whenever the dialog opens or the stored text changes, so a draft is
   * never silently based on a version the server has since rewritten - which is
   * exactly what "reprocess" does.
   */
  useEffect(() => {
    if (!open || !dataset) return;

    setExtraContext(dataset.extraContext);
  }, [open, dataset]);

  /*
   * With no model connected there is nothing to configure, and no form that could
   * connect one: pointing the app at a model is an environment change plus a
   * restart. The dialog still opens and says so.
   */
  if (!dataset) {
    return (
      <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className={SURFACE}>
            <Dialog.Title className="text-base font-semibold">{t('settings.title')}</Dialog.Title>
            <Dialog.Description className="text-base-content/70 mt-1 text-sm">
              {t('settings.noDataset')}
            </Dialog.Description>
            <p className="text-base-content/60 mt-3 text-xs">{t('settings.sourceHelp')}</p>
            <div className="mt-6 flex justify-end">
              <Dialog.Close asChild>
                <button type="button" className="btn btn-ghost btn-sm">
                  {t('common.close')}
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  const report = introspect.data;
  const error = save.error ?? introspect.error ?? regenerate.error;
  const dirty = extraContext !== dataset.extraContext;
  const busy = introspect.isPending || regenerate.isPending;

  const close = () => {
    save.reset();
    introspect.reset();
    regenerate.reset();
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
              {dataset.name} -{' '}
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
            <div className="bg-base-200 rounded-box flex flex-col gap-1 p-3">
              <span className="text-sm font-medium">{t('settings.source')}</span>
              <span className="font-mono text-xs">
                {dataset.source.workspaceName || '-'} / {dataset.source.datasetName || '-'}
              </span>
              <span className="text-base-content/60 text-xs">{t('settings.sourceHelp')}</span>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t('settings.extraContext')}</span>
              <span className="text-base-content/60 text-xs">{t('settings.extraContextHelp')}</span>
              <textarea
                className="textarea textarea-bordered min-h-56 w-full text-sm"
                value={extraContext}
                maxLength={EXTRA_CONTEXT_LIMIT}
                placeholder={t('settings.extraContextPlaceholder')}
                onChange={(event) => setExtraContext(event.target.value)}
              />
              <span className="flex items-center justify-between gap-2 text-xs">
                <span className="text-base-content/50">
                  {/* Blank while the field has never been written, by anyone. */}
                  {dataset.extraContextGeneratedAt
                    ? t('settings.contextGeneratedAt', {
                        day: formatDay(dataset.extraContextGeneratedAt, locale),
                        time: formatTime(dataset.extraContextGeneratedAt, locale),
                      })
                    : dataset.extraContext.trim() === ''
                      ? ''
                      : t('settings.contextEdited')}
                </span>
                <span className="text-base-content/40">
                  {extraContext.length} / {EXTRA_CONTEXT_LIMIT}
                </span>
              </span>
            </label>

            <div className="flex flex-col gap-1">
              <button
                type="button"
                className="btn btn-ghost btn-sm self-start"
                disabled={busy}
                onClick={() => setConfirmingRegenerate(true)}
              >
                {regenerate.isPending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <IconSparkles size={14} stroke={1.75} />
                )}
                {regenerate.isPending ? t('settings.reprocessing') : t('settings.reprocess')}
              </button>
              <span className="text-base-content/60 text-xs">{t('settings.reprocessHelp')}</span>
            </div>

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
                {report.contextGenerated && (
                  <span className="text-base-content/70">{t('settings.syncWroteContext')}</span>
                )}
                {report.warnings.length > 0 && (
                  <ul className="text-warning mt-1 list-inside list-disc">
                    {report.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="border-base-300 flex shrink-0 items-center justify-between gap-2 border-t pt-4">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => introspect.mutate({ locale })}
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
                onClick={() => save.mutate({ extraContext })}
              >
                {save.isPending && <span className="loading loading-spinner loading-xs" />}
                {t('settings.save')}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      {/* Reprocessing throws away whatever is in the field, edits included. */}
      <ConfirmDialog
        open={confirmingRegenerate}
        title={t('settings.reprocess')}
        body={t('settings.reprocessConfirm')}
        confirmLabel={t('settings.reprocess')}
        onCancel={() => setConfirmingRegenerate(false)}
        onConfirm={() => {
          setConfirmingRegenerate(false);
          regenerate.mutate({ locale });
        }}
      />
    </Dialog.Root>
  );
}
