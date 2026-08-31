import type { DaxResult } from '@powerbia/contracts';
import { normalizeColumnName } from '../dax/columns.js';

/**
 * Model introspection through the same gateway `/query` every other DAX query
 * uses, because `INFO.*` is DAX. See docs/architecture.md.
 *
 * The parsers here resolve fields by column NAME rather than by position: the
 * column set of `INFO.*` grows between Analysis Services versions, and a
 * positional read would silently shift on a capacity upgrade. Anything missing
 * comes back as a null/default rather than throwing, so one unknown field can
 * never take a whole introspection down.
 */

export const INFO_TABLES = 'EVALUATE INFO.TABLES()';
export const INFO_COLUMNS = 'EVALUATE INFO.COLUMNS()';
export const INFO_MEASURES = 'EVALUATE INFO.MEASURES()';
export const INFO_RELATIONSHIPS = 'EVALUATE INFO.RELATIONSHIPS()';

/** Tabular `ColumnType`. `RowNumber` is an engine artefact with no user-visible name. */
export const COLUMN_TYPE = { data: 1, calculated: 2, rowNumber: 3, calculatedTable: 4 } as const;

/** Tabular `DataType`. */
export const DATA_TYPE = {
  automatic: 1,
  string: 2,
  int64: 6,
  double: 8,
  dateTime: 9,
  decimal: 10,
  boolean: 11,
  binary: 17,
  unknown: 19,
  variant: 20,
} as const;

/** Tabular `AggregateFunction`, as reported by `SummarizeBy`. */
export const SUMMARIZE_BY = { default: 1, none: 2, sum: 3 } as const;

/** Tabular `RelationshipEndCardinality`. */
export const END_CARDINALITY = { one: 1, many: 2 } as const;

export interface RawTable {
  id: number;
  name: string;
  dataCategory: string | null;
  description: string | null;
  isHidden: boolean;
}

export interface RawColumn {
  id: number;
  tableId: number;
  name: string;
  dataType: number;
  dataCategory: string | null;
  description: string | null;
  isHidden: boolean;
  isKey: boolean;
  summarizeBy: number;
  columnType: number;
}

export interface RawMeasure {
  id: number;
  tableId: number;
  name: string;
  expression: string;
  description: string | null;
  isHidden: boolean;
}

export interface RawRelationship {
  fromTableId: number;
  fromColumnId: number;
  fromCardinality: number;
  toTableId: number;
  toColumnId: number;
  toCardinality: number;
  isActive: boolean;
}

type Cell = string | number | boolean | null;
type Row = readonly Cell[];

/**
 * Column names arrive as `[Name]` from `INFO.*` and are already stripped by the
 * executor; normalising again is idempotent and keeps the parsers usable against
 * raw fixtures captured straight off the gateway.
 */
function indexColumns(columns: readonly string[]): Map<string, number> {
  const index = new Map<string, number>();

  for (const [position, column] of columns.entries()) {
    index.set(normalizeColumnName(column).trim().toLowerCase(), position);
  }

  return index;
}

function cell(row: Row, index: Map<string, number>, field: string): Cell {
  const position = index.get(field.toLowerCase());

  return position === undefined ? null : (row[position] ?? null);
}

function readText(row: Row, index: Map<string, number>, field: string): string | null {
  const value = cell(row, index, field);
  if (value === null || value === '') return null;

  return String(value);
}

function readInt(row: Row, index: Map<string, number>, field: string, fallback: number): number {
  const value = cell(row, index, field);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return fallback;
}

/** ADOMD reports booleans as booleans, but Power BI versions differ on `1` / `"True"`. */
function readBool(row: Row, index: Map<string, number>, field: string): boolean {
  const value = cell(row, index, field);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';

  return false;
}

export function parseTables(result: DaxResult): RawTable[] {
  const index = indexColumns(result.columns);

  return result.rows
    .map((row) => ({
      id: readInt(row, index, 'ID', -1),
      name: readText(row, index, 'Name') ?? '',
      dataCategory: readText(row, index, 'DataCategory'),
      description: readText(row, index, 'Description'),
      isHidden: readBool(row, index, 'IsHidden'),
    }))
    .filter((table) => table.id !== -1 && table.name !== '');
}

export function parseColumns(result: DaxResult): RawColumn[] {
  const index = indexColumns(result.columns);

  return result.rows
    .map((row) => {
      /*
       * Calculated columns carry only an ExplicitName; engine-generated ones
       * only an InferredName. Taking whichever is present is what makes both
       * kinds land under the name the user would type in DAX.
       */
      const name = readText(row, index, 'ExplicitName') ?? readText(row, index, 'InferredName');
      const explicitType = readInt(row, index, 'ExplicitDataType', DATA_TYPE.automatic);

      return {
        id: readInt(row, index, 'ID', -1),
        tableId: readInt(row, index, 'TableID', -1),
        name: name ?? '',
        dataType:
          explicitType === DATA_TYPE.automatic
            ? readInt(row, index, 'InferredDataType', DATA_TYPE.unknown)
            : explicitType,
        dataCategory: readText(row, index, 'DataCategory'),
        description: readText(row, index, 'Description'),
        isHidden: readBool(row, index, 'IsHidden'),
        isKey: readBool(row, index, 'IsKey'),
        summarizeBy: readInt(row, index, 'SummarizeBy', SUMMARIZE_BY.default),
        columnType: readInt(row, index, 'Type', COLUMN_TYPE.data),
      };
    })
    .filter(
      (column) =>
        column.id !== -1 &&
        column.tableId !== -1 &&
        column.name !== '' &&
        column.columnType !== COLUMN_TYPE.rowNumber,
    );
}

export function parseMeasures(result: DaxResult): RawMeasure[] {
  const index = indexColumns(result.columns);

  return result.rows
    .map((row) => ({
      id: readInt(row, index, 'ID', -1),
      tableId: readInt(row, index, 'TableID', -1),
      name: readText(row, index, 'Name') ?? '',
      expression: (readText(row, index, 'Expression') ?? '').trim(),
      description: readText(row, index, 'Description'),
      isHidden: readBool(row, index, 'IsHidden'),
    }))
    .filter((measure) => measure.name !== '' && measure.expression !== '');
}

export function parseRelationships(result: DaxResult): RawRelationship[] {
  const index = indexColumns(result.columns);

  return result.rows
    .map((row) => ({
      fromTableId: readInt(row, index, 'FromTableID', -1),
      fromColumnId: readInt(row, index, 'FromColumnID', -1),
      fromCardinality: readInt(row, index, 'FromCardinality', END_CARDINALITY.many),
      toTableId: readInt(row, index, 'ToTableID', -1),
      toColumnId: readInt(row, index, 'ToColumnID', -1),
      toCardinality: readInt(row, index, 'ToCardinality', END_CARDINALITY.one),
      isActive: readBool(row, index, 'IsActive'),
    }))
    .filter((relationship) => relationship.fromColumnId !== -1 && relationship.toColumnId !== -1);
}
