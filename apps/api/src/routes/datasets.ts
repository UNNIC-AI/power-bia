import {
  type DatasetSummary,
  datasetContextSchema,
  datasetSettingsInputSchema,
  datasetSummarySchema,
  errorSchema,
  introspectionReportSchema,
  localeSchema,
} from '@powerbia/contracts';
import { schema } from '@powerbia/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAdmin, requireUser } from '../app.js';
import { loadDatasetContext } from '../datasets/context.js';
import { findActiveDataset } from '../datasets/provision.js';
import { generateDatasetContext, syncDataset } from '../datasets/sync.js';

const localeBody = z.object({ locale: localeSchema.optional() }).optional();

type DatasetRow = typeof schema.datasets.$inferSelect;

function toSummary(
  dataset: DatasetRow,
  counts: { tables: number; measures: number },
): DatasetSummary {
  return {
    id: dataset.id,
    name: dataset.name,
    description: dataset.description,
    extraContext: dataset.extraContext,
    extraContextGeneratedAt: dataset.extraContextGeneratedAt?.toISOString() ?? null,
    starters: dataset.starters,
    source: { workspaceName: dataset.workspaceName, datasetName: dataset.datasetName },
    dateRange: { min: dataset.dateMin, max: dataset.dateMax },
    tableCount: counts.tables,
    measureCount: counts.measures,
    lastIntrospectedAt: dataset.lastIntrospectedAt?.toISOString() ?? null,
  };
}

async function loadSummary(
  app: FastifyInstance,
  datasetId: string,
): Promise<DatasetSummary | null> {
  const dataset = await app.db.query.datasets.findFirst({
    where: eq(schema.datasets.id, datasetId),
    with: { tables: true, measures: true },
  });
  if (!dataset) return null;

  return toSummary(dataset, {
    tables: dataset.tables.length,
    measures: dataset.measures.length,
  });
}

/**
 * The model, singular.
 *
 * There is no id in any of these paths and no route to create, connect, list or
 * delete a dataset. The Power BI source comes from `PBI_*` in the environment
 * and is written into the row on boot by `provisionDatasetFromEnv`; the server
 * resolves which row that is, so a client cannot ask for a different one. What
 * is left here is the curated layer, plus the two actions that re-read the model.
 */
export async function datasetRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get(
    '/',
    { schema: { response: { 200: datasetSummarySchema, 404: errorSchema } } },
    async (request, reply) => {
      requireUser(request);

      const dataset = await findActiveDataset(app.db);
      if (!dataset) return reply.code(404).send({ message: 'No model configured' });

      const summary = await loadSummary(app, dataset.id);
      if (!summary) return reply.code(404).send({ message: 'No model configured' });

      return summary;
    },
  );

  route.get(
    '/context',
    { schema: { response: { 200: datasetContextSchema, 404: errorSchema } } },
    async (request, reply) => {
      requireUser(request);

      const dataset = await findActiveDataset(app.db);
      if (!dataset) return reply.code(404).send({ message: 'No model configured' });

      const context = await loadDatasetContext(app.db, dataset.id);
      if (!context) return reply.code(404).send({ message: 'No model configured' });

      return context;
    },
  );

  /** The curated layer an admin can edit: prose about the model. */
  route.patch(
    '/',
    {
      schema: {
        body: datasetSettingsInputSchema,
        response: { 200: datasetSummarySchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      requireAdmin(request);
      const { description, extraContext } = request.body;

      const active = await findActiveDataset(app.db);
      if (!active) return reply.code(404).send({ message: 'No model configured' });

      const [dataset] = await app.db
        .update(schema.datasets)
        .set({
          ...(description === undefined ? {} : { description }),
          /*
           * Saved prose is the admin's, so the "written by the assistant" stamp
           * is dropped: the dialog must never label a person's words as
           * generated, and the sync only auto-writes an empty field anyway.
           */
          ...(extraContext === undefined ? {} : { extraContext, extraContextGeneratedAt: null }),
        })
        .where(eq(schema.datasets.id, active.id))
        .returning();

      if (!dataset) return reply.code(404).send({ message: 'No model configured' });

      const summary = await loadSummary(app, dataset.id);
      if (!summary) return reply.code(404).send({ message: 'No model configured' });

      return summary;
    },
  );

  /** Re-reads the model from Power BI. Also writes its context if it has none. */
  route.post(
    '/introspect',
    {
      schema: {
        body: localeBody,
        response: { 200: introspectionReportSchema, 404: errorSchema, 422: errorSchema },
      },
    },
    async (request, reply) => {
      requireAdmin(request);

      const dataset = await findActiveDataset(app.db);
      if (!dataset) return reply.code(404).send({ message: 'No model configured' });

      try {
        return await syncDataset({
          db: app.db,
          executor: app.executor,
          datasetId: dataset.id,
          locale: request.body?.locale,
          log: app.log,
        });
      } catch (cause) {
        /*
         * 422, matching what the gateway returns for a DAX failure: the request
         * was well formed, the model could not be read. The message is Power BI's
         * own text and is the only diagnostic the admin gets.
         */
        const message = cause instanceof Error ? cause.message : String(cause);
        app.log.error({ cause, dataset: dataset.name }, 'introspection failed');

        return reply.code(422).send({ message });
      }
    },
  );

  /**
   * Rewrites the model's context from the catalogue, replacing what is there.
   * The admin asks for this after the model changed, or when the draft they are
   * editing has drifted too far from the model to be worth fixing by hand.
   */
  route.post(
    '/context',
    {
      schema: {
        body: localeBody,
        response: { 200: datasetSummarySchema, 404: errorSchema, 422: errorSchema },
      },
    },
    async (request, reply) => {
      requireAdmin(request);

      const active = await findActiveDataset(app.db);
      if (!active) return reply.code(404).send({ message: 'No model configured' });

      try {
        await generateDatasetContext({
          db: app.db,
          datasetId: active.id,
          locale: request.body?.locale,
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (message === 'Dataset not found') return reply.code(404).send({ message });

        app.log.error({ cause, datasetId: active.id }, 'context generation failed');

        return reply.code(422).send({ message });
      }

      const summary = await loadSummary(app, active.id);
      if (!summary) return reply.code(404).send({ message: 'No model configured' });

      return summary;
    },
  );
}
