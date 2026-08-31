import type { DatasetConnectionInput } from '@powerbia/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateDataset } from '../lib/queries.ts';

const EMPTY: DatasetConnectionInput = {
  name: '',
  tenantId: '',
  clientId: '',
  clientSecret: '',
  workspaceName: '',
  datasetName: '',
};

/**
 * Registering a Power BI connection from the app rather than by editing the seed
 * script. The API introspects the new model before it answers, so the pending
 * state here covers several seconds of real work against the capacity.
 */
export function ConnectModelForm({ onConnected }: { onConnected: (id: string) => void }) {
  const { t } = useTranslation();
  const create = useCreateDataset();
  const [draft, setDraft] = useState<DatasetConnectionInput>(EMPTY);

  const field = (key: keyof DatasetConnectionInput) => ({
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((current) => ({ ...current, [key]: event.target.value })),
  });

  const complete = Object.values(draft).every((value) => value.trim() !== '');

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(draft, {
          onSuccess: (dataset) => {
            setDraft(EMPTY);
            onConnected(dataset.id);
          },
        });
      }}
    >
      <p className="text-base-content/60 text-xs">{t('settings.connectHelp')}</p>

      <label className="floating-label">
        <span>{t('settings.modelName')}</span>
        <input type="text" className="input input-bordered input-sm w-full" {...field('name')} />
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="floating-label">
          <span>{t('settings.workspaceName')}</span>
          <input
            type="text"
            className="input input-bordered input-sm w-full"
            {...field('workspaceName')}
          />
        </label>
        <label className="floating-label">
          <span>{t('settings.datasetName')}</span>
          <input
            type="text"
            className="input input-bordered input-sm w-full"
            {...field('datasetName')}
          />
        </label>
        <label className="floating-label">
          <span>{t('settings.tenantId')}</span>
          <input
            type="text"
            className="input input-bordered input-sm w-full"
            {...field('tenantId')}
          />
        </label>
        <label className="floating-label">
          <span>{t('settings.clientId')}</span>
          <input
            type="text"
            className="input input-bordered input-sm w-full"
            {...field('clientId')}
          />
        </label>
      </div>

      <label className="floating-label">
        <span>{t('settings.clientSecret')}</span>
        {/* Password-typed so it is not left on screen; it is encrypted at rest. */}
        <input
          type="password"
          autoComplete="off"
          className="input input-bordered input-sm w-full"
          {...field('clientSecret')}
        />
      </label>

      {create.error && (
        <div role="alert" className="alert alert-error py-2 text-sm">
          <span>{create.error.message}</span>
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary btn-sm self-start"
        disabled={!complete || create.isPending}
      >
        {create.isPending && <span className="loading loading-spinner loading-xs" />}
        {create.isPending ? t('settings.connecting') : t('settings.connect')}
      </button>
    </form>
  );
}
