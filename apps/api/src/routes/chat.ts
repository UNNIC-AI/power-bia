import type { CardPart } from '@powerbia/contracts';
import {
  chatRequestSchema,
  errorSchema,
  queryRequestSchema,
  queryResponseSchema,
} from '@powerbia/contracts';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireUser } from '../app.js';
import { appendMessage, ensureConversation, loadHistory } from '../conversations/store.js';
import { loadConnection, loadDatasetContext } from '../datasets/context.js';
import { runPipeline } from '../pipeline/run.js';

export type ChatUIMessage = UIMessage<
  never,
  { card: CardPart; conversation: { conversationId: string } }
>;

/** A disconnected client must not prevent the answer from being persisted. */
async function readStreamText(stream: { text: PromiseLike<string> } | null): Promise<string> {
  if (!stream) return '';

  try {
    return await stream.text;
  } catch {
    return '';
  }
}

export async function chatRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post('/chat', { schema: { body: chatRequestSchema } }, async (request, reply) => {
    const user = requireUser(request);
    const { datasetId, conversationId, text, locale, filters, forcedChartType } = request.body;

    const [dataset, connection] = await Promise.all([
      loadDatasetContext(app.db, datasetId),
      loadConnection(app.db, datasetId),
    ]);
    if (!dataset || !connection) return reply.code(404).send({ message: 'Dataset not found' });

    const conversation = await ensureConversation({
      db: app.db,
      userId: user.id,
      datasetId,
      conversationId,
      firstMessage: text,
    });

    const history = await loadHistory(app.db, conversation.id);

    await appendMessage({ db: app.db, conversationId: conversation.id, role: 'user', text });

    const outcome = await runPipeline({
      text,
      dataset,
      connection,
      executor: app.executor,
      locale,
      filters,
      forcedChartType,
      history,
    });

    const stream = createUIMessageStream<ChatUIMessage>({
      execute: ({ writer }) => {
        writer.write({
          type: 'data-conversation',
          data: { conversationId: conversation.id },
          transient: true,
        });

        writer.write({
          type: 'data-card',
          id: 'card',
          data: { card: outcome.card, dax: outcome.dax, followUps: [] },
        });

        if (outcome.stream) writer.merge(toUIMessageStream({ stream: outcome.stream.stream }));
      },
    });

    reply.hijack();
    await pipeUIMessageStreamToResponse({ response: reply.raw, stream });

    const answer = outcome.text ?? (await readStreamText(outcome.stream));

    await appendMessage({
      db: app.db,
      conversationId: conversation.id,
      role: 'assistant',
      text: answer,
      card: outcome.card,
      dax: outcome.dax,
      decision: outcome.decision,
      resultColumns: outcome.resultColumns,
    });
  });

  /** Non-streaming path for widget refresh and inline widget editing. */
  route.post(
    '/query',
    {
      schema: {
        body: queryRequestSchema,
        response: { 200: queryResponseSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      requireUser(request);
      const { datasetId, text, locale, filters, forcedChartType } = request.body;

      const [dataset, connection] = await Promise.all([
        loadDatasetContext(app.db, datasetId),
        loadConnection(app.db, datasetId),
      ]);
      if (!dataset || !connection) return reply.code(404).send({ message: 'Dataset not found' });

      const outcome = await runPipeline({
        text,
        dataset,
        connection,
        executor: app.executor,
        locale,
        filters,
        forcedChartType,
        history: [],
      });

      return {
        text: outcome.text ?? (await outcome.stream?.text) ?? '',
        card: outcome.card,
        dax: outcome.dax,
      };
    },
  );
}
