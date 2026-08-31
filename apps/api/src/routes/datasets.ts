import {
  type DatasetSummary,
  datasetConnectionInputSchema,
  datasetContextSchema,
  datasetSettingsInputSchema,
  datasetSummarySchema,
  errorSchema,
  introspectionReportSchema,
} from '@powerbia/contracts';
import { encryptSecret, schema } from '@powerbia/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAdmin, requireUser } from '../app.js';
import { loadDatasetContext } from '../datasets/context.js';
import { introspectDataset } from '../datasets/introspect.js';
import { env } from '../env.js';

const paramsSchema = z.object({ id: z.uuid() });

type DatasetRow = typeof schema.datasets.$inferSelect;

async function toSummary(app: FastifyInstance, dataset: DatasetRow): Promise<DatasetSummary> {
  const [tables, measures] = await Promise.all([
    app.db
      .select({ id: schema.datasetTables.id })
      .from(schema.datasetTables)
      .where(eq(schema.datasetTables.datasetId, dataset.id)),
    app.db
      .select({ id: schema.datasetMeasures.id })
      .from(schema.datasetMeasures)
      .where(eq(schema.datasetMeasures.datasetId, dataset.id)),
  ]);

  return {
    id: dataset.id,
    name: dataset.name,
    description: dataset.description,
    extraContext: dataset.extraContext,
    dateRange: { min: dataset.dateMin, max: dataset.dateMax },
    tableCount: tables.length,
    measureCount: measures.length,
    lastIntrospectedAt: dataset.lastIntrospectedAt?.toISOString() ?? null,
  };
}

export async function datasetRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get(
    '/',
    { schema: { response: { 200: z.array(datasetSummarySchema) } } },
    async (request) => {
      requireUser(request);

      const datasets = await app.db.query.datasets.findMany({
        with: { tables: true, measures: true },
      });

      return datasets.map((dataset) => ({
        id: dataset.id,
        name: dataset.name,
        description: dataset.description,
        extraContext: dataset.extraContext,
        dateRange: { min: dataset.dateMin, max: dataset.dateMax },
        tableCount: dataset.tables.length,
        measureCount: dataset.measures.length,
        lastIntrospectedAt: dataset.lastIntrospectedAt?.toISOString() ?? null,
      }));
    },
  );

  route.get(
    '/:id/context',
    { schema: { params: paramsSchema, response: { 200: datasetContextSchema, 404: errorSchema } } },
    async (request, reply) => {
      requireUser(request);

      const context = await loadDatasetContext(app.db, request.params.id);
      if (!context) return reply.code(404).send({ message: 'Dataset not found' });

      return context;
    },
  );

  /**
   * Registers a Power BI connection and discovers its model straight away, so a
   * new source is usable without touching the seed script.
   */
  route.post(
    '/',
    {
      schema: {
        body: datasetConnectionInputSchema,
        response: { 201: datasetSummarySchema, 422: errorSchema },
      },
    },
    async (request, reply) => {
      requireAdmin(request);
      const input = request.body;

      /*
       * A placeholder range, immediately overwritten by the introspection below.
       * When that fails the dataset still exists with credentials the admin can
       * fix and re-sync, and the range is editable in Settings — losing the row
       * would mean typing the whole connection again.
       */
      const today = new Date().toISOString().slice(0, 10);

      const [dataset] = await app.db
        .insert(schema.datasets)
        .values({
          name: input.name,
          tenantId: input.tenantId,
          clientId: input.clientId,
          clientSecretEncrypted: encryptSecret(input.clientSecret, env.DATASET_SECRET_KEY),
          workspaceName: input.workspaceName,
          datasetName: input.datasetName,
          dateMin: today,
          dateMax: today,
        })
        .returning();
      if (!dataset) return reply.code(422).send({ message: 'Could not create dataset' });

      try {
        await introspectDataset({ db: app.db, executor: app.executor, datasetId: dataset.id });
      } catch (cause) {
        app.log.error({ cause, dataset: dataset.name }, 'introspection after create failed');
      }

      const fresh = await app.db.query.datasets.findFirst({
        where: eq(schema.datasets.id, dataset.id),
      });

      return reply.code(201).send(await toSummary(app, fresh ?? dataset));
    },
  );

  /** The curated layer an admin can edit: prose about the model and its date range. */
  route.patch(
    '/:id',
    {
      schema: {
        params: paramsSchema,
        body: datasetSettingsInputSchema,
        response: { 200: datasetSummarySchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      requireAdmin(request);
      const { description, extraContext, dateRange } = request.body;

      const [dataset] = await app.db
        .update(schema.datasets)
        .set({
          ...(description === undefined ? {} : { description }),
          ...(extraContext === undefined ? {} : { extraContext }),
          ...(dateRange === undefined ? {} : { dateMin: dateRange.min, dateMax: dateRange.max }),
        })
        .where(eq(schema.datasets.id, request.params.id))
        .returning();

      if (!dataset) return reply.code(404).send({ message: 'Dataset not found' });

      return toSummary(app, dataset);
    },
  );

  route.post(
    '/:id/introspect',
    {
      schema: {
        params: paramsSchema,
        response: { 200: introspectionReportSchema, 404: errorSchema, 422: errorSchema },
      },
    },
    async (request, reply) => {
      requireAdmin(request);

      const dataset = await app.db.query.datasets.findFirst({
        where: eq(schema.datasets.id, request.params.id),
      });
      if (!dataset) return reply.code(404).send({ message: 'Dataset not found' });

      try {
        return await introspectDataset({
          db: app.db,
          executor: app.executor,
          datasetId: dataset.id,
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

  route.delete('/:id', { schema: { params: paramsSchema } }, async (request) => {
    requireAdmin(request);

    await app.db.delete(schema.datasets).where(eq(schema.datasets.id, request.params.id));

    return { ok: true };
  });
}
