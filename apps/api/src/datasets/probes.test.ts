import { describe, expect, it } from 'vitest';
import { quoteAlias, quoteColumnRef, quoteTableName } from '../dax/identifiers.js';
import { dateRangeQuery, readSamples, sampleQuery } from './probes.js';

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
