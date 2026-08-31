import type { DaxResult } from '@powerbia/contracts';
import { normalizeColumnName } from '../dax/columns.js';
import type { DaxExecutor, PowerBiConnection } from '../dax/executor.js';
import { quoteAlias, quoteColumnRef, quoteTableName } from '../dax/identifiers.js';
import type { IntrospectedTable } from './heuristics.js';

/**
 * The two things the catalogue needs that `INFO.*` cannot answer: a real sample
 * value per column, and the model's actual date range. Both are ordinary data
 * queries, so they go through the same executor.
 *
 * The gateway buffers every row it is given with no cap (`Program.cs`), so every
 * limit here lives in the DAX itself.
 */

/** Rows to look at per table. More than one because the first row is often blank. */
const SAMPLE_ROWS = 5;

/**
 * Columns per query. A single projection over a very wide table risks both the
 * gateway's memory and Power BI's own expression limits, and a table split into
 * two queries costs one extra round trip.
 */
const SAMPLE_CHUNK = 60;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }

  return chunks;
}

export function sampleQuery(table: string, columns: readonly string[]): string {
  const projection = columns
    .map((column, position) => `${quoteAlias(`c${position}`)}, ${quoteColumnRef(table, column)}`)
    .join(', ');

  // TOPN before SELECTCOLUMNS so the engine projects five rows, not the table.
  return `EVALUATE SELECTCOLUMNS(TOPN(${SAMPLE_ROWS}, ${quoteTableName(table)}), ${projection})`;
}

/** First non-blank value per projected column, keyed by the original column name. */
export function readSamples(
  result: DaxResult,
  columns: readonly string[],
): Map<string, string | null> {
  const positions = new Map<string, number>();
  for (const [position, name] of result.columns.entries()) {
    positions.set(normalizeColumnName(name).trim().toLowerCase(), position);
  }

  const samples = new Map<string, string | null>();

  for (const [index, column] of columns.entries()) {
    const position = positions.get(`c${index}`);
    if (position === undefined) {
      samples.set(column, null);
      continue;
    }

    let sample: string | null = null;
    for (const row of result.rows) {
      const value = row[position];
      if (value === null || value === undefined || value === '') continue;

      sample = formatSample(value);
      break;
    }

    samples.set(column, sample);
  }

  return samples;
}

/**
 * `sample_value` is a text column and lands in the prompt verbatim, so a
 * timestamp is trimmed to the date the user would recognise.
 */
function formatSample(value: string | number | boolean): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);

  return String(value);
}

export interface ProbeResult<T> {
  value: T | null;
  warnings: string[];
}

export async function probeSampleValues(
  executor: DaxExecutor,
  connection: PowerBiConnection,
  tables: readonly IntrospectedTable[],
): Promise<ProbeResult<Map<string, Map<string, string | null>>>> {
  const warnings: string[] = [];
  const byTable = new Map<string, Map<string, string | null>>();

  for (const table of tables) {
    const samples = new Map<string, string | null>();
    const names = table.columns.map((column) => column.name);

    for (const group of chunk(names, SAMPLE_CHUNK)) {
      const outcome = await executor.execute(connection, sampleQuery(table.name, group));

      if (!outcome.ok) {
        warnings.push(`Sin valores de ejemplo para '${table.name}': ${outcome.error}`);
        continue;
      }

      for (const [column, value] of readSamples(outcome.result, group)) {
        samples.set(column, value);
      }
    }

    byTable.set(table.name, samples);
  }

  return { value: byTable, warnings };
}

export function dateRangeQuery(table: string, column: string): string {
  const reference = quoteColumnRef(table, column);

  return `EVALUATE ROW("dmin", MIN(${reference}), "dmax", MAX(${reference}))`;
}

export async function probeDateRange(
  executor: DaxExecutor,
  connection: PowerBiConnection,
  date: { table: string; column: string },
): Promise<ProbeResult<{ min: string; max: string }>> {
  const outcome = await executor.execute(connection, dateRangeQuery(date.table, date.column));

  if (!outcome.ok) {
    return { value: null, warnings: [`No se pudo leer el rango de fechas: ${outcome.error}`] };
  }

  const samples = readNamedRow(outcome.result, ['dmin', 'dmax']);
  const min = samples.dmin;
  const max = samples.dmax;

  if (!min || !max) {
    return {
      value: null,
      warnings: [
        `${date.table}[${date.column}] no devolvió fechas: revisa el rango temporal en Ajustes.`,
      ],
    };
  }

  return { value: { min: min.slice(0, 10), max: max.slice(0, 10) }, warnings: [] };
}

function readNamedRow(result: DaxResult, fields: readonly string[]): Record<string, string | null> {
  const positions = new Map<string, number>();
  for (const [position, name] of result.columns.entries()) {
    positions.set(normalizeColumnName(name).trim().toLowerCase(), position);
  }

  const row = result.rows[0] ?? [];
  const values: Record<string, string | null> = {};

  for (const field of fields) {
    const position = positions.get(field);
    const value = position === undefined ? null : (row[position] ?? null);
    values[field] = value === null ? null : String(value);
  }

  return values;
}
