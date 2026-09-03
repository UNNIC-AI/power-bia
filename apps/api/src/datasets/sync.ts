import type { IntrospectionReport, Locale } from '@powerbia/contracts';
import { type Database, schema } from '@powerbia/db';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { DaxExecutor } from '../dax/executor.js';
import { env } from '../env.js';
import { describeModel } from '../pipeline/stages.js';
import { loadDatasetContext } from './context.js';
import { introspectDataset } from './introspect.js';

export interface GeneratedContext {
  description: string;
  extraContext: string;
  generatedAt: string;
}

/**
 * Has the LLM read the catalogue and write the model's documentation, replacing
 * whatever `extra_context` held.
 *
 * This is the fourth prompt layer, and until now it started as an empty textarea
 * that only an admin who knew the model could fill - so in practice it stayed
 * empty and the pipeline reasoned about tables called `TBL_VTA_CAB` with nothing
 * to go on. Generating a first draft from the catalogue means the layer exists
 * from the moment a model is connected; the admin corrects prose instead of
 * writing it.
 */
export async function generateDatasetContext(options: {
  db: Database;
  datasetId: string;
  locale?: Locale | undefined;
}): Promise<GeneratedContext> {
  const { db, datasetId, locale = env.MODEL_CONTEXT_LOCALE } = options;

  const dataset = await loadDatasetContext(db, datasetId);
  if (!dataset) throw new Error('Dataset not found');
  /*
   * Without a catalogue the model would be documenting an empty schema, which
   * produces confident prose about nothing. Introspection has to come first.
   */
  if (dataset.tables.length === 0) {
    throw new Error('The model has no catalogue yet - sync it with Power BI first');
  }

  const generated = await describeModel({ dataset, locale });
  const generatedAt = new Date();

  await db
    .update(schema.datasets)
    .set({
      // An empty generated description must not wipe a curated one.
      ...(generated.description === '' ? {} : { description: generated.description }),
      extraContext: generated.extraContext,
      extraContextGeneratedAt: generatedAt,
    })
    .where(eq(schema.datasets.id, datasetId));

  return { ...generated, generatedAt: generatedAt.toISOString() };
}

export interface SyncOptions {
  db: Database;
  executor: DaxExecutor;
  datasetId: string;
  locale?: Locale | undefined;
  log?: FastifyBaseLogger | undefined;
}

/**
 * Rediscovers the model and, when it has no documentation yet, writes it.
 *
 * The generation is deliberately not repeated on every sync: after the first run
 * the text is the admin's, and a nightly refresh that silently rewrote their
 * words would be the worst kind of helpful. Rewriting it is an explicit action.
 */
export async function syncDataset({
  db,
  executor,
  datasetId,
  locale,
  log,
}: SyncOptions): Promise<IntrospectionReport> {
  const report = await introspectDataset({ db, executor, datasetId });

  const dataset = await db.query.datasets.findFirst({
    where: eq(schema.datasets.id, datasetId),
  });
  if (dataset && dataset.extraContext.trim() !== '') return { ...report, contextGenerated: false };

  try {
    await generateDatasetContext({ db, datasetId, locale });

    return { ...report, contextGenerated: true };
  } catch (cause) {
    /*
     * A model with no OpenAI key, or a call that failed, must not turn a
     * successful introspection into an error: the catalogue is already written
     * and the admin can ask for the context again from Settings.
     */
    log?.error({ cause, datasetId }, 'could not generate the model context');

    return { ...report, contextGenerated: false };
  }
}
