import {
  createDashboardSchema,
  createWidgetSchema,
  dashboardSchema,
  dashboardSummarySchema,
  errorSchema,
  updateLayoutsSchema,
  updateWidgetSchema,
  type Widget,
} from '@powerbia/contracts';
import { schema } from '@powerbia/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../app.js';

const dashboardParams = z.object({ id: z.uuid() });
const widgetParams = z.object({ id: z.uuid(), widgetId: z.uuid() });

type WidgetRow = typeof schema.widgets.$inferSelect;

function toWidget(row: WidgetRow): Widget {
  return {
    id: row.id,
    card: row.card,
    query: row.query,
    dax: row.dax,
    pinned: row.pinned,
    layout: { x: row.x, y: row.y, width: row.width, height: row.height },
  };
}

export async function dashboardRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  async function ownedDashboard(userId: string, dashboardId: string) {
    return app.db.query.dashboards.findFirst({
      where: and(eq(schema.dashboards.id, dashboardId), eq(schema.dashboards.userId, userId)),
    });
  }

  route.get(
    '/',
    { schema: { response: { 200: z.array(dashboardSummarySchema) } } },
    async (request) => {
      const user = requireUser(request);

      const dashboards = await app.db.query.dashboards.findMany({
        where: eq(schema.dashboards.userId, user.id),
        with: { widgets: true },
        orderBy: asc(schema.dashboards.createdAt),
      });

      return dashboards.map(({ id, name, datasetId, widgets }) => ({
        id,
        name,
        datasetId,
        widgetCount: widgets.length,
      }));
    },
  );

  route.get(
    '/:id',
    { schema: { params: dashboardParams, response: { 200: dashboardSchema, 404: errorSchema } } },
    async (request, reply) => {
      const user = requireUser(request);

      const dashboard = await app.db.query.dashboards.findFirst({
        where: and(
          eq(schema.dashboards.id, request.params.id),
          eq(schema.dashboards.userId, user.id),
        ),
        with: { widgets: { orderBy: asc(schema.widgets.createdAt) } },
      });
      if (!dashboard) return reply.code(404).send({ message: 'Dashboard not found' });

      return { ...dashboard, widgets: dashboard.widgets.map(toWidget) };
    },
  );

  route.post('/', { schema: { body: createDashboardSchema } }, async (request, reply) => {
    const user = requireUser(request);

    const [dashboard] = await app.db
      .insert(schema.dashboards)
      .values({ ...request.body, userId: user.id })
      .returning();
    if (!dashboard) return reply.code(500).send({ message: 'Could not create dashboard' });

    return { ...dashboard, widgets: [] };
  });

  route.delete('/:id', { schema: { params: dashboardParams } }, async (request) => {
    const user = requireUser(request);

    await app.db
      .delete(schema.dashboards)
      .where(
        and(eq(schema.dashboards.id, request.params.id), eq(schema.dashboards.userId, user.id)),
      );

    return { ok: true };
  });

  route.post(
    '/:id/widgets',
    { schema: { params: dashboardParams, body: createWidgetSchema } },
    async (request, reply) => {
      const user = requireUser(request);
      if (!(await ownedDashboard(user.id, request.params.id))) {
        return reply.code(404).send({ message: 'Dashboard not found' });
      }

      const { card, query, dax, layout } = request.body;
      const [widget] = await app.db
        .insert(schema.widgets)
        .values({ dashboardId: request.params.id, card, query, dax, ...layout })
        .returning();
      if (!widget) return reply.code(500).send({ message: 'Could not create widget' });

      return toWidget(widget);
    },
  );

  route.patch(
    '/:id/widgets/:widgetId',
    { schema: { params: widgetParams, body: updateWidgetSchema } },
    async (request, reply) => {
      const user = requireUser(request);
      if (!(await ownedDashboard(user.id, request.params.id))) {
        return reply.code(404).send({ message: 'Dashboard not found' });
      }

      const { layout, ...rest } = request.body;
      const [widget] = await app.db
        .update(schema.widgets)
        .set({ ...rest, ...layout })
        .where(
          and(
            eq(schema.widgets.id, request.params.widgetId),
            eq(schema.widgets.dashboardId, request.params.id),
          ),
        )
        .returning();
      if (!widget) return reply.code(404).send({ message: 'Widget not found' });

      return toWidget(widget);
    },
  );

  route.delete('/:id/widgets/:widgetId', { schema: { params: widgetParams } }, async (request) => {
    const user = requireUser(request);
    if (!(await ownedDashboard(user.id, request.params.id))) return { ok: true };

    await app.db
      .delete(schema.widgets)
      .where(
        and(
          eq(schema.widgets.id, request.params.widgetId),
          eq(schema.widgets.dashboardId, request.params.id),
        ),
      );

    return { ok: true };
  });

  /** One request per drag/resize gesture rather than one per frame. */
  route.put(
    '/:id/layouts',
    { schema: { params: dashboardParams, body: updateLayoutsSchema } },
    async (request, reply) => {
      const user = requireUser(request);
      if (!(await ownedDashboard(user.id, request.params.id))) {
        return reply.code(404).send({ message: 'Dashboard not found' });
      }

      const { layouts } = request.body;
      if (layouts.length === 0) return { ok: true };

      await app.db.transaction(async (tx) => {
        for (const { id, ...layout } of layouts) {
          await tx
            .update(schema.widgets)
            .set(layout)
            .where(
              and(eq(schema.widgets.id, id), eq(schema.widgets.dashboardId, request.params.id)),
            );
        }
      });

      return { ok: true };
    },
  );
}
