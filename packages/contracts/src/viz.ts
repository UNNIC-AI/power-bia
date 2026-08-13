import { z } from 'zod';

export const localeSchema = z.enum(['es', 'en']);

export const errorSchema = z.object({ message: z.string() });

export const chartTypeSchema = z.enum([
  'table',
  'kpi',
  'bar',
  'line',
  'pie',
  'area',
  'multi_line',
  'grouped_bar',
  'stacked_bar',
  'combo',
]);

export const intentSchema = z.enum([
  'conversation',
  'query',
  'rechart_previous',
  'follow_up',
  'create_filter',
]);

export const clarificationOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  field: z.enum(['chartType', 'xAxis', 'seriesColumn']),
  value: z.string(),
});

/**
 * Chosen before any DAX exists, from the question and the model schema alone.
 * The generator is then told the exact data shape to produce, which is what
 * keeps the charts correct.
 */
export const vizDecisionSchema = z.object({
  mode: z.enum(['table', 'chart']),
  chartType: chartTypeSchema,
  xAxis: z.string().nullable(),
  seriesColumn: z.string().nullable(),
  measure: z.string(),
  secondaryMeasure: z.string().nullable(),
  showTrend: z.boolean(),
  needsClarification: z.boolean(),
  clarificationKind: z.enum(['text', 'visual']).nullable(),
  clarificationQuestion: z.string().nullable(),
  clarificationOptions: z.array(clarificationOptionSchema).nullable(),
  suggestedTitle: z.string(),
});

/** Replaces the MVP's `NECESITA_ACLARACION:` / `FUERA_DE_RANGO:` string prefixes. */
export const daxGenerationSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('dax'), dax: z.string() }),
  z.object({ outcome: z.literal('needs_clarification'), question: z.string() }),
  z.object({
    outcome: z.literal('out_of_range'),
    requestedPeriod: z.string(),
    availableRange: z.string(),
  }),
]);

export const filterColumnSchema = z.object({
  table: z.string(),
  column: z.string(),
  title: z.string(),
});

export type Locale = z.infer<typeof localeSchema>;
export type ChartType = z.infer<typeof chartTypeSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type ClarificationOption = z.infer<typeof clarificationOptionSchema>;
export type VizDecision = z.infer<typeof vizDecisionSchema>;
export type DaxGeneration = z.infer<typeof daxGenerationSchema>;
export type FilterColumn = z.infer<typeof filterColumnSchema>;
