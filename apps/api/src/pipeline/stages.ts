import { createOpenAI } from '@ai-sdk/openai';
import {
  type DatasetContext,
  type DaxGeneration,
  type FilterColumn,
  filterColumnSchema,
  type Intent,
  intentSchema,
  type Locale,
  type VizDecision,
  vizDecisionSchema,
} from '@powerbia/contracts';
import { generateText, Output, streamText } from 'ai';
import { z } from 'zod';
import { cleanGeneratedDax } from '../dax/sanitize.js';
import { env } from '../env.js';
import {
  buildInstructions,
  CONVERSATION_ROLE,
  describeRequiredShape,
  FILTER_IDENTIFIER_ROLE,
  GENERATOR_ROLE,
  REPAIRER_ROLE,
  ROUTER_ROLE,
  VIZ_DECIDER_ROLE,
  WRITER_ROLE,
} from './prompts.js';

const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
const model = openai(env.LLM_MODEL);

const DETERMINISTIC = { temperature: 0 } as const;

export interface HistoryEntry {
  question: string;
  dax: string | null;
  resultColumns: string[] | null;
}

function formatHistory(history: readonly HistoryEntry[]): string {
  if (history.length === 0) return 'Sin contexto previo.';

  return history
    .map((entry, index) => {
      const parts = [`${index + 1}. Pregunta: ${entry.question}`];
      if (entry.dax) parts.push(`   DAX: ${entry.dax}`);
      if (entry.resultColumns?.length) {
        parts.push(`   Columnas del resultado: ${entry.resultColumns.join(', ')}`);
      }
      return parts.join('\n');
    })
    .join('\n');
}

export async function routeIntent(
  text: string,
  dataset: DatasetContext,
  locale: Locale,
): Promise<Intent> {
  const { output } = await generateText({
    model,
    ...DETERMINISTIC,
    instructions: buildInstructions({ role: ROUTER_ROLE, dataset, locale }),
    prompt: text,
    output: Output.object({ schema: z.object({ intent: intentSchema }) }),
  });

  return output.intent;
}

export async function decideVisualization(options: {
  text: string;
  dataset: DatasetContext;
  locale: Locale;
  history: readonly HistoryEntry[];
  availableColumns?: readonly string[];
}): Promise<VizDecision> {
  const { text, dataset, locale, history, availableColumns } = options;

  const reuseHint = availableColumns?.length
    ? `\nColumnas YA disponibles de una consulta anterior (sin volver a consultar Power BI si tu
decisión puede satisfacerse solo con ellas): ${availableColumns.join(', ')}`
    : '';

  const { output } = await generateText({
    model,
    ...DETERMINISTIC,
    instructions: buildInstructions({
      role: VIZ_DECIDER_ROLE,
      dataset,
      locale,
      includeSchema: true,
    }),
    prompt: `Contexto reciente de consultas:
${formatHistory(history)}

Pregunta actual:
${text}${reuseHint}

Decide la visualización.`,
    output: Output.object({ schema: vizDecisionSchema }),
  });

  return output;
}

/**
 * Flat wire schema rather than the discriminated union from contracts: OpenAI's
 * strict structured output does not allow `anyOf` at the schema root.
 */
const daxOutputSchema = z.object({
  outcome: z.enum(['dax', 'needs_clarification', 'out_of_range']),
  dax: z.string().nullable(),
  clarificationQuestion: z.string().nullable(),
  requestedPeriod: z.string().nullable(),
  availableRange: z.string().nullable(),
});

function toDaxGeneration(
  output: z.infer<typeof daxOutputSchema>,
  dataset: DatasetContext,
): DaxGeneration {
  if (output.outcome === 'needs_clarification') {
    return {
      outcome: 'needs_clarification',
      question: output.clarificationQuestion ?? '¿Puedes concretar un poco más la pregunta?',
    };
  }

  if (output.outcome === 'out_of_range') {
    return {
      outcome: 'out_of_range',
      requestedPeriod: output.requestedPeriod ?? '',
      availableRange:
        output.availableRange ?? `${dataset.dateRange.min} — ${dataset.dateRange.max}`,
    };
  }

  return { outcome: 'dax', dax: cleanGeneratedDax(output.dax ?? '') };
}

export async function generateDax(options: {
  text: string;
  decision: VizDecision;
  dataset: DatasetContext;
  locale: Locale;
  history: readonly HistoryEntry[];
}): Promise<DaxGeneration> {
  const { text, decision, dataset, locale, history } = options;

  const { output } = await generateText({
    model,
    ...DETERMINISTIC,
    instructions: buildInstructions({
      role: GENERATOR_ROLE,
      dataset,
      locale,
      includeSchema: true,
      includeTemporal: true,
    }),
    prompt: `Contexto reciente de consultas:
${formatHistory(history)}

${describeRequiredShape(decision)}

Pregunta actual:
${text}

Genera la consulta DAX considerando el contexto y la forma de datos requerida.`,
    output: Output.object({ schema: daxOutputSchema }),
  });

  return toDaxGeneration(output, dataset);
}

export async function repairDax(options: {
  text: string;
  failedDax: string;
  error: string;
  dataset: DatasetContext;
  locale: Locale;
}): Promise<string> {
  const { text, failedDax, error, dataset, locale } = options;

  const { output } = await generateText({
    model,
    ...DETERMINISTIC,
    instructions: buildInstructions({
      role: REPAIRER_ROLE,
      dataset,
      locale,
      includeSchema: true,
      includeTemporal: true,
    }),
    prompt: `Pregunta original:
${text}

DAX que falló:
${failedDax}

Error devuelto por Power BI:
${error}

Genera el DAX corregido.`,
    output: Output.object({ schema: z.object({ dax: z.string() }) }),
  });

  return cleanGeneratedDax(output.dax);
}

const MAX_CONTEXT_ROWS = 50;

function describeResult(
  result: { columns: string[]; rows: unknown[][] } | null,
  error: string | null,
): string {
  if (error) return `Error al ejecutar: ${error}`;
  if (!result || result.rows.length === 0) return 'La consulta no devolvió ninguna fila.';

  const sample = result.rows
    .slice(0, MAX_CONTEXT_ROWS)
    .map((row) => Object.fromEntries(result.columns.map((column, i) => [column, row[i] ?? null])));

  const header =
    result.rows.length > MAX_CONTEXT_ROWS
      ? `(mostrando ${MAX_CONTEXT_ROWS} de ${result.rows.length} filas totales)\n`
      : '';

  return `${header}${JSON.stringify(sample)}`;
}

/**
 * Streams plain prose. The card title comes from the decider's `suggestedTitle`
 * instead of a second field here, because wrapping this call in a structured
 * output would stream JSON tokens to the user rather than readable text.
 */
export function answerData(options: {
  text: string;
  result: { columns: string[]; rows: unknown[][] } | null;
  error: string | null;
  dataset: DatasetContext;
  locale: Locale;
}) {
  const { text, result, error, dataset, locale } = options;

  return streamText({
    model,
    ...DETERMINISTIC,
    instructions: buildInstructions({
      role: WRITER_ROLE,
      dataset,
      locale,
      includeTemporal: true,
    }),
    prompt: `Pregunta del usuario:
${text}

Resultado de la consulta:
${describeResult(result, error)}`,
  });
}

export function answerConversation(options: {
  text: string;
  dataset: DatasetContext;
  locale: Locale;
}) {
  const { text, dataset, locale } = options;

  return streamText({
    model,
    ...DETERMINISTIC,
    instructions: buildInstructions({
      role: CONVERSATION_ROLE,
      dataset,
      locale,
      includeTemporal: true,
    }),
    prompt: text,
  });
}

export async function resolveFilterColumn(options: {
  text: string;
  dataset: DatasetContext;
  locale: Locale;
}): Promise<FilterColumn> {
  const { text, dataset, locale } = options;

  const { output } = await generateText({
    model,
    ...DETERMINISTIC,
    instructions: buildInstructions({
      role: FILTER_IDENTIFIER_ROLE,
      dataset,
      locale,
      includeSchema: true,
    }),
    prompt: text,
    output: Output.object({ schema: filterColumnSchema }),
  });

  return output;
}
