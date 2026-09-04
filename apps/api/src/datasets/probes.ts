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

/**
 * The canonical order of a text column's values - what makes "enero, febrero,
 * marzo" come back in that order instead of "abril, agosto, enero".
 *
 * Alphabetical is actively wrong for a month or weekday name, and there is no
 * model-agnostic way to know better from the name alone: the values are in the
 * customer's language and their own vocabulary. What is model-agnostic is the
 * pairing - a text column whose values stand in one-to-one correspondence with
 * a sibling integer. That integer is a valid ordering of the text, which is
 * exactly the condition Power BI itself imposes on a Sort-By-Column.
 *
 * So the order is discovered, never guessed: from `SortByColumnID` when the
 * model declares it, and otherwise from a bijection this proves with a query.
 */

/** An axis, not a key. Beyond this many values the order is nobody's question. */
const MAX_ORDERED_VALUES = 64;

/** A ceiling on the round trips this adds to an introspection run. */
const MAX_ORDER_PROBES = 40;

export function distinctCountQuery(table: string, columns: readonly string[]): string {
  const fields = columns
    .map(
      (column, position) =>
        `${quoteAlias(`c${position}`)}, DISTINCTCOUNT(${quoteColumnRef(table, column)})`,
    )
    .join(', ');

  return `EVALUATE ROW(${fields})`;
}

export function readDistinctCounts(
  result: DaxResult,
  columns: readonly string[],
): Map<string, number> {
  const row = readNamedRow(
    result,
    columns.map((_column, position) => `c${position}`),
  );
  const counts = new Map<string, number>();

  for (const [position, column] of columns.entries()) {
    const value = Number(row[`c${position}`]);
    if (Number.isFinite(value)) counts.set(column, value);
  }

  return counts;
}

export function orderedValuesQuery(table: string, column: string, sortBy: string): string {
  const label = quoteColumnRef(table, column);
  const key = quoteColumnRef(table, sortBy);

  /*
   * `TOPN` caps the result one row above the limit, so a pairing that turns out
   * to be wider than an axis is recognised rather than downloaded.
   */
  return `EVALUATE TOPN(${MAX_ORDERED_VALUES + 1}, SUMMARIZE(${quoteTableName(table)}, ${label}, ${key}), ${key}, ASC) ORDER BY ${key} ASC`;
}

/**
 * The distinct labels in key order, or null if the pair is not a bijection.
 *
 * Both directions matter. A label mapping to two keys has no single position on
 * the axis; a key mapping to two labels is a coincidence of cardinality rather
 * than an ordering - which is what rules out sorting month names by a year that
 * happens to have as many distinct values as they do.
 */
export function readOrderedValues(result: DaxResult): string[] | null {
  if (result.rows.length === 0 || result.rows.length > MAX_ORDERED_VALUES) return null;

  const labels: string[] = [];
  const seenLabels = new Set<string>();
  const seenKeys = new Set<string>();

  for (const row of result.rows) {
    const [label, key] = row;
    if (label === null || label === undefined || key === null || key === undefined) return null;

    const text = formatSample(label);
    if (seenLabels.has(text) || seenKeys.has(String(key))) return null;

    seenLabels.add(text);
    seenKeys.add(String(key));
    labels.push(text);
  }

  return labels;
}

interface OrderCandidate {
  table: string;
  column: string;
  sortBy: string;
}

/**
 * Which pairs are worth a query. A declared `SortByColumn` is taken at its word;
 * everything else has to survive a cardinality match first, so the probe only
 * ever runs on pairs that could still turn out to be one-to-one.
 *
 * The search for undeclared pairs is confined to calendar tables. That is where
 * alphabetical order is wrong often enough to be worth guessing at, and a model
 * that cares about the order of anything else says so with a Sort-By-Column.
 */
export function orderCandidates(
  tables: readonly IntrospectedTable[],
  distinctCounts: ReadonlyMap<string, ReadonlyMap<string, number>>,
): OrderCandidate[] {
  const candidates: OrderCandidate[] = [];

  for (const table of tables) {
    const counts = distinctCounts.get(table.name);
    const named = new Map(table.columns.map((column) => [column.name, column]));

    for (const column of table.columns) {
      if (column.sortByColumn && named.has(column.sortByColumn)) {
        candidates.push({ table: table.name, column: column.name, sortBy: column.sortByColumn });
        continue;
      }

      if (table.role !== 'date' || column.dataType !== 'texto' || !counts) continue;

      const size = counts.get(column.name);
      if (size === undefined || size < 2 || size > MAX_ORDERED_VALUES) continue;

      const key = table.columns.find(
        (other) =>
          other.name !== column.name &&
          other.dataType === 'entero' &&
          counts.get(other.name) === size,
      );
      if (key) candidates.push({ table: table.name, column: column.name, sortBy: key.name });
    }
  }

  return candidates.slice(0, MAX_ORDER_PROBES);
}

/** Canonical value order per table and column, for the columns that have one. */
export async function probeSortOrders(
  executor: DaxExecutor,
  connection: PowerBiConnection,
  tables: readonly IntrospectedTable[],
): Promise<ProbeResult<Map<string, Map<string, string[]>>>> {
  const warnings: string[] = [];
  const distinctCounts = new Map<string, Map<string, number>>();

  // Only calendar tables need the cardinality pass; the rest go by declaration.
  for (const table of tables.filter((candidate) => candidate.role === 'date')) {
    const names = table.columns
      .filter((column) => column.dataType === 'texto' || column.dataType === 'entero')
      .map((column) => column.name);
    if (names.length === 0) continue;

    const outcome = await executor.execute(connection, distinctCountQuery(table.name, names));
    if (!outcome.ok) {
      warnings.push(`Sin conteo de valores para '${table.name}': ${outcome.error}`);
      continue;
    }

    distinctCounts.set(table.name, readDistinctCounts(outcome.result, names));
  }

  const orders = new Map<string, Map<string, string[]>>();

  for (const candidate of orderCandidates(tables, distinctCounts)) {
    const outcome = await executor.execute(
      connection,
      orderedValuesQuery(candidate.table, candidate.column, candidate.sortBy),
    );
    if (!outcome.ok) continue;

    const values = readOrderedValues(outcome.result);
    if (!values) continue;

    const forTable = orders.get(candidate.table) ?? new Map<string, string[]>();
    forTable.set(candidate.column, values);
    orders.set(candidate.table, forTable);
  }

  return { value: orders, warnings };
}
