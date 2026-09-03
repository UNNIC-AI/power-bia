import { type Database, encryptSecret, schema } from '@powerbia/db';
import { asc, eq } from 'drizzle-orm';
import { env } from '../env.js';
import { type PowerBiSource, pointsElsewhere, selectActiveRow } from './source.js';

type DatasetRow = typeof schema.datasets.$inferSelect;

/**
 * The Power BI source lives in the environment and nowhere else.
 *
 * The MVP - and this app until now - let an admin type a connection into the UI,
 * which meant two authorities for the same fact: a `.env` nobody trusted and a
 * database row nobody could see. Now the row is a projection of the environment,
 * rewritten on every boot, and the UI has no way to change it. Editing `.env`
 * and restarting is the whole switching procedure.
 *
 * The five values are a unit: a partial connection cannot be used at all.
 */
export function powerBiSource(): PowerBiSource | null {
  const source = {
    tenantId: env.PBI_TENANT_ID.trim(),
    clientId: env.PBI_CLIENT_ID.trim(),
    clientSecret: env.PBI_CLIENT_SECRET.trim(),
    workspaceName: env.PBI_WORKSPACE_NAME.trim(),
    datasetName: env.PBI_DATASET_NAME.trim(),
  };

  if (Object.values(source).some((value) => value === '')) return null;

  return { ...source, modelName: env.PBI_MODEL_NAME.trim() || source.datasetName };
}

/** Every dataset row, oldest first. The order is what makes reuse deterministic. */
async function allDatasets(db: Database): Promise<DatasetRow[]> {
  return db
    .select()
    .from(schema.datasets)
    .orderBy(asc(schema.datasets.createdAt), asc(schema.datasets.id));
}

/**
 * The single model the whole app talks to.
 *
 * Every route resolves the dataset through this rather than taking an id from
 * the client: the source is the environment's to name, so a request cannot ask
 * for a different one. Undefined only before the first boot has provisioned a
 * row, or in a database that was never migrated with a seed.
 */
export async function findActiveDataset(db: Database): Promise<DatasetRow | undefined> {
  return selectActiveRow(await allDatasets(db), powerBiSource());
}

export type ProvisionOutcome =
  | { status: 'unconfigured' }
  /** The environment names a model no row pointed at yet. */
  | { status: 'created'; datasetId: string; name: string }
  /** The environment now names a different model: the old catalogue is gone. */
  | { status: 'repointed'; datasetId: string; name: string; from: string }
  /** Same model, credentials and display name refreshed from the environment. */
  | { status: 'synced'; datasetId: string; name: string };

/**
 * Brings the dataset row in line with `PBI_*`. Runs before the startup catalogue
 * refresh, so a source that just changed is introspected in the same boot.
 */
export async function provisionDatasetFromEnv(db: Database): Promise<ProvisionOutcome> {
  const source = powerBiSource();
  if (!source) return { status: 'unconfigured' };

  /*
   * Prefer the row already pointing at this model; otherwise reuse the oldest
   * one. Reuse rather than insert-and-forget is deliberate: conversations,
   * dashboards and the curated column notes all hang off the dataset id, and a
   * fresh row on every source change would orphan the lot.
   */
  const existing = selectActiveRow(await allDatasets(db), source);

  const credentials = {
    name: source.modelName,
    tenantId: source.tenantId,
    clientId: source.clientId,
    clientSecretEncrypted: encryptSecret(source.clientSecret, env.DATASET_SECRET_KEY),
    workspaceName: source.workspaceName,
    datasetName: source.datasetName,
  };

  if (!existing) {
    const [created] = await db
      .insert(schema.datasets)
      .values({
        ...credentials,
        /*
         * A placeholder range, overwritten by the introspection this provisioning
         * triggers. The column is not nullable and the real range is a fact about
         * the model, not something anyone types.
         */
        dateMin: '1900-01-01',
        dateMax: '1900-01-01',
      })
      .returning();
    if (!created) throw new Error('Could not create the dataset row');

    return { status: 'created', datasetId: created.id, name: created.name };
  }

  const previous = `${existing.workspaceName}/${existing.datasetName}`;
  const repointed = pointsElsewhere(existing, source);

  await db.transaction(async (tx) => {
    await tx
      .update(schema.datasets)
      .set({
        ...credentials,
        /*
         * Nulling `lastIntrospectedAt` is what re-introspects the new model: the
         * startup refresh treats a missing timestamp as stale. The generated
         * context goes too - it described the previous model.
         */
        ...(repointed
          ? {
              description: '',
              extraContext: '',
              extraContextGeneratedAt: null,
              lastIntrospectedAt: null,
            }
          : {}),
      })
      .where(eq(schema.datasets.id, existing.id));

    if (!repointed) return;

    // Columns go with their table through the FK cascade.
    await tx.delete(schema.datasetTables).where(eq(schema.datasetTables.datasetId, existing.id));
    await tx
      .delete(schema.datasetMeasures)
      .where(eq(schema.datasetMeasures.datasetId, existing.id));
    await tx
      .delete(schema.datasetRelationships)
      .where(eq(schema.datasetRelationships.datasetId, existing.id));
    await tx
      .delete(schema.datasetSynonyms)
      .where(eq(schema.datasetSynonyms.datasetId, existing.id));
  });

  return repointed
    ? { status: 'repointed', datasetId: existing.id, name: source.modelName, from: previous }
    : { status: 'synced', datasetId: existing.id, name: source.modelName };
}

/**
 * Rows the environment does not point at.
 *
 * Provisioning reuses the oldest row rather than inserting, so these only exist
 * in a database that predates that rule. They are unreachable - nothing in the
 * API can select them - and are reported rather than deleted, because a stale
 * row still owns somebody's conversations and dashboards.
 */
export async function findOrphanedDatasets(
  db: Database,
  activeId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await allDatasets(db);

  return rows.filter((row) => row.id !== activeId).map((row) => ({ id: row.id, name: row.name }));
}
