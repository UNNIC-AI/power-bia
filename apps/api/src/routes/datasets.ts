import { datasetContextSchema, datasetSummarySchema, errorSchema } from '@powerbia/contracts';
import { schema } from '@powerbia/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../app.js';
import { loadDatasetContext } from '../datasets/context.js';

const paramsSchema = z.object({ id: z.uuid() });

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

  route.delete('/:id', { schema: { params: paramsSchema } }, async (request, reply) => {
    const user = requireUser(request);
    if (user.role !== 'admin') return reply.code(403).send({ message: 'Admin only' });

    await app.db.delete(schema.datasets).where(eq(schema.datasets.id, request.params.id));

    return { ok: true };
  });
}
