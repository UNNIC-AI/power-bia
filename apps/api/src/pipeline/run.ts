import type {
  Card,
  ChartType,
  DatasetContext,
  FilterSelection,
  Locale,
  VizDecision,
} from '@powerbia/contracts';
import { buildCard } from '../cards/build.js';
import { columnValues, isNumericColumn, type ResultTable } from '../cards/table.js';
import { createLabelResolver, createOrderResolver } from '../datasets/context.js';
import type { DaxExecutor, PowerBiConnection } from '../dax/executor.js';
import { applyFilters } from '../dax/filters.js';
import type { HistoryEntry } from './stages.js';
import * as stages from './stages.js';

const MAX_FILTER_VALUES = 100;

const MESSAGES = {
  outOfRange: {
    es: (requested: string, available: string) =>
      `No tengo datos para ese periodo. Has pedido ${requested} y los datos disponibles cubren ${available}.`,
    en: (requested: string, available: string) =>
      `I don't have data for that period. You asked for ${requested} and the available data covers ${available}.`,
  },
  filterCreated: {
    es: (title: string, count: number) => `Filtro "${title}" creado con ${count} valores.`,
    en: (title: string, count: number) => `Filter "${title}" created with ${count} values.`,
  },
  filterFailed: {
    es: () => 'No he podido obtener los valores para ese filtro.',
    en: () => "I couldn't load the values for that filter.",
  },
  howToSee: {
    es: () => '¿Cómo quieres verlo?',
    en: () => 'How would you like to see it?',
  },
} as const;

export interface PipelineInput {
  text: string;
  dataset: DatasetContext;
  connection: PowerBiConnection;
  executor: DaxExecutor;
  locale: Locale;
  filters: readonly FilterSelection[];
  forcedChartType: ChartType | null;
  history: readonly HistoryEntry[];
}

export interface PipelineOutput {
  card: Card | null;
  dax: string | null;
  decision: VizDecision | null;
  resultColumns: string[];
  /** A fixed reply: clarification, out-of-range notice, or filter confirmation. */
  text: string | null;
  /** Model prose, streamed to the client. Mutually exclusive with `text`. */
  stream: ReturnType<typeof stages.answerData> | null;
}

const EMPTY: PipelineOutput = {
  card: null,
  dax: null,
  decision: null,
  resultColumns: [],
  text: null,
  stream: null,
};

function applyForcedChartType(decision: VizDecision, forced: ChartType | null): VizDecision {
  if (!forced) return decision;

  return { ...decision, chartType: forced, mode: forced === 'table' ? 'table' : 'chart' };
}

/**
 * Numeric columns that came back empty for every row.
 *
 * A measure guarded by `ISINSCOPE` returns BLANK unless the query groups by one
 * of the columns it names, and a filter on a table that joins nothing is simply
 * ignored. Both produce a well-formed query, a result Power BI is happy with,
 * and a number that means nothing - which the writer then narrates as a finding
 * ("no hubo tiempo productivo") rather than as the empty result it is. Naming
 * them lets it hedge instead.
 */
function blankMeasureColumns(table: ResultTable): string[] {
  return table.columns.filter((column) => {
    const values = columnValues(table, column);
    if (values.length === 0) return false;

    // All BLANK is the ISINSCOPE case; all zero is the inert-filter case.
    if (values.every((value) => value === null)) return true;

    return isNumericColumn(table, column) && values.every((value) => value === null || value === 0);
  });
}

function toClarification(decision: VizDecision, locale: Locale): PipelineOutput {
  const question = decision.clarificationQuestion ?? MESSAGES.howToSee[locale]();

  const card: Card | null =
    decision.clarificationKind === 'visual' && decision.clarificationOptions?.length
      ? {
          kind: 'choice',
          title: question,
          subtitle: null,
          options: decision.clarificationOptions.map(({ id, label }) => ({ id, label })),
        }
      : null;

  return { ...EMPTY, decision, card, text: question };
}

async function createFilterCard(input: PipelineInput): Promise<PipelineOutput> {
  const { text, dataset, locale, connection, executor } = input;

  const target = await stages.resolveFilterColumn({ text, dataset, locale });
  const outcome = await executor.execute(
    connection,
    `EVALUATE DISTINCT('${target.table}'[${target.column}])`,
  );

  if (!outcome.ok || outcome.result.rows.length === 0) {
    return { ...EMPTY, text: MESSAGES.filterFailed[locale]() };
  }

  const values = [
    ...new Set(
      outcome.result.rows
        .map((row) => row[0])
        .filter((value) => value !== null && value !== '')
        .map(String),
    ),
  ]
    .sort((a, b) => a.localeCompare(b, locale))
    .slice(0, MAX_FILTER_VALUES);

  return {
    ...EMPTY,
    card: {
      kind: 'filter',
      title: target.title,
      subtitle: null,
      table: target.table,
      column: target.column,
      values,
      selected: [],
    },
    text: MESSAGES.filterCreated[locale](target.title, values.length),
  };
}

async function answerQuery(input: PipelineInput, decision: VizDecision): Promise<PipelineOutput> {
  const { text, dataset, locale, filters, connection, executor, history } = input;

  const generated = await stages.generateDax({ text, decision, dataset, locale, history });

  if (generated.outcome === 'needs_clarification') {
    return { ...EMPTY, decision, text: generated.question };
  }

  if (generated.outcome === 'out_of_range') {
    return {
      ...EMPTY,
      decision,
      text: MESSAGES.outOfRange[locale](generated.requestedPeriod, generated.availableRange),
    };
  }

  // Filters are re-applied around the repaired query too, so the model never
  // becomes responsible for preserving the dashboard's filter state.
  let dax = generated.dax;
  let outcome = await executor.execute(connection, applyFilters(dax, filters));

  if (!outcome.ok) {
    const repaired = await stages.repairDax({
      text,
      failedDax: dax,
      error: outcome.error,
      dataset,
      locale,
    });
    const retry = await executor.execute(connection, applyFilters(repaired, filters));

    if (retry.ok) {
      dax = repaired;
      outcome = retry;
    }
  }

  const table: ResultTable | null = outcome.ok
    ? { columns: outcome.result.columns, rows: outcome.result.rows }
    : null;

  const card = table
    ? buildCard(table, decision, {
        locale,
        labelFor: createLabelResolver(dataset, locale),
        orderFor: createOrderResolver(dataset),
        title: decision.suggestedTitle || null,
      })
    : null;

  return {
    card,
    dax: applyFilters(dax, filters),
    decision,
    resultColumns: table?.columns ?? [],
    text: null,
    stream: stages.answerData({
      text,
      result: table,
      error: outcome.ok ? null : outcome.error,
      blankColumns: table ? blankMeasureColumns(table) : [],
      decision,
      dataset,
      locale,
    }),
  };
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const { text, dataset, locale, history, forcedChartType } = input;

  const intent = await stages.routeIntent(text, dataset, locale);

  if (intent === 'conversation') {
    return { ...EMPTY, stream: stages.answerConversation({ text, dataset, locale }) };
  }

  if (intent === 'create_filter') {
    return createFilterCard(input);
  }

  const previousColumns =
    intent === 'rechart_previous'
      ? (history.findLast((entry) => entry.dax)?.resultColumns ?? undefined)
      : undefined;

  const decision = applyForcedChartType(
    await stages.decideVisualization({
      text,
      dataset,
      locale,
      history,
      ...(previousColumns ? { availableColumns: previousColumns } : {}),
    }),
    forcedChartType,
  );

  if (decision.needsClarification) return toClarification(decision, locale);

  return answerQuery(input, decision);
}
