import type { DatasetContext, Locale } from '@powerbia/contracts';
import { type Database, decryptSecret, schema } from '@powerbia/db';
import { eq } from 'drizzle-orm';
import { normalizeColumnName } from '../dax/columns.js';
import type { PowerBiConnection } from '../dax/executor.js';
import { env } from '../env.js';

export async function loadDatasetContext(
  db: Database,
  datasetId: string,
): Promise<DatasetContext | null> {
  const dataset = await db.query.datasets.findFirst({
    where: eq(schema.datasets.id, datasetId),
    with: {
      tables: { with: { columns: true } },
      measures: true,
      relationships: true,
      synonyms: true,
    },
  });

  if (!dataset) return null;

  return {
    id: dataset.id,
    name: dataset.name,
    description: dataset.description,
    dateRange: { min: dataset.dateMin, max: dataset.dateMax },
    tables: dataset.tables.map((table) => ({
      name: table.name,
      role: table.role,
      description: table.description,
      columns: table.columns.map((column) => ({
        name: column.name,
        dataType: column.dataType,
        sampleValue: column.sampleValue,
        isAggregatable: column.isAggregatable,
        note: column.note,
        labels: column.labels,
      })),
    })),
    relationships: dataset.relationships.map((relationship) => ({
      from: relationship.fromColumn,
      to: relationship.toColumn,
      cardinality: relationship.cardinality,
      isActive: relationship.isActive,
    })),
    measures: dataset.measures.map(({ name, expression }) => ({ name, expression })),
    synonyms: dataset.synonyms.map(({ term, target }) => ({ term, target })),
  };
}

export async function loadConnection(
  db: Database,
  datasetId: string,
): Promise<PowerBiConnection | null> {
  const dataset = await db.query.datasets.findFirst({
    where: eq(schema.datasets.id, datasetId),
  });

  if (!dataset) return null;

  return {
    tenantId: dataset.tenantId,
    clientId: dataset.clientId,
    clientSecret: decryptSecret(dataset.clientSecretEncrypted, env.DATASET_SECRET_KEY),
    workspaceName: dataset.workspaceName,
    datasetName: dataset.datasetName,
  };
}

/**
 * Column headings for the UI. Replaces the MVP's hardcoded Spanish dictionary of
 * Iowa-specific column names with the per-dataset curated labels.
 */
export function createLabelResolver(
  dataset: DatasetContext,
  locale: Locale,
): (column: string) => string {
  const labels = new Map<string, string>();

  for (const table of dataset.tables) {
    for (const column of table.columns) {
      const label = column.labels[locale];
      if (label) labels.set(column.name.toLowerCase(), label);
    }
  }

  return (column) => {
    const name = normalizeColumnName(column);

    return labels.get(name.toLowerCase()) ?? name.replaceAll('#', '').replaceAll('_', ' ').trim();
  };
}
