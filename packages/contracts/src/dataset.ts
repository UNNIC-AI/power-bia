import { z } from 'zod';
import { localeSchema } from './viz.js';

export const tableRoleSchema = z.enum(['fact', 'dimension', 'date']);

export const localizedLabelSchema = z.partialRecord(localeSchema, z.string());

export const datasetColumnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  sampleValue: z.union([z.string(), z.number(), z.null()]),
  isAggregatable: z.boolean(),
  /** Canonical value order, when the column has one that is not alphabetical. */
  sortOrder: z.array(z.string()).nullable(),
  /** Curated guidance handed to the LLM, e.g. "never ORDER BY this in a monthly grouping". */
  note: z.string().nullable(),
  labels: localizedLabelSchema,
});

export const datasetTableSchema = z.object({
  name: z.string(),
  role: tableRoleSchema,
  description: z.string(),
  columns: z.array(datasetColumnSchema),
});

export const datasetRelationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  cardinality: z.enum(['*:1', '1:1', '1:*']),
  isActive: z.boolean(),
});

export const datasetMeasureSchema = z.object({
  name: z.string(),
  expression: z.string(),
});

export const datasetSynonymSchema = z.object({
  term: z.string(),
  target: z.string(),
});

/**
 * Everything the prompt builders need about a model. Assembled from the
 * introspected metadata plus the admin-curated layer.
 */
export const datasetContextSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  /** Prose about the model - written by the LLM, curated by an admin - injected into every prompt stage. */
  extraContext: z.string(),
  dateRange: z.object({ min: z.iso.date(), max: z.iso.date() }),
  tables: z.array(datasetTableSchema),
  relationships: z.array(datasetRelationshipSchema),
  measures: z.array(datasetMeasureSchema),
  synonyms: z.array(datasetSynonymSchema),
});

/**
 * Which Power BI model this deployment is pointed at. Read-only: it comes from
 * the environment, and is exposed so an admin can tell which source they are
 * looking at without shell access to the server.
 */
export const datasetSourceSchema = z.object({
  workspaceName: z.string(),
  datasetName: z.string(),
});

export const datasetSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  extraContext: z.string(),
  /** When the model last wrote `extraContext` itself; null once an admin edits it. */
  extraContextGeneratedAt: z.iso.datetime().nullable(),
  /** Example questions written from this model's catalogue. Empty before the first sync. */
  starters: z.array(z.string()),
  source: datasetSourceSchema,
  dateRange: z.object({ min: z.iso.date(), max: z.iso.date() }),
  tableCount: z.number().int(),
  measureCount: z.number().int(),
  lastIntrospectedAt: z.iso.datetime().nullable(),
});

/**
 * What the settings dialog can change. The connection is environment-owned, and
 * the date range is whatever the model actually contains - neither belongs here.
 */
export const datasetSettingsInputSchema = z.object({
  description: z.string().max(1_000).optional(),
  /*
   * Capped because it rides on every prompt of every stage: eight LLM calls per
   * question in the worst case, so an unbounded field is an unbounded bill.
   */
  extraContext: z.string().max(8_000).optional(),
});

/** The prose the model writes about itself, in the admin's language. */
export const generatedDatasetContextSchema = z.object({
  description: z.string(),
  extraContext: z.string(),
  /** Three questions this model can actually answer, for the empty chat. */
  starters: z.array(z.string()).length(3),
});

const reconcileCountSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
});

/**
 * The outcome of one introspection run. `warnings` carries everything the
 * heuristics could not decide - an undetected date table, hidden tables that
 * were skipped - because those are exactly what the admin has to fix by hand.
 */
export const introspectionReportSchema = z.object({
  datasetId: z.uuid(),
  tables: reconcileCountSchema,
  columns: reconcileCountSchema,
  measures: reconcileCountSchema,
  relationships: reconcileCountSchema,
  dateRange: z.object({ min: z.iso.date(), max: z.iso.date() }),
  warnings: z.array(z.string()),
  durationMs: z.number().int(),
  lastIntrospectedAt: z.iso.datetime(),
  /** True when this run also wrote the model's context, which only happens while it is empty. */
  contextGenerated: z.boolean(),
});

export const daxResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  durationMs: z.number(),
});

export type TableRole = z.infer<typeof tableRoleSchema>;
export type LocalizedLabel = z.infer<typeof localizedLabelSchema>;
export type DatasetColumn = z.infer<typeof datasetColumnSchema>;
export type DatasetTable = z.infer<typeof datasetTableSchema>;
export type DatasetRelationship = z.infer<typeof datasetRelationshipSchema>;
export type DatasetMeasure = z.infer<typeof datasetMeasureSchema>;
export type DatasetSynonym = z.infer<typeof datasetSynonymSchema>;
export type DatasetContext = z.infer<typeof datasetContextSchema>;
export type DatasetSummary = z.infer<typeof datasetSummarySchema>;
export type DatasetSource = z.infer<typeof datasetSourceSchema>;
export type GeneratedDatasetContext = z.infer<typeof generatedDatasetContextSchema>;
export type DatasetSettingsInput = z.infer<typeof datasetSettingsInputSchema>;
export type IntrospectionReport = z.infer<typeof introspectionReportSchema>;
export type DaxResult = z.infer<typeof daxResultSchema>;
