import type { DatasetContext, VizDecision } from '@powerbia/contracts';
import { describe, expect, it } from 'vitest';
import { buildInstructions, describeProjection, ROUTER_ROLE } from './prompts.js';

const dataset: DatasetContext = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'Ventas',
  description: 'Facturas de venta.',
  extraContext: '',
  dateRange: { min: '2012-01-01', max: '2021-12-31' },
  tables: [
    {
      name: 'TBL_VTA_CAB',
      role: 'fact',
      description: '',
      columns: [
        {
          name: 'IMP_TOT',
          dataType: 'decimal',
          sampleValue: '12.5',
          isAggregatable: true,
          note: null,
          labels: {},
        },
      ],
    },
  ],
  relationships: [],
  measures: [],
  synonyms: [],
};

describe('buildInstructions with extra context', () => {
  it('is absent when the admin has written nothing', () => {
    const instructions = buildInstructions({ role: ROUTER_ROLE, dataset, locale: 'es' });

    expect(instructions).not.toContain('Contexto adicional');
  });

  it('reaches a stage that gets no schema, which is the point of it', () => {
    const instructions = buildInstructions({
      role: ROUTER_ROLE,
      dataset: { ...dataset, extraContext: 'TBL_VTA_CAB es la cabecera de ventas.' },
      locale: 'es',
    });

    // The router sees no schema at all, so this is its only clue about the model.
    expect(instructions).not.toContain('Estructura del modelo de datos');
    expect(instructions).toContain('TBL_VTA_CAB es la cabecera de ventas.');
  });

  it('sits before the role, so the stage instruction stays last', () => {
    const instructions = buildInstructions({
      role: ROUTER_ROLE,
      dataset: { ...dataset, extraContext: 'Contexto del administrador.' },
      locale: 'es',
      includeSchema: true,
    });

    expect(instructions.indexOf('Estructura del modelo de datos')).toBeLessThan(
      instructions.indexOf('Contexto del administrador.'),
    );
    expect(instructions.indexOf('Contexto del administrador.')).toBeLessThan(
      instructions.indexOf(ROUTER_ROLE),
    );
  });

  it('leaves the schema section byte-identical, since the prompts are tuned to it', () => {
    const withContext = buildInstructions({
      role: ROUTER_ROLE,
      dataset: { ...dataset, extraContext: 'Algo.' },
      locale: 'es',
      includeSchema: true,
    });
    const without = buildInstructions({
      role: ROUTER_ROLE,
      dataset,
      locale: 'es',
      includeSchema: true,
    });

    const schemaOf = (text: string) =>
      text.slice(
        text.indexOf('Estructura del modelo de datos'),
        text.indexOf('Sinónimos frecuentes del usuario'),
      );

    expect(schemaOf(withContext)).toBe(schemaOf(without));
  });
});

describe('describeProjection', () => {
  const decision: VizDecision = {
    mode: 'chart',
    chartType: 'kpi',
    xAxis: null,
    seriesColumn: null,
    measure: 'Botellas vendidas',
    secondaryMeasure: null,
    showTrend: false,
    needsClarification: false,
    clarificationKind: null,
    clarificationQuestion: null,
    clarificationOptions: null,
    suggestedTitle: 'Packs maestros vendidos en 2021',
  };

  it('is empty without a decision', () => {
    expect(describeProjection(null)).toBe('');
  });

  /*
   * The regression this guards: the alias is the vocabulary name, so a packs
   * question returns a packs value in a column called "Botellas vendidas". Without
   * this frame the writer divided again and its prose contradicted the chart.
   */
  it('names what the value is and forbids reconverting it', () => {
    const text = describeProjection(decision);

    expect(text).toContain('Packs maestros vendidos en 2021');
    expect(text).toContain('Botellas vendidas');
    expect(text).toContain('sin reconvertir');
  });
});
