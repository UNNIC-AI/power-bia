import { z } from 'zod';
import { cardSchema } from './cards.js';

/** Units are react-grid-layout cells on a 12-column grid, not pixels. */
export const widgetLayoutSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});

export const widgetSchema = z.object({
  id: z.uuid(),
  card: cardSchema,
  /** The question that produced this card, so the widget can be recomputed. */
  query: z.string().nullable(),
  /** The DAX that question generated, shown next to it in the edit panel. */
  dax: z.string().nullable(),
  layout: widgetLayoutSchema,
  pinned: z.boolean(),
});

export const dashboardSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  datasetId: z.uuid(),
  widgets: z.array(widgetSchema),
});

export const dashboardSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  datasetId: z.uuid(),
  widgetCount: z.number().int(),
  createdAt: z.iso.datetime(),
});

export const createDashboardSchema = z.object({
  name: z.string().min(1).max(120),
  datasetId: z.uuid(),
});

export const renameDashboardSchema = z.object({ name: z.string().min(1).max(120) });

export const createWidgetSchema = z.object({
  card: cardSchema,
  query: z.string().nullable().default(null),
  dax: z.string().nullable().default(null),
  layout: widgetLayoutSchema,
});

export const updateWidgetSchema = z.object({
  card: cardSchema.optional(),
  query: z.string().nullable().optional(),
  dax: z.string().nullable().optional(),
  layout: widgetLayoutSchema.optional(),
  pinned: z.boolean().optional(),
});

/** Batched on drag/resize so a gesture is one request, not one per frame. */
export const updateLayoutsSchema = z.object({
  layouts: z.array(widgetLayoutSchema.extend({ id: z.uuid() })),
});

export type WidgetLayout = z.infer<typeof widgetLayoutSchema>;
export type Widget = z.infer<typeof widgetSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type CreateDashboard = z.infer<typeof createDashboardSchema>;
export type RenameDashboard = z.infer<typeof renameDashboardSchema>;
export type CreateWidget = z.infer<typeof createWidgetSchema>;
export type UpdateWidget = z.infer<typeof updateWidgetSchema>;
export type UpdateLayouts = z.infer<typeof updateLayoutsSchema>;
