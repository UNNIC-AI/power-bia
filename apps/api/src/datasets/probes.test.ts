import type { DaxResult } from '@powerbia/contracts';
import { describe, expect, it } from 'vitest';
import { quoteAlias, quoteColumnRef, quoteTableName } from '../dax/identifiers.js';
import type { IntrospectedTable } from './heuristics.js';
import {
  dateRangeQuery,
  orderCandidates,
  orderedValuesQuery,
  readOrderedValues,
  readSamples,
  sampleQuery,
} from './probes.js';

function result(columns: string[], rows: (string | number | boolean | null)[][]): DaxResult {
  return { columns, rows, durationMs: 1 };
}

describe('identifier quoting', () => {
  it('escapes the delimiters a customer model can legitimately contain', () => {
    expect(quoteTableName("It's Sales")).toBe("'It''s Sales'");
    expect(quoteColumnRef('Ventas', 'Total [EUR]')).toBe("'Ventas'[Total [EUR]]]");
    expect(quoteAlias('a "b"')).toBe('"a ""b"""');
  });
});

describe('sampleQuery', () => {
  it('limits rows in the DAX, since the gateway caps nothing', () => {
    const dax = sampleQuery('Items', ['Item Number', 'State Bottle Cost']);

    expect(dax).toBe(
      "EVALUATE SELECTCOLUMNS(TOPN(5, 'Items'), \"c0\", 'Items'[Item Number], \"c1\", 'Items'[State Bottle Cost])",
    );
  });
});

describe('readSamples', () => {
  const columns = ['Item Number', 'Item Description', 'Date'];

  it('takes the first non-blank value per column', () => {
    const samples = readSamples(
      {
        columns: ['[c0]', '[c1]', '[c2]'],
        rows: [
          [null, '', null],
          ['9001', 'Bacardi', '2012-07-02T00:00:00'],
          ['9002', 'Otro', '2013-01-01T00:00:00'],
        ],
        durationMs: 1,
      },
      columns,
    );

    expect(samples.get('Item Number')).toBe('9001');
    expect(samples.get('Item Description')).toBe('Bacardi');
  });

  it('trims a timestamp to the date the prompt should show', () => {
    const samples = readSamples(
      { columns: ['[c0]'], rows: [['2012-07-02T00:00:00']], durationMs: 1 },
      ['Date'],
    );

    expect(samples.get('Date')).toBe('2012-07-02');
  });

  it('yields null for a column the result does not carry', () => {
    const samples = readSamples({ columns: ['[c0]'], rows: [['x']], durationMs: 1 }, columns);

    expect(samples.get('Date')).toBeNull();
  });

  it('yields null when every row is blank', () => {
    const samples = readSamples({ columns: ['[c0]'], rows: [[null], ['']], durationMs: 1 }, [
      'Item Number',
    ]);

    expect(samples.get('Item Number')).toBeNull();
  });
});

describe('dateRangeQuery', () => {
  it('asks for both ends in one row', () => {
    expect(dateRangeQuery('Calendar', 'Date')).toBe(
      'EVALUATE ROW("dmin", MIN(\'Calendar\'[Date]), "dmax", MAX(\'Calendar\'[Date]))',
    );
  });
});

describe('canonical value order', () => {
  const calendar = (columns: { name: string; dataType: string; sortByColumn?: string | null }[]) =>
    ({
      name: 'dim_Calendario',
      role: 'date' as const,
      description: '',
      columns: columns.map((column) => ({
        name: column.name,
        dataType: column.dataType,
        isAggregatable: false,
        sortByColumn: column.sortByColumn ?? null,
      })),
    }) satisfies IntrospectedTable;

  it('quotes the table and both columns', () => {
    expect(orderedValuesQuery("Ventas 'B'", 'Nombre del mes', 'Mes')).toContain(
      "'Ventas ''B'''[Nombre del mes], 'Ventas ''B'''[Mes]",
    );
  });

  it('reads the labels in key order', () => {
    const values = readOrderedValues(
      result(
        ['dim_Calendario[Nombre del mes]', 'dim_Calendario[Mes]'],
        [
          ['enero', 1],
          ['febrero', 2],
          ['marzo', 3],
        ],
      ),
    );

    expect(values).toEqual(['enero', 'febrero', 'marzo']);
  });

  /*
   * The guard that stops a month name being ordered by a year that happens to
   * have as many distinct values as it does.
   */
  it('rejects a pairing that is not one-to-one', () => {
    const repeatedKey = readOrderedValues(
      result(
        ['[dia]', '[mes]'],
        [
          ['lunes', 1],
          ['martes', 1],
        ],
      ),
    );
    const repeatedLabel = readOrderedValues(
      result(
        ['[dia]', '[mes]'],
        [
          ['lunes', 1],
          ['lunes', 2],
        ],
      ),
    );

    expect(repeatedKey).toBeNull();
    expect(repeatedLabel).toBeNull();
  });

  it('rejects a blank on either side', () => {
    expect(readOrderedValues(result(['[a]', '[b]'], [['enero', null]]))).toBeNull();
  });

  it('takes a declared sort-by column on any table, without a cardinality match', () => {
    const table = {
      name: 'dim_Turno',
      role: 'dimension' as const,
      description: '',
      columns: [
        { name: 'Turno', dataType: 'texto', isAggregatable: false, sortByColumn: 'Orden' },
        { name: 'Orden', dataType: 'entero', isAggregatable: false, sortByColumn: null },
      ],
    } satisfies IntrospectedTable;

    expect(orderCandidates([table], new Map())).toEqual([
      { table: 'dim_Turno', column: 'Turno', sortBy: 'Orden' },
    ]);
  });

  it('drops a declared sort-by whose target is not in the catalogue', () => {
    const table = calendar([{ name: 'Mes', dataType: 'texto', sortByColumn: 'Oculta' }]);

    expect(orderCandidates([table], new Map())).toEqual([]);
  });

  it('pairs a text column with the integer of matching cardinality', () => {
    const table = calendar([
      { name: 'Nombre del mes', dataType: 'texto' },
      { name: 'Mes', dataType: 'entero' },
      { name: 'Año', dataType: 'entero' },
    ]);
    const counts = new Map([
      [
        'dim_Calendario',
        new Map([
          ['Nombre del mes', 8],
          ['Mes', 8],
          ['Año', 1],
        ]),
      ],
    ]);

    expect(orderCandidates([table], counts)).toEqual([
      { table: 'dim_Calendario', column: 'Nombre del mes', sortBy: 'Mes' },
    ]);
  });

  it('guesses no order for a text column with no matching integer', () => {
    const table = calendar([
      { name: 'Nombre del día', dataType: 'texto' },
      { name: 'Mes', dataType: 'entero' },
    ]);
    const counts = new Map([
      [
        'dim_Calendario',
        new Map([
          ['Nombre del día', 7],
          ['Mes', 8],
        ]),
      ],
    ]);

    expect(orderCandidates([table], counts)).toEqual([]);
  });

  /** Guessing is for calendars; anywhere else the model has to say so. */
  it('does not guess a pairing outside a date table', () => {
    const table = {
      name: 'dim_Articulo',
      role: 'dimension' as const,
      description: '',
      columns: [
        { name: 'Talla', dataType: 'texto', isAggregatable: false, sortByColumn: null },
        { name: 'Orden', dataType: 'entero', isAggregatable: false, sortByColumn: null },
      ],
    } satisfies IntrospectedTable;
    const counts = new Map([
      [
        'dim_Articulo',
        new Map([
          ['Talla', 3],
          ['Orden', 3],
        ]),
      ],
    ]);

    expect(orderCandidates([table], counts)).toEqual([]);
  });
});
