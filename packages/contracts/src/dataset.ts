import { z } from 'zod';
import { localeSchema } from './viz.js';

export const tableRoleSchema = z.enum(['fact', 'dimension', 'date']);

export const localizedLabelSchema = z.partialRecord(localeSchema, z.string());

export const datasetColumnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  sampleValue: z.union([z.string(), z.number(), z.null()]),
  isAggregatable: z.boolean(),
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
  dateRange: z.object({ min: z.iso.date(), max: z.iso.date() }),
  tables: z.array(datasetTableSchema),
  relationships: z.array(datasetRelationshipSchema),
  measures: z.array(datasetMeasureSchema),
  synonyms: z.array(datasetSynonymSchema),
});

export const datasetSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  dateRange: z.object({ min: z.iso.date(), max: z.iso.date() }),
  tableCount: z.number().int(),
  measureCount: z.number().int(),
  lastIntrospectedAt: z.iso.datetime().nullable(),
});

export const datasetConnectionInputSchema = z.object({
  name: z.string().min(1),
  tenantId: z.uuid(),
  clientId: z.uuid(),
  clientSecret: z.string().min(1),
  workspaceName: z.string().min(1),
  datasetName: z.string().min(1),
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
export type DatasetConnectionInput = z.infer<typeof datasetConnectionInputSchema>;
export type DaxResult = z.infer<typeof daxResultSchema>;
