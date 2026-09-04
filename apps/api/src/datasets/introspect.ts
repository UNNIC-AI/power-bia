import type { IntrospectionReport } from '@powerbia/contracts';
import { type Database, schema } from '@powerbia/db';
import { eq, inArray } from 'drizzle-orm';
import type { DaxExecutor } from '../dax/executor.js';
import { loadConnection } from './context.js';
import { buildModel, type IntrospectedModel } from './heuristics.js';
import {
  INFO_COLUMNS,
  INFO_MEASURES,
  INFO_RELATIONSHIPS,
  INFO_TABLES,
  parseColumns,
  parseMeasures,
  parseRelationships,
  parseTables,
} from './info-queries.js';
import { probeDateRange, probeSampleValues, probeSortOrders } from './probes.js';

/**
 * Rediscovers a Power BI model and reconciles it into the catalogue.
 *
 * The invariant that governs every write here: `note` and `labels` on
 * `dataset_columns`, and every row in `dataset_synonyms`, are curated by hand and
 * are what make the generated DAX correct. Introspection may never overwrite
 * them - see docs/data-model.md.
 */

interface Counts {
  created: number;
  updated: number;
  removed: number;
}

function counts(): Counts {
  return { created: 0, updated: 0, removed: 0 };
}

export interface IntrospectOptions {
  db: Database;
  executor: DaxExecutor;
  datasetId: string;
}

/**
 * `contextGenerated` is the caller's to fill in - see ./sync.ts. Introspection
 * knows nothing about the LLM that documents what it discovered.
 */
export async function introspectDataset({
  db,
  executor,
  datasetId,
}: IntrospectOptions): Promise<Omit<IntrospectionReport, 'contextGenerated'>> {
  const startedAt = Date.now();

  const dataset = await db.query.datasets.findFirst({
    where: eq(schema.datasets.id, datasetId),
  });
  if (!dataset) throw new Error('Dataset not found');

  const connection = await loadConnection(db, datasetId);
  if (!connection) throw new Error('Dataset not found');

  /*
   * The gateway hands back Power BI's own error text, and it is the only thing
   * that tells an admin whether this is a permissions problem, a workspace name
   * typo or a capacity that does not expose INFO.*. So it is propagated verbatim.
   */
  const query = async (dax: string) => {
    const outcome = await executor.execute(connection, dax);
    if (!outcome.ok) throw new Error(`${dax} falló: ${outcome.error}`);

    return outcome.result;
  };

  const [tables, columns, measures, relationships] = await Promise.all([
    query(INFO_TABLES),
    query(INFO_COLUMNS),
    query(INFO_MEASURES),
    query(INFO_RELATIONSHIPS),
  ]);

  const model = buildModel({
    tables: parseTables(tables),
    columns: parseColumns(columns),
    measures: parseMeasures(measures),
    relationships: parseRelationships(relationships),
  });

  const warnings = [...model.warnings];

  const samples = await probeSampleValues(executor, connection, model.tables);
  warnings.push(...samples.warnings);

  const sortOrders = await probeSortOrders(executor, connection, model.tables);
  warnings.push(...sortOrders.warnings);

  let dateRange = { min: dataset.dateMin, max: dataset.dateMax };
  if (model.dateColumn) {
    const probed = await probeDateRange(executor, connection, model.dateColumn);
    warnings.push(...probed.warnings);
    if (probed.value) dateRange = probed.value;
  }

  const report = await write({
    db,
    datasetId,
    model,
    samples: samples.value ?? new Map(),
    sortOrders: sortOrders.value ?? new Map(),
    dateRange,
  });

  return {
    datasetId,
    ...report,
    dateRange,
    warnings,
    durationMs: Date.now() - startedAt,
  };
}

interface WriteOptions {
  db: Database;
  datasetId: string;
  model: IntrospectedModel;
  samples: Map<string, Map<string, string | null>>;
  sortOrders: Map<string, Map<string, string[]>>;
  dateRange: { min: string; max: string };
}

type WriteResult = Pick<
  IntrospectionReport,
  'tables' | 'columns' | 'measures' | 'relationships' | 'lastIntrospectedAt'
>;

async function write({
  db,
  datasetId,
  model,
  samples,
  sortOrders,
  dateRange,
}: WriteOptions): Promise<WriteResult> {
  const tableCounts = counts();
  const columnCounts = counts();
  const measureCounts = counts();
  const relationshipCounts = counts();
  const lastIntrospectedAt = new Date();

  await db.transaction(async (tx) => {
    // --- tables -------------------------------------------------------------
    const existingTables = await tx
      .select()
      .from(schema.datasetTables)
      .where(eq(schema.datasetTables.datasetId, datasetId));

    const tableIdByName = new Map<string, string>();

    for (const table of model.tables) {
      const existing = existingTables.find((row) => row.name === table.name);

      if (existing) {
        await tx
          .update(schema.datasetTables)
          .set({
            role: table.role,
            // An empty model description must not wipe a curated one.
            description: table.description || existing.description,
          })
          .where(eq(schema.datasetTables.id, existing.id));

        tableIdByName.set(table.name, existing.id);
        tableCounts.updated += 1;
        continue;
      }

      const [inserted] = await tx
        .insert(schema.datasetTables)
        .values({
          datasetId,
          name: table.name,
          role: table.role,
          description: table.description,
        })
        .returning();
      if (!inserted) throw new Error(`No se pudo insertar la tabla ${table.name}`);

      tableIdByName.set(table.name, inserted.id);
      tableCounts.created += 1;
    }

    const modelTableNames = new Set(model.tables.map((table) => table.name));
    const staleTables = existingTables.filter((row) => !modelTableNames.has(row.name));
    if (staleTables.length > 0) {
      await tx.delete(schema.datasetTables).where(
        inArray(
          schema.datasetTables.id,
          staleTables.map((row) => row.id),
        ),
      );
      tableCounts.removed = staleTables.length;
    }

    // --- columns ------------------------------------------------------------
    for (const table of model.tables) {
      const tableId = tableIdByName.get(table.name);
      if (!tableId) continue;

      const existingColumns = await tx
        .select()
        .from(schema.datasetColumns)
        .where(eq(schema.datasetColumns.tableId, tableId));

      const tableSamples = samples.get(table.name);
      const tableOrders = sortOrders.get(table.name);

      for (const column of table.columns) {
        const existing = existingColumns.find((row) => row.name === column.name);
        const sampleValue = tableSamples?.get(column.name) ?? null;
        /*
         * Written on every sync, null included: an order that no longer holds -
         * the sort-by was removed, or the pairing stopped being one-to-one - has
         * to disappear rather than linger as a stale axis.
         */
        const sortOrder = tableOrders?.get(column.name) ?? null;

        if (existing) {
          /*
           * `note` and `labels` are deliberately absent from this set. They are
           * the curated layer; wiping them degrades DAX quality with no error
           * anywhere. Do not add them here.
           */
          await tx
            .update(schema.datasetColumns)
            .set({
              dataType: column.dataType,
              isAggregatable: column.isAggregatable,
              sampleValue: sampleValue ?? existing.sampleValue,
              sortOrder,
            })
            .where(eq(schema.datasetColumns.id, existing.id));

          columnCounts.updated += 1;
          continue;
        }

        await tx.insert(schema.datasetColumns).values({
          tableId,
          name: column.name,
          dataType: column.dataType,
          isAggregatable: column.isAggregatable,
          sampleValue,
          sortOrder,
        });
        columnCounts.created += 1;
      }

      const modelColumnNames = new Set(table.columns.map((column) => column.name));
      const staleColumns = existingColumns.filter((row) => !modelColumnNames.has(row.name));
      if (staleColumns.length > 0) {
        await tx.delete(schema.datasetColumns).where(
          inArray(
            schema.datasetColumns.id,
            staleColumns.map((row) => row.id),
          ),
        );
        columnCounts.removed += staleColumns.length;
      }
    }

    // --- measures -----------------------------------------------------------
    const existingMeasures = await tx
      .select()
      .from(schema.datasetMeasures)
      .where(eq(schema.datasetMeasures.datasetId, datasetId));

    for (const measure of model.measures) {
      const existing = existingMeasures.find((row) => row.name === measure.name);

      /*
       * A curated row wins over the model measure that shares its name: the
       * curated expression is business vocabulary someone tuned the prompts
       * against, and the model's own definition may be a formatted variant.
       */
      if (existing?.source === 'curated') continue;

      if (existing) {
        await tx
          .update(schema.datasetMeasures)
          .set({ expression: measure.expression })
          .where(eq(schema.datasetMeasures.id, existing.id));
        measureCounts.updated += 1;
        continue;
      }

      await tx.insert(schema.datasetMeasures).values({
        datasetId,
        name: measure.name,
        expression: measure.expression,
        source: 'introspected',
      });
      measureCounts.created += 1;
    }

    const modelMeasureNames = new Set(model.measures.map((measure) => measure.name));
    const staleMeasures = existingMeasures.filter(
      (row) => row.source === 'introspected' && !modelMeasureNames.has(row.name),
    );
    if (staleMeasures.length > 0) {
      await tx.delete(schema.datasetMeasures).where(
        inArray(
          schema.datasetMeasures.id,
          staleMeasures.map((row) => row.id),
        ),
      );
      measureCounts.removed = staleMeasures.length;
    }

    // --- relationships ------------------------------------------------------
    /*
     * Replaced wholesale rather than upserted: the table carries nothing curated
     * and has no unique index to key an upsert on. The counts are diffed first so
     * the report still says what actually changed.
     */
    const existingRelationships = await tx
      .select()
      .from(schema.datasetRelationships)
      .where(eq(schema.datasetRelationships.datasetId, datasetId));

    const key = (from: string, to: string) => `${from}->${to}`;
    const existingByKey = new Map(
      existingRelationships.map((row) => [key(row.fromColumn, row.toColumn), row]),
    );

    for (const relationship of model.relationships) {
      const previous = existingByKey.get(key(relationship.fromColumn, relationship.toColumn));

      if (!previous) relationshipCounts.created += 1;
      else if (
        previous.cardinality !== relationship.cardinality ||
        previous.isActive !== relationship.isActive
      ) {
        relationshipCounts.updated += 1;
      }
    }

    const modelKeys = new Set(
      model.relationships.map((relationship) =>
        key(relationship.fromColumn, relationship.toColumn),
      ),
    );
    relationshipCounts.removed = existingRelationships.filter(
      (row) => !modelKeys.has(key(row.fromColumn, row.toColumn)),
    ).length;

    await tx
      .delete(schema.datasetRelationships)
      .where(eq(schema.datasetRelationships.datasetId, datasetId));

    if (model.relationships.length > 0) {
      await tx.insert(schema.datasetRelationships).values(
        model.relationships.map((relationship) => ({
          datasetId,
          fromColumn: relationship.fromColumn,
          toColumn: relationship.toColumn,
          cardinality: relationship.cardinality,
          isActive: relationship.isActive,
        })),
      );
    }

    // --- the dataset row ----------------------------------------------------
    await tx
      .update(schema.datasets)
      .set({ dateMin: dateRange.min, dateMax: dateRange.max, lastIntrospectedAt })
      .where(eq(schema.datasets.id, datasetId));
  });

  return {
    tables: tableCounts,
    columns: columnCounts,
    measures: measureCounts,
    relationships: relationshipCounts,
    lastIntrospectedAt: lastIntrospectedAt.toISOString(),
  };
}

/**
 * Whether a catalogue is missing or older than `maxAgeHours`. Used by the
 * startup check, which refreshes the active model in the background.
 */
export function isCatalogueStale(
  dataset: { lastIntrospectedAt: Date | null },
  maxAgeHours: number,
): boolean {
  if (!dataset.lastIntrospectedAt) return true;

  return dataset.lastIntrospectedAt.getTime() < Date.now() - maxAgeHours * 60 * 60 * 1000;
}
