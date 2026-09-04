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
import { findActiveDataset } from '../datasets/provision.js';
import { retitleConversation } from '../pipeline/retitle.js';
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
    const { conversationId, text, locale, filters, forcedChartType } = request.body;

    // The model is the environment's, never the caller's: no id crosses the wire.
    const active = await findActiveDataset(app.db);
    if (!active) return reply.code(404).send({ message: 'No model configured' });
    const datasetId = active.id;

    const [dataset, connection] = await Promise.all([
      loadDatasetContext(app.db, datasetId),
      loadConnection(app.db, datasetId),
    ]);
    if (!dataset || !connection) return reply.code(404).send({ message: 'No model configured' });

    const { conversation, created } = await ensureConversation({
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
      /*
       * Persisting here rather than after the pipe is what makes the answer
       * readable the instant the client sees the stream close: an async
       * `execute` holds the stream open until it settles. Persisting afterwards
       * raced the refetch the client fires on finish, which could then store a
       * conversation whose answer was still missing - the same "only appears
       * after a refresh" symptom, one navigation later.
       *
       * The await does not stall the prose: `merge` is already draining the
       * model stream into the response, and `readStreamText` reads its own tee.
       */
      execute: async ({ writer }) => {
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

        /*
         * A branch that answers without calling the writer model - a
         * clarification, an out-of-range period, a filter card's confirmation -
         * returns its prose in `text` and no stream. It was persisted but never
         * put on the wire, so every "I cannot answer that" rendered as an empty
         * assistant turn that only appeared after a reload. `text` and `stream`
         * are mutually exclusive in `runPipeline`, so this never doubles up.
         */
        if (outcome.text) {
          writer.write({ type: 'text-start', id: 'answer' });
          writer.write({ type: 'text-delta', id: 'answer', delta: outcome.text });
          writer.write({ type: 'text-end', id: 'answer' });
        }

        if (outcome.stream) writer.merge(toUIMessageStream({ stream: outcome.stream.stream }));

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

        /*
         * Titling the new conversation before the stream closes is what makes
         * the sidebar show the real title on the refetch the client fires on
         * finish. It must never take the answer down with it, hence the catch:
         * the placeholder title is already in place.
         */
        if (created) {
          try {
            await retitleConversation({
              db: app.db,
              conversationId: conversation.id,
              datasetId,
              locale,
            });
          } catch (error) {
            app.log.warn({ err: error, conversationId: conversation.id }, 'auto-title failed');
          }
        }
      },
    });

    reply.hijack();
    await pipeUIMessageStreamToResponse({ response: reply.raw, stream });
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
      const { text, locale, filters, forcedChartType } = request.body;

      const active = await findActiveDataset(app.db);
      if (!active) return reply.code(404).send({ message: 'No model configured' });

      const [dataset, connection] = await Promise.all([
        loadDatasetContext(app.db, active.id),
        loadConnection(app.db, active.id),
      ]);
      if (!dataset || !connection) return reply.code(404).send({ message: 'No model configured' });

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
