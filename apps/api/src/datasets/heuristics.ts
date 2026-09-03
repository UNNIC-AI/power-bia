import type { TableRole } from '@powerbia/contracts';
import {
  COLUMN_TYPE,
  DATA_TYPE,
  END_CARDINALITY,
  type RawColumn,
  type RawMeasure,
  type RawRelationship,
  type RawTable,
  SUMMARIZE_BY,
} from './info-queries.js';

/**
 * `INFO.*` returns names, types, relationships and real model measures. It does
 * NOT return what the prompts actually lean on: which table is the fact table,
 * which column may be summed, or where the calendar is. These rules close that
 * gap deterministically.
 *
 * They are validated against the Iowa model, whose hand-written catalogue in
 * `packages/db/src/seed.ts` is the expected output - see heuristics.test.ts.
 */

const NUMERIC_TYPES = new Set<number>([DATA_TYPE.int64, DATA_TYPE.double, DATA_TYPE.decimal]);

/**
 * A unit price, a rate or an average is numeric and still meaningless to SUM.
 * Erring towards non-aggregatable is the safe direction: it only drops the
 * `[SUMABLE]` hint, whereas a wrongly summable price actively invites bad DAX
 * (the exact mistake the MVP had to warn about by hand for `State Bottle Cost`).
 */
const NON_ADDITIVE_NAME =
  /cost|coste|price|precio|retail|pvp|tarifa|rate|tasa|ratio|pct|percent|porcentaje|margin|margen|avg|average|promedio|media|unit|unitario/i;

/** The Spanish tokens the seed uses, because `schemaSection` prints them verbatim. */
export function mapDataType(dataType: number): string {
  switch (dataType) {
    case DATA_TYPE.string:
      return 'texto';
    case DATA_TYPE.int64:
      return 'entero';
    case DATA_TYPE.double:
    case DATA_TYPE.decimal:
      return 'decimal';
    case DATA_TYPE.dateTime:
      return 'datetime';
    case DATA_TYPE.boolean:
      return 'booleano';
    default:
      return 'desconocido';
  }
}

export function isNumericType(dataType: number): boolean {
  return NUMERIC_TYPES.has(dataType);
}

export function isDateTimeType(dataType: number): boolean {
  return dataType === DATA_TYPE.dateTime;
}

export interface IntrospectedColumn {
  name: string;
  dataType: string;
  isAggregatable: boolean;
}

export interface IntrospectedTable {
  name: string;
  role: TableRole;
  description: string;
  columns: IntrospectedColumn[];
}

export interface IntrospectedRelationship {
  fromColumn: string;
  toColumn: string;
  cardinality: '*:1' | '1:1' | '1:*';
  isActive: boolean;
}

export interface IntrospectedMeasure {
  name: string;
  expression: string;
}

export interface IntrospectedModel {
  tables: IntrospectedTable[];
  relationships: IntrospectedRelationship[];
  measures: IntrospectedMeasure[];
  /** Where to read the model's real date range from, if a calendar was found. */
  dateColumn: { table: string; column: string } | null;
  warnings: string[];
}

export interface RawModel {
  tables: readonly RawTable[];
  columns: readonly RawColumn[];
  measures: readonly RawMeasure[];
  relationships: readonly RawRelationship[];
}

function mapCardinality(relationship: RawRelationship): '*:1' | '1:1' | '1:*' {
  const { fromCardinality, toCardinality } = relationship;

  if (fromCardinality === END_CARDINALITY.one && toCardinality === END_CARDINALITY.one) {
    return '1:1';
  }
  if (fromCardinality === END_CARDINALITY.one && toCardinality === END_CARDINALITY.many) {
    return '1:*';
  }

  return '*:1';
}

/**
 * `date` if the model says so, or if the table is the one-side of a relationship
 * joined on a datetime column - that is what a calendar table looks like from
 * the outside. `fact` if the table is the many-side of at least one
 * relationship. Everything else is a dimension.
 *
 * Order matters: a calendar is also the one-side of many relationships, so the
 * date test has to run before the dimension fallback.
 */
export function inferTableRole(
  table: RawTable,
  columnsById: ReadonlyMap<number, RawColumn>,
  relationships: readonly RawRelationship[],
): TableRole {
  if (table.dataCategory?.toLowerCase() === 'time') return 'date';

  const joinedOnDate = relationships.some((relationship) => {
    if (relationship.toTableId !== table.id) return false;
    const from = columnsById.get(relationship.fromColumnId);
    const to = columnsById.get(relationship.toColumnId);

    return isDateTimeType(from?.dataType ?? -1) || isDateTimeType(to?.dataType ?? -1);
  });
  if (joinedOnDate) return 'date';

  const isManySide = relationships.some(
    (relationship) =>
      relationship.fromTableId === table.id &&
      relationship.fromCardinality === END_CARDINALITY.many,
  );

  return isManySide ? 'fact' : 'dimension';
}

export function inferIsAggregatable(
  column: RawColumn,
  role: TableRole,
  relationshipColumnIds: ReadonlySet<number>,
): boolean {
  if (!isNumericType(column.dataType)) return false;
  // A calendar's integers are year, month and surrogate keys. None are additive.
  if (role === 'date') return false;
  if (column.isKey) return false;
  if (relationshipColumnIds.has(column.id)) return false;
  if (column.summarizeBy === SUMMARIZE_BY.none) return false;

  return !NON_ADDITIVE_NAME.test(column.name);
}

/** Picks the column a `MIN`/`MAX` probe should read the model's date range from. */
function pickDateColumn(
  tables: readonly RawTable[],
  columnsByTable: ReadonlyMap<number, RawColumn[]>,
  roles: ReadonlyMap<number, TableRole>,
  relationshipColumnIds: ReadonlySet<number>,
): { table: RawTable; column: RawColumn } | null {
  const ordered = [...tables].sort((a, b) => {
    const rank = (table: RawTable) => (roles.get(table.id) === 'date' ? 0 : 1);

    return rank(a) - rank(b);
  });

  for (const table of ordered) {
    const candidates = (columnsByTable.get(table.id) ?? []).filter((column) =>
      isDateTimeType(column.dataType),
    );
    if (candidates.length === 0) continue;

    // The column the fact tables join on is the model's real time axis.
    const joined = candidates.find((column) => relationshipColumnIds.has(column.id));

    return { table, column: joined ?? (candidates[0] as RawColumn) };
  }

  return null;
}

/** Turns the four raw `INFO.*` payloads into the shape the catalogue stores. */
export function buildModel(raw: RawModel): IntrospectedModel {
  const warnings: string[] = [];

  const visibleTables = raw.tables.filter((table) => !table.isHidden);
  const hiddenTables = raw.tables.length - visibleTables.length;
  if (hiddenTables > 0) {
    warnings.push(`${hiddenTables} tabla(s) oculta(s) del modelo omitidas.`);
  }

  const tableById = new Map(visibleTables.map((table) => [table.id, table]));
  const columnsById = new Map(raw.columns.map((column) => [column.id, column]));

  const relationshipColumnIds = new Set<number>();
  for (const relationship of raw.relationships) {
    relationshipColumnIds.add(relationship.fromColumnId);
    relationshipColumnIds.add(relationship.toColumnId);
  }

  const columnsByTable = new Map<number, RawColumn[]>();
  let hiddenColumns = 0;
  for (const column of raw.columns) {
    if (!tableById.has(column.tableId)) continue;
    /*
     * Hidden columns are kept when a relationship joins on them: the generator
     * needs the key to exist even though nobody would ask about it by name.
     */
    if (column.isHidden && !relationshipColumnIds.has(column.id)) {
      hiddenColumns += 1;
      continue;
    }

    const existing = columnsByTable.get(column.tableId);
    if (existing) existing.push(column);
    else columnsByTable.set(column.tableId, [column]);
  }
  if (hiddenColumns > 0) {
    warnings.push(`${hiddenColumns} columna(s) oculta(s) omitidas.`);
  }

  const roles = new Map<number, TableRole>(
    visibleTables.map((table) => [table.id, inferTableRole(table, columnsById, raw.relationships)]),
  );

  const tables: IntrospectedTable[] = visibleTables.map((table) => {
    const role = roles.get(table.id) ?? 'dimension';

    return {
      name: table.name,
      role,
      description: table.description ?? '',
      columns: (columnsByTable.get(table.id) ?? []).map((column) => ({
        name: column.name,
        dataType: mapDataType(column.dataType),
        isAggregatable: inferIsAggregatable(column, role, relationshipColumnIds),
      })),
    };
  });

  const relationships: IntrospectedRelationship[] = [];
  for (const relationship of raw.relationships) {
    const fromTable = tableById.get(relationship.fromTableId);
    const toTable = tableById.get(relationship.toTableId);
    const fromColumn = columnsById.get(relationship.fromColumnId);
    const toColumn = columnsById.get(relationship.toColumnId);
    if (!fromTable || !toTable || !fromColumn || !toColumn) continue;

    const isManyToMany =
      relationship.fromCardinality === END_CARDINALITY.many &&
      relationship.toCardinality === END_CARDINALITY.many;
    if (isManyToMany) {
      /*
       * Reported as `*:1` because the join itself is what the generator needs to
       * know; dropping the relationship would leave it unaware the tables are
       * related at all, which produces DAX that cannot run.
       */
      warnings.push(
        `Relación muchos-a-muchos ${fromTable.name}[${fromColumn.name}] -> ${toTable.name}[${toColumn.name}] registrada como *:1.`,
      );
    }

    relationships.push({
      fromColumn: `${fromTable.name}[${fromColumn.name}]`,
      toColumn: `${toTable.name}[${toColumn.name}]`,
      cardinality: mapCardinality(relationship),
      isActive: relationship.isActive,
    });
  }

  const measures: IntrospectedMeasure[] = raw.measures
    .filter((measure) => !measure.isHidden)
    .map((measure) => ({ name: measure.name, expression: measure.expression }));
  if (measures.length === 0) {
    warnings.push(
      'El modelo no expone medidas. Describe el vocabulario de negocio en el contexto adicional.',
    );
  }

  const date = pickDateColumn(visibleTables, columnsByTable, roles, relationshipColumnIds);
  if (!date) {
    warnings.push(
      'No se ha encontrado ninguna columna de fecha: revisa el rango temporal en Ajustes.',
    );
  } else if (roles.get(date.table.id) !== 'date') {
    warnings.push(
      `Sin tabla de calendario: el rango temporal se ha leído de ${date.table.name}[${date.column.name}].`,
    );
  }

  const calculated = raw.columns.filter(
    (column) => column.columnType === COLUMN_TYPE.calculated,
  ).length;
  if (calculated > 0) {
    warnings.push(`${calculated} columna(s) calculada(s) incluidas en el catálogo.`);
  }

  return {
    tables,
    relationships,
    measures,
    dateColumn: date ? { table: date.table.name, column: date.column.name } : null,
    warnings,
  };
}
