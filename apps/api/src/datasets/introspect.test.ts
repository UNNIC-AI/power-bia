import { randomUUID } from 'node:crypto';
import type { DaxResult } from '@powerbia/contracts';
import { createDatabase, encryptSecret, schema } from '@powerbia/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DaxExecutor } from '../dax/executor.js';

/**
 * The invariant this whole feature stands on: re-introspecting a model must not
 * touch the curated layer. `note` and `labels` on `dataset_columns`, and every
 * row in `dataset_synonyms`, are hand-written and are what make the generated DAX
 * correct - wiping them degrades output quality with no error anywhere.
 *
 * Runs against the development database and skips without one, so CI stays
 * green. The Power BI side is a stub: the point is the reconciliation, not the
 * gateway.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const DATASET_SECRET_KEY = process.env.DATASET_SECRET_KEY;
const canRun = Boolean(DATABASE_URL && DATASET_SECRET_KEY);

function result(columns: string[], rows: (string | number | boolean | null)[][]): DaxResult {
  return { columns, rows, durationMs: 1 };
}

/** Two tables, one relationship, one measure - enough to exercise every branch. */
const RESPONSES: Record<string, DaxResult> = {
  'EVALUATE INFO.TABLES()': result(
    ['[ID]', '[Name]', '[DataCategory]', '[IsHidden]', '[Description]'],
    [
      [1, 'Calendar', 'Time', false, null],
      [2, 'Invoices', null, false, null],
    ],
  ),
  'EVALUATE INFO.COLUMNS()': result(
    ['[ID]', '[TableID]', '[ExplicitName]', '[ExplicitDataType]', '[IsHidden]', '[Type]'],
    [
      [10, 1, 'Date', 9, false, 1],
      [11, 1, '#Año', 6, false, 1],
      [20, 2, 'Date', 9, false, 1],
      [21, 2, 'Bottles Sold', 6, false, 1],
    ],
  ),
  'EVALUATE INFO.MEASURES()': result(
    ['[ID]', '[TableID]', '[Name]', '[Expression]', '[IsHidden]'],
    [[1, 2, 'Botellas del modelo', "SUM('Invoices'[Bottles Sold])", false]],
  ),
  'EVALUATE INFO.RELATIONSHIPS()': result(
    [
      '[FromTableID]',
      '[FromColumnID]',
      '[FromCardinality]',
      '[ToTableID]',
      '[ToColumnID]',
      '[ToCardinality]',
      '[IsActive]',
    ],
    [[2, 20, 2, 1, 10, 1, true]],
  ),
};

const stubExecutor: DaxExecutor = {
  async execute(_connection, dax) {
    const canned = RESPONSES[dax];
    if (canned) return { ok: true, result: canned };

    // A sample-value or date-range probe.
    if (dax.startsWith('EVALUATE ROW("dmin"')) {
      return {
        ok: true,
        result: result(['[dmin]', '[dmax]'], [['2012-01-01T00:00:00', '2021-12-31T00:00:00']]),
      };
    }

    const aliases = [...dax.matchAll(/"(c\d+)"/g)].map((match) => match[1] as string);

    return {
      ok: true,
      result: result(
        aliases.map((alias) => `[${alias}]`),
        [aliases.map((_, index) => `v${index}`)],
      ),
    };
  },

  async health() {
    return true;
  },
};

describe.skipIf(!canRun)('introspectDataset reconciliation', () => {
  const db = createDatabase(DATABASE_URL as string);
  let datasetId: string;

  beforeAll(async () => {
    const [dataset] = await db
      .insert(schema.datasets)
      .values({
        name: `test-introspect-${randomUUID()}`,
        tenantId: 'test',
        clientId: 'test',
        clientSecretEncrypted: encryptSecret('secret', DATASET_SECRET_KEY as string),
        workspaceName: 'test',
        datasetName: 'test',
        dateMin: '1900-01-01',
        dateMax: '1900-01-01',
      })
      .returning();
    if (!dataset) throw new Error('could not insert the test dataset');

    datasetId = dataset.id;

    // A pre-existing curated catalogue, as the seed would have written it.
    const [table] = await db
      .insert(schema.datasetTables)
      .values({
        datasetId,
        name: 'Invoices',
        role: 'dimension',
        description: 'Descripción curada a mano.',
      })
      .returning();
    if (!table) throw new Error('could not insert the test table');

    await db.insert(schema.datasetColumns).values({
      tableId: table.id,
      name: 'Bottles Sold',
      dataType: 'texto',
      isAggregatable: false,
      note: 'ÚNICA columna sumable del modelo.',
      labels: { es: 'Botellas vendidas', en: 'Bottles sold' },
    });

    await db.insert(schema.datasetMeasures).values({
      datasetId,
      name: 'Facturación',
      expression: 'SUMX(...)',
      source: 'curated',
    });

    await db
      .insert(schema.datasetSynonyms)
      .values({ datasetId, term: 'ventas', target: 'Botellas vendidas' });

    const { introspectDataset } = await import('./introspect.js');
    await introspectDataset({ db, executor: stubExecutor, datasetId });
  });

  afterAll(async () => {
    if (datasetId) await db.delete(schema.datasets).where(eq(schema.datasets.id, datasetId));
  });

  async function tables() {
    return db
      .select()
      .from(schema.datasetTables)
      .where(eq(schema.datasetTables.datasetId, datasetId));
  }

  async function column(tableName: string, columnName: string) {
    const target = (await tables()).find((row) => row.name === tableName);
    if (!target) return undefined;

    const columns = await db
      .select()
      .from(schema.datasetColumns)
      .where(eq(schema.datasetColumns.tableId, target.id));

    return columns.find((row) => row.name === columnName);
  }

  it('preserves the curated note and labels on a column it updates', async () => {
    const bottles = await column('Invoices', 'Bottles Sold');

    expect(bottles?.note).toBe('ÚNICA columna sumable del modelo.');
    expect(bottles?.labels).toEqual({ es: 'Botellas vendidas', en: 'Bottles sold' });
  });

  it('still refreshes the introspectable fields of that column', async () => {
    const bottles = await column('Invoices', 'Bottles Sold');

    expect(bottles?.dataType).toBe('entero');
    expect(bottles?.isAggregatable).toBe(true);
    expect(bottles?.sampleValue).not.toBeNull();
  });

  it('corrects a table role it had wrong and keeps the curated description', async () => {
    const invoices = (await tables()).find((row) => row.name === 'Invoices');

    expect(invoices?.role).toBe('fact');
    // INFO.TABLES returned no description; an empty one must not overwrite.
    expect(invoices?.description).toBe('Descripción curada a mano.');
  });

  it('never touches synonyms', async () => {
    const synonyms = await db
      .select()
      .from(schema.datasetSynonyms)
      .where(eq(schema.datasetSynonyms.datasetId, datasetId));

    expect(synonyms.map((row) => row.term)).toEqual(['ventas']);
  });

  it('keeps curated measures and adds the model ones alongside', async () => {
    const measures = await db
      .select()
      .from(schema.datasetMeasures)
      .where(eq(schema.datasetMeasures.datasetId, datasetId));

    const bySource = new Map(measures.map((row) => [row.name, row.source]));
    expect(bySource.get('Facturación')).toBe('curated');
    expect(bySource.get('Botellas del modelo')).toBe('introspected');
  });

  it('writes the probed date range and the sync timestamp', async () => {
    const dataset = await db.query.datasets.findFirst({
      where: eq(schema.datasets.id, datasetId),
    });

    expect(dataset?.dateMin).toBe('2012-01-01');
    expect(dataset?.dateMax).toBe('2021-12-31');
    expect(dataset?.lastIntrospectedAt).not.toBeNull();
  });
});
