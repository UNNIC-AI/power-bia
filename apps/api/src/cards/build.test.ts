import type { VizDecision } from '@powerbia/contracts';
import { describe, expect, it } from 'vitest';
import { buildCard, type CardContext } from './build.js';
import { MAX_CATEGORIES, MAX_SERIES, MAX_TEMPORAL_POINTS } from './reduce.js';
import type { ResultTable } from './table.js';

const decide = (overrides: Partial<VizDecision> = {}): VizDecision => ({
  mode: 'chart',
  chartType: 'line',
  xAxis: null,
  seriesColumn: null,
  measure: 'Ventas',
  secondaryMeasure: null,
  showTrend: false,
  needsClarification: false,
  clarificationKind: null,
  clarificationQuestion: null,
  clarificationOptions: null,
  suggestedTitle: '',
  ...overrides,
});

const ctx: CardContext = { locale: 'es', labelFor: (column) => column, title: null };

describe('buildCard', () => {
  it('returns null for an empty result', () => {
    expect(buildCard({ columns: ['Ventas'], rows: [] }, decide(), ctx)).toBeNull();
  });

  it('renders a single row with no dimension as a KPI regardless of the decision', () => {
    const table: ResultTable = { columns: ['Ventas'], rows: [[1234]] };

    const card = buildCard(table, decide({ chartType: 'bar' }), ctx);

    expect(card).toMatchObject({ kind: 'kpi', value: 1234 });
  });

  it('honours an explicit table decision', () => {
    const table: ResultTable = {
      columns: ['Tienda', 'Ventas'],
      rows: [
        ['A', 1],
        ['B', 2],
      ],
    };

    const card = buildCard(table, decide({ mode: 'table', chartType: 'table' }), ctx);

    expect(card).toMatchObject({ kind: 'table', columns: ['Tienda', 'Ventas'] });
  });

  it('keeps table cells typed rather than pre-formatted', () => {
    const table: ResultTable = { columns: ['Tienda', 'Ventas'], rows: [['A', 1234.5]] };

    const card = buildCard(table, decide({ mode: 'table', chartType: 'table' }), ctx);

    expect(card).toMatchObject({ rows: [['A', 1234.5]] });
  });

  it('resolves a measure declared as Table[Column]', () => {
    const table: ResultTable = {
      columns: ['Mes', 'Ventas'],
      rows: [
        ['Ene', 5],
        ['Feb', 7],
      ],
    };

    const card = buildCard(
      table,
      decide({ chartType: 'bar', xAxis: "'Calendar'[Mes]", measure: 'Ventas' }),
      ctx,
    );

    expect(card).toMatchObject({
      kind: 'bar',
      series: [
        {
          data: [
            { label: 'Ene', value: 5 },
            { label: 'Feb', value: 7 },
          ],
        },
      ],
    });
  });

  describe('downgrades', () => {
    it('turns a combo without a second measure into a line', () => {
      const table: ResultTable = {
        columns: ['Mes', 'Ventas'],
        rows: [
          ['Ene', 1],
          ['Feb', 2],
        ],
      };

      const card = buildCard(table, decide({ chartType: 'combo', xAxis: 'Mes' }), ctx);

      expect(card?.kind).toBe('line');
    });

    it('keeps a combo when a distinct second measure is present', () => {
      const table: ResultTable = {
        columns: ['Mes', 'Ventas', 'Precio'],
        rows: [
          ['Ene', 10, 1.5],
          ['Feb', 20, 2.5],
        ],
      };

      const card = buildCard(
        table,
        decide({ chartType: 'combo', xAxis: 'Mes', measure: 'Ventas', secondaryMeasure: 'Precio' }),
        ctx,
      );

      expect(card).toMatchObject({
        kind: 'combo',
        series: [
          { type: 'bar', axis: 'primary' },
          { type: 'line', axis: 'secondary' },
        ],
      });
    });

    it('turns multi_line without a series column into a line', () => {
      const table: ResultTable = {
        columns: ['Mes', 'Ventas'],
        rows: [
          ['Ene', 1],
          ['Feb', 2],
        ],
      };

      const card = buildCard(table, decide({ chartType: 'multi_line', xAxis: 'Mes' }), ctx);

      expect(card?.kind).toBe('line');
    });

    it('turns grouped_bar without a series column into a bar', () => {
      const table: ResultTable = {
        columns: ['Mes', 'Ventas'],
        rows: [
          ['Ene', 1],
          ['Feb', 2],
        ],
      };

      const card = buildCard(table, decide({ chartType: 'grouped_bar', xAxis: 'Mes' }), ctx);

      expect(card?.kind).toBe('bar');
    });

    it('turns a single-point line into a KPI', () => {
      const table: ResultTable = { columns: ['Mes', 'Ventas'], rows: [['Ene', 42]] };

      const card = buildCard(table, decide({ chartType: 'line', xAxis: 'Mes' }), ctx);

      expect(card).toMatchObject({ kind: 'kpi', value: 42 });
    });

    it('falls back to a table when a pie has no positive values', () => {
      const table: ResultTable = {
        columns: ['Cat', 'Ventas'],
        rows: [
          ['A', 0],
          ['B', 0],
        ],
      };

      const card = buildCard(table, decide({ chartType: 'pie', xAxis: 'Cat' }), ctx);

      expect(card?.kind).toBe('table');
    });
  });

  describe('data reduction', () => {
    it('keeps only the top categories on a bar chart and says so', () => {
      const rows = Array.from({ length: MAX_CATEGORIES + 10 }, (_, i) => [`c${i}`, i]);
      const card = buildCard(
        { columns: ['Cat', 'Ventas'], rows },
        decide({ chartType: 'bar', xAxis: 'Cat' }),
        ctx,
      );

      expect(card).toMatchObject({ kind: 'bar' });
      if (card?.kind !== 'bar') throw new Error('expected a bar card');
      expect(card.series[0]?.data).toHaveLength(MAX_CATEGORIES);
      expect(card.subtitle).toContain(String(MAX_CATEGORIES));
    });

    it('sorts a numeric axis chronologically rather than by value', () => {
      const table: ResultTable = {
        columns: ['Año', 'Ventas'],
        rows: [
          [2021, 5],
          [2019, 30],
          [2020, 10],
        ],
      };

      const card = buildCard(table, decide({ chartType: 'bar', xAxis: 'Año' }), ctx);

      if (card?.kind !== 'bar') throw new Error('expected a bar card');
      expect(card.series[0]?.data.map((p) => p.label)).toEqual(['2019', '2020', '2021']);
    });

    it('folds surplus series into a single "Otros" entry', () => {
      const rows = Array.from({ length: MAX_SERIES + 5 }, (_, i) => ['Ene', `s${i}`, i + 1]);
      const card = buildCard(
        { columns: ['Mes', 'Serie', 'Ventas'], rows },
        decide({ chartType: 'multi_line', xAxis: 'Mes', seriesColumn: 'Serie' }),
        ctx,
      );

      if (card?.kind !== 'multi_line') throw new Error('expected a multi_line card');
      expect(card.series).toHaveLength(MAX_SERIES);
      expect(card.series.at(-1)?.name).toBe('Otros');
    });

    it('truncates a long time series to the most recent periods, not the largest', () => {
      const total = MAX_TEMPORAL_POINTS + 10;
      const rows = Array.from({ length: total }, (_, i) => [
        `2012/${String(i).padStart(3, '0')}`,
        total - i,
      ]);

      const card = buildCard(
        { columns: ['Año#Mes', 'Ventas'], rows },
        decide({ chartType: 'line', xAxis: 'Año#Mes' }),
        ctx,
      );

      if (card?.kind !== 'line') throw new Error('expected a line card');
      const labels = card.series[0]?.data.map((p) => p.label) ?? [];
      expect(labels).toHaveLength(MAX_TEMPORAL_POINTS);
      expect(labels[0]).toBe('2012/010');
      expect(labels.at(-1)).toBe(`2012/${String(total - 1).padStart(3, '0')}`);
    });
  });
});
