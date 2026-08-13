import { z } from 'zod';

export const pointSchema = z.object({
  label: z.string(),
  value: z.number(),
});

export const seriesSchema = z.object({
  name: z.string().nullable(),
  data: z.array(pointSchema),
});

export const comboSeriesSchema = z.object({
  name: z.string(),
  type: z.enum(['bar', 'line']),
  axis: z.enum(['primary', 'secondary']),
  data: z.array(pointSchema),
});

/** `subtitle` carries data-reduction notices, e.g. "showing the top 15 categories". */
const cardBase = {
  title: z.string().nullable(),
  subtitle: z.string().nullable(),
};

const seriesChart = {
  ...cardBase,
  series: z.array(seriesSchema),
};

export const kpiCardSchema = z.object({
  kind: z.literal('kpi'),
  ...cardBase,
  value: z.number(),
  unit: z.string().nullable(),
});

/**
 * Values stay typed rather than pre-formatted strings so the client can format
 * them with `Intl.NumberFormat` for the active locale.
 */
export const tableCardSchema = z.object({
  kind: z.literal('table'),
  ...cardBase,
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
});

export const pieCardSchema = z.object({
  kind: z.literal('pie'),
  ...cardBase,
  data: z.array(pointSchema),
});

export const barCardSchema = z.object({ kind: z.literal('bar'), ...seriesChart });
export const multiLineCardSchema = z.object({ kind: z.literal('multi_line'), ...seriesChart });
export const groupedBarCardSchema = z.object({ kind: z.literal('grouped_bar'), ...seriesChart });
export const stackedBarCardSchema = z.object({ kind: z.literal('stacked_bar'), ...seriesChart });

export const lineCardSchema = z.object({
  kind: z.literal('line'),
  ...seriesChart,
  showTrend: z.boolean(),
});

export const areaCardSchema = z.object({
  kind: z.literal('area'),
  ...seriesChart,
  showTrend: z.boolean(),
});

export const comboCardSchema = z.object({
  kind: z.literal('combo'),
  ...cardBase,
  series: z.array(comboSeriesSchema),
});

export const filterCardSchema = z.object({
  kind: z.literal('filter'),
  ...cardBase,
  table: z.string(),
  column: z.string(),
  values: z.array(z.string()),
  selected: z.array(z.string()),
});

export const choiceCardSchema = z.object({
  kind: z.literal('choice'),
  ...cardBase,
  options: z.array(z.object({ id: z.string(), label: z.string() })),
});

export const noteCardSchema = z.object({
  kind: z.literal('note'),
  ...cardBase,
  text: z.string(),
});

export const cardSchema = z.discriminatedUnion('kind', [
  kpiCardSchema,
  tableCardSchema,
  pieCardSchema,
  barCardSchema,
  lineCardSchema,
  areaCardSchema,
  multiLineCardSchema,
  groupedBarCardSchema,
  stackedBarCardSchema,
  comboCardSchema,
  filterCardSchema,
  choiceCardSchema,
  noteCardSchema,
]);

export type Point = z.infer<typeof pointSchema>;
export type Series = z.infer<typeof seriesSchema>;
export type ComboSeries = z.infer<typeof comboSeriesSchema>;
export type Card = z.infer<typeof cardSchema>;
export type CardKind = Card['kind'];

export type KpiCard = z.infer<typeof kpiCardSchema>;
export type TableCard = z.infer<typeof tableCardSchema>;
export type PieCard = z.infer<typeof pieCardSchema>;
export type ComboCard = z.infer<typeof comboCardSchema>;
export type FilterCard = z.infer<typeof filterCardSchema>;
export type ChoiceCard = z.infer<typeof choiceCardSchema>;
export type NoteCard = z.infer<typeof noteCardSchema>;
export type SeriesCard = Extract<
  Card,
  { kind: 'bar' | 'line' | 'area' | 'multi_line' | 'grouped_bar' | 'stacked_bar' }
>;

export const DEFAULT_WIDGET_SIZE: Record<CardKind, { width: number; height: number }> = {
  kpi: { width: 3, height: 3 },
  bar: { width: 6, height: 7 },
  line: { width: 6, height: 7 },
  area: { width: 6, height: 7 },
  pie: { width: 5, height: 9 },
  multi_line: { width: 7, height: 8 },
  grouped_bar: { width: 7, height: 8 },
  stacked_bar: { width: 7, height: 8 },
  combo: { width: 7, height: 8 },
  table: { width: 7, height: 6 },
  filter: { width: 3, height: 8 },
  choice: { width: 4, height: 4 },
  note: { width: 4, height: 3 },
};
