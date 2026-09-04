import type { DaxResult } from '@powerbia/contracts';
import { describe, expect, it } from 'vitest';
import { buildModel, inferIsAggregatable, mapDataType } from './heuristics.js';
import {
  COLUMN_TYPE,
  DATA_TYPE,
  END_CARDINALITY,
  parseColumns,
  parseMeasures,
  parseRelationships,
  parseTables,
  SUMMARIZE_BY,
} from './info-queries.js';

/**
 * The fixtures below mirror what `INFO.*` returns for the Iowa Liquor Sales
 * model, whose hand-written catalogue in `packages/db/src/seed.ts` is the
 * expected output. If the heuristics stop reproducing it, they have regressed.
 *
 * Column orders are deliberately shuffled and padded with fields the parsers do
 * not read, because that is the failure mode being guarded against: a capacity
 * upgrade that inserts a column would break a positional read.
 */

function result(columns: string[], rows: (string | number | boolean | null)[][]): DaxResult {
  return { columns, rows, durationMs: 1 };
}

const TABLES = result(
  ['[ID]', '[ModelID]', '[Name]', '[DataCategory]', '[IsHidden]', '[Description]'],
  [
    [1, 1, 'Calendar', 'Time', false, 'Tabla de calendario.'],
    [2, 1, 'Invoices', null, false, null],
    [3, 1, 'Items', null, false, null],
    [4, 1, 'Stores', null, false, null],
    [5, 1, 'LocalDateTable_x', null, true, null],
    // The template the LocalDateTables are stamped from. Power BI reports it visible.
    [6, 1, 'DateTableTemplate_x', null, false, null],
  ],
);

const COLUMNS = result(
  [
    '[ID]',
    '[TableID]',
    '[ExplicitName]',
    '[InferredName]',
    '[ExplicitDataType]',
    '[InferredDataType]',
    '[IsHidden]',
    '[IsKey]',
    '[SummarizeBy]',
    '[Type]',
    '[SortByColumnID]',
  ],
  [
    // Calendar
    [10, 1, 'Date', 'Date', DATA_TYPE.dateTime, 0, false, true, SUMMARIZE_BY.none, 1, null],
    [11, 1, 'FechaSK', 'FechaSK', DATA_TYPE.int64, 0, false, false, SUMMARIZE_BY.default, 1, null],
    [12, 1, '#Año', '#Año', DATA_TYPE.int64, 0, false, false, SUMMARIZE_BY.default, 1, null],
    // Sorted by FechaSK: the model's own statement that "enero" precedes "febrero".
    [13, 1, 'Mes', 'Mes', DATA_TYPE.string, 0, false, false, SUMMARIZE_BY.none, 1, 11],
    // Invoices
    [20, 2, 'Date', 'Date', DATA_TYPE.dateTime, 0, false, false, SUMMARIZE_BY.none, 1],
    [21, 2, 'Item Number', 'Item Number', DATA_TYPE.string, 0, false, false, SUMMARIZE_BY.none, 1],
    [
      22,
      2,
      'Store Number',
      'Store Number',
      DATA_TYPE.string,
      0,
      false,
      false,
      SUMMARIZE_BY.none,
      1,
    ],
    [23, 2, 'Bottles Sold', 'Bottles Sold', DATA_TYPE.int64, 0, false, false, SUMMARIZE_BY.sum, 1],
    // An engine artefact: no explicit name, and a RowNumber type.
    [29, 2, null, 'RowNumber-9f2', DATA_TYPE.int64, 0, true, false, 1, COLUMN_TYPE.rowNumber],
    // Items
    [30, 3, 'Item Number', 'Item Number', DATA_TYPE.string, 0, false, true, SUMMARIZE_BY.none, 1],
    [
      31,
      3,
      'Item Description',
      'Item Description',
      DATA_TYPE.string,
      0,
      false,
      false,
      SUMMARIZE_BY.none,
      1,
    ],
    [
      32,
      3,
      'State Bottle Cost',
      'State Bottle Cost',
      DATA_TYPE.decimal,
      0,
      false,
      false,
      SUMMARIZE_BY.sum,
      1,
    ],
    [
      33,
      3,
      'State Bottle Retail',
      'State Bottle Retail',
      DATA_TYPE.decimal,
      0,
      false,
      false,
      SUMMARIZE_BY.sum,
      1,
    ],
    // Declared Automatic, so the type has to come from InferredDataType.
    [
      34,
      3,
      'Category Name',
      'Category Name',
      DATA_TYPE.automatic,
      DATA_TYPE.string,
      false,
      false,
      SUMMARIZE_BY.none,
      1,
    ],
    // Stores
    [40, 4, 'Store Number', 'Store Number', DATA_TYPE.string, 0, false, true, SUMMARIZE_BY.none, 1],
    [41, 4, 'Store Name', 'Store Name', DATA_TYPE.string, 0, false, false, SUMMARIZE_BY.none, 1],
    // Hidden and joined on nothing: dropped from the catalogue.
    [42, 4, 'Internal Flag', 'Internal Flag', DATA_TYPE.boolean, 0, true, false, 1, 1],
    // Belongs to a hidden table, so it never reaches the catalogue either.
    [50, 5, 'Date', 'Date', DATA_TYPE.dateTime, 0, true, false, 1, 1],
  ],
);

const RELATIONSHIPS = result(
  [
    '[FromTableID]',
    '[FromColumnID]',
    '[FromCardinality]',
    '[ToTableID]',
    '[ToColumnID]',
    '[ToCardinality]',
    '[IsActive]',
  ],
  [
    [2, 21, END_CARDINALITY.many, 3, 30, END_CARDINALITY.one, true],
    [2, 22, END_CARDINALITY.many, 4, 40, END_CARDINALITY.one, true],
    [2, 20, END_CARDINALITY.many, 1, 10, END_CARDINALITY.one, true],
  ],
);

const MEASURES = result(
  ['[ID]', '[TableID]', '[Name]', '[Expression]', '[IsHidden]'],
  [
    [1, 2, 'Botellas vendidas', "SUM('Invoices'[Bottles Sold])", false],
    [2, 2, 'Oculta', 'COUNTROWS(Invoices)', true],
  ],
);

function iowa() {
  return buildModel({
    tables: parseTables(TABLES),
    columns: parseColumns(COLUMNS),
    measures: parseMeasures(MEASURES),
    relationships: parseRelationships(RELATIONSHIPS),
  });
}

describe('mapDataType', () => {
  it('produces the Spanish tokens the prompt prints verbatim', () => {
    expect(mapDataType(DATA_TYPE.string)).toBe('texto');
    expect(mapDataType(DATA_TYPE.int64)).toBe('entero');
    expect(mapDataType(DATA_TYPE.decimal)).toBe('decimal');
    expect(mapDataType(DATA_TYPE.double)).toBe('decimal');
    expect(mapDataType(DATA_TYPE.dateTime)).toBe('datetime');
    expect(mapDataType(DATA_TYPE.boolean)).toBe('booleano');
    expect(mapDataType(999)).toBe('desconocido');
  });
});

describe('buildModel on the Iowa model', () => {
  it('reproduces the table roles the seed sets by hand', () => {
    const roles = new Map(iowa().tables.map((table) => [table.name, table.role]));

    expect(roles.get('Calendar')).toBe('date');
    expect(roles.get('Invoices')).toBe('fact');
    expect(roles.get('Items')).toBe('dimension');
    expect(roles.get('Stores')).toBe('dimension');
  });

  it('marks Bottles Sold summable and the unit prices not', () => {
    const columns = new Map(
      iowa().tables.flatMap((table) =>
        table.columns.map((column) => [`${table.name}[${column.name}]`, column]),
      ),
    );

    expect(columns.get('Invoices[Bottles Sold]')?.isAggregatable).toBe(true);
    expect(columns.get('Items[State Bottle Cost]')?.isAggregatable).toBe(false);
    expect(columns.get('Items[State Bottle Retail]')?.isAggregatable).toBe(false);
  });

  it('never marks a calendar integer summable', () => {
    const calendar = iowa().tables.find((table) => table.name === 'Calendar');
    const aggregatable = calendar?.columns.filter((column) => column.isAggregatable) ?? [];

    // #Año and FechaSK are int64 and would pass every other rule.
    expect(aggregatable).toEqual([]);
  });

  it('resolves a declared SortByColumn to its name, and reports none otherwise', () => {
    const calendar = iowa().tables.find((table) => table.name === 'Calendar');
    const byName = new Map(calendar?.columns.map((column) => [column.name, column]));

    expect(byName.get('Mes')?.sortByColumn).toBe('FechaSK');
    expect(byName.get('#Año')?.sortByColumn).toBeNull();
  });

  it('drops engine artefacts, hidden columns and hidden tables', () => {
    const model = iowa();
    const names = model.tables.flatMap((table) =>
      table.columns.map((column) => `${table.name}[${column.name}]`),
    );

    expect(model.tables.map((table) => table.name)).not.toContain('LocalDateTable_x');
    expect(model.tables.map((table) => table.name)).not.toContain('DateTableTemplate_x');
    expect(names.some((name) => name.includes('RowNumber'))).toBe(false);
    expect(names).not.toContain('Stores[Internal Flag]');
    expect(names).toContain('Stores[Store Number]');
  });

  it('falls back to InferredDataType when the type is Automatic', () => {
    const items = iowa().tables.find((table) => table.name === 'Items');
    const category = items?.columns.find((column) => column.name === 'Category Name');

    expect(category?.dataType).toBe('texto');
  });

  it('renders relationships as Table[Column] pairs with cardinality', () => {
    expect(iowa().relationships).toEqual([
      {
        fromColumn: 'Invoices[Item Number]',
        toColumn: 'Items[Item Number]',
        cardinality: '*:1',
        isActive: true,
      },
      {
        fromColumn: 'Invoices[Store Number]',
        toColumn: 'Stores[Store Number]',
        cardinality: '*:1',
        isActive: true,
      },
      {
        fromColumn: 'Invoices[Date]',
        toColumn: 'Calendar[Date]',
        cardinality: '*:1',
        isActive: true,
      },
    ]);
  });

  it('reads the date range from the calendar column the facts join on', () => {
    expect(iowa().dateColumn).toEqual({ table: 'Calendar', column: 'Date' });
  });

  it('keeps visible measures and drops hidden ones', () => {
    expect(iowa().measures).toEqual([
      { name: 'Botellas vendidas', expression: "SUM('Invoices'[Bottles Sold])" },
    ]);
  });

  it('reports what it skipped so an admin can act on it', () => {
    const warnings = iowa().warnings.join('\n');

    expect(warnings).toContain('oculta');
  });
});

describe('inferIsAggregatable', () => {
  const column = {
    id: 1,
    tableId: 1,
    name: 'Importe',
    dataType: DATA_TYPE.decimal,
    dataCategory: null,
    description: null,
    isHidden: false,
    isKey: false,
    summarizeBy: SUMMARIZE_BY.default,
    columnType: COLUMN_TYPE.data,
    sortByColumnId: null,
  };

  it('accepts a plain numeric measure column', () => {
    expect(inferIsAggregatable(column, 'fact', new Set())).toBe(true);
  });

  it('rejects a key, a relationship endpoint and SummarizeBy None', () => {
    expect(inferIsAggregatable({ ...column, isKey: true }, 'fact', new Set())).toBe(false);
    expect(inferIsAggregatable(column, 'fact', new Set([1]))).toBe(false);
    expect(
      inferIsAggregatable({ ...column, summarizeBy: SUMMARIZE_BY.none }, 'fact', new Set()),
    ).toBe(false);
  });

  it('rejects text', () => {
    expect(inferIsAggregatable({ ...column, dataType: DATA_TYPE.string }, 'fact', new Set())).toBe(
      false,
    );
  });
});

describe('cardinality and many-to-many', () => {
  const tables = result(
    ['[ID]', '[Name]', '[IsHidden]'],
    [
      [1, 'A', false],
      [2, 'B', false],
    ],
  );
  const columns = result(
    ['[ID]', '[TableID]', '[ExplicitName]', '[ExplicitDataType]', '[Type]'],
    [
      [10, 1, 'Key', DATA_TYPE.string, 1],
      [20, 2, 'Key', DATA_TYPE.string, 1],
    ],
  );

  function withCardinality(from: number, to: number) {
    return buildModel({
      tables: parseTables(tables),
      columns: parseColumns(columns),
      measures: parseMeasures(result(['[Name]'], [])),
      relationships: parseRelationships(
        result(
          [
            '[FromTableID]',
            '[FromColumnID]',
            '[FromCardinality]',
            '[ToTableID]',
            '[ToColumnID]',
            '[ToCardinality]',
            '[IsActive]',
          ],
          [[1, 10, from, 2, 20, to, true]],
        ),
      ),
    });
  }

  it('maps one-to-one and one-to-many', () => {
    expect(
      withCardinality(END_CARDINALITY.one, END_CARDINALITY.one).relationships[0]?.cardinality,
    ).toBe('1:1');
    expect(
      withCardinality(END_CARDINALITY.one, END_CARDINALITY.many).relationships[0]?.cardinality,
    ).toBe('1:*');
  });

  it('keeps a many-to-many join and warns instead of dropping it', () => {
    const model = withCardinality(END_CARDINALITY.many, END_CARDINALITY.many);

    expect(model.relationships).toHaveLength(1);
    expect(model.warnings.join('\n')).toContain('muchos-a-muchos');
  });
});
