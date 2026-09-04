import {
  type Card,
  createDashboardSchema,
  createWidgetSchema,
  DEFAULT_WIDGET_SIZE,
  dashboardSchema,
  dashboardSummarySchema,
  errorSchema,
  regenerateTitleSchema,
  renameDashboardSchema,
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
import { findActiveDataset } from '../datasets/provision.js';
import { retitleDashboard } from '../pipeline/retitle.js';

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

  /**
   * A free row below everything already on the dashboard, at the card's default
   * size. The grid packs upwards on its own, so this only has to be clear - it
   * does not have to be tight.
   */
  async function appendPosition(dashboardId: string, card: Card) {
    const existing = await app.db.query.widgets.findMany({
      where: eq(schema.widgets.dashboardId, dashboardId),
      columns: { y: true, height: true },
    });

    const y = existing.reduce((lowest, widget) => Math.max(lowest, widget.y + widget.height), 0);

    return { x: 0, y, ...DEFAULT_WIDGET_SIZE[card.kind] };
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

      return dashboards.map(({ id, name, createdAt, widgets }) => ({
        id,
        name,
        createdAt: createdAt.toISOString(),
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

  route.post(
    '/',
    {
      schema: {
        body: createDashboardSchema,
        response: { 200: dashboardSchema, 404: errorSchema, 500: errorSchema },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);

      // A view belongs to the one model the environment names; the client cannot pick.
      const active = await findActiveDataset(app.db);
      if (!active) return reply.code(404).send({ message: 'No model configured' });

      const [dashboard] = await app.db
        .insert(schema.dashboards)
        .values({ name: request.body.name, datasetId: active.id, userId: user.id })
        .returning();
      if (!dashboard) return reply.code(500).send({ message: 'Could not create dashboard' });

      return { ...dashboard, widgets: [] };
    },
  );

  route.patch(
    '/:id',
    {
      schema: {
        params: dashboardParams,
        body: renameDashboardSchema,
        response: { 200: dashboardSummarySchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);

      const [updated] = await app.db
        .update(schema.dashboards)
        .set({ name: request.body.name })
        .where(
          and(eq(schema.dashboards.id, request.params.id), eq(schema.dashboards.userId, user.id)),
        )
        .returning();
      if (!updated) return reply.code(404).send({ message: 'Dashboard not found' });

      const widgetCount = await app.db.$count(
        schema.widgets,
        eq(schema.widgets.dashboardId, updated.id),
      );

      return {
        id: updated.id,
        name: updated.name,
        createdAt: updated.createdAt.toISOString(),
        widgetCount,
      };
    },
  );

  route.post(
    '/:id/name',
    {
      schema: {
        params: dashboardParams,
        body: regenerateTitleSchema,
        response: { 200: dashboardSummarySchema, 404: errorSchema, 502: errorSchema },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);

      const dashboard = await ownedDashboard(user.id, request.params.id);
      if (!dashboard) return reply.code(404).send({ message: 'Dashboard not found' });

      try {
        // A view with no widgets has nothing to summarise: `retitleDashboard`
        // returns null and the placeholder name stands.
        const name = await retitleDashboard({
          db: app.db,
          dashboardId: dashboard.id,
          datasetId: dashboard.datasetId,
          locale: request.body.locale,
        });

        const widgetCount = await app.db.$count(
          schema.widgets,
          eq(schema.widgets.dashboardId, dashboard.id),
        );

        return {
          id: dashboard.id,
          name: name ?? dashboard.name,
          createdAt: dashboard.createdAt.toISOString(),
          widgetCount,
        };
      } catch (error) {
        app.log.warn({ err: error, dashboardId: dashboard.id }, 'retitle failed');

        return reply.code(502).send({ message: 'Could not generate a name' });
      }
    },
  );

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
      const placement = layout ?? (await appendPosition(request.params.id, card));

      const [widget] = await app.db
        .insert(schema.widgets)
        .values({ dashboardId: request.params.id, card, query, dax, ...placement })
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
