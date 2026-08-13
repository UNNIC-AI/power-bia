import {
  conversationSchema,
  conversationWithMessagesSchema,
  errorSchema,
} from '@powerbia/contracts';
import { schema } from '@powerbia/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../app.js';
import { findConversation } from '../conversations/store.js';

const paramsSchema = z.object({ id: z.uuid() });

type ConversationRow = typeof schema.conversations.$inferSelect;
type MessageRow = typeof schema.messages.$inferSelect;

const toConversation = (row: ConversationRow) => ({
  id: row.id,
  title: row.title,
  datasetId: row.datasetId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toMessage = (row: MessageRow) => ({
  id: row.id,
  role: row.role,
  text: row.text,
  card: row.card,
  dax: row.dax,
  createdAt: row.createdAt.toISOString(),
});

export async function conversationRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get(
    '/',
    { schema: { response: { 200: z.array(conversationSchema) } } },
    async (request) => {
      const user = requireUser(request);

      const rows = await app.db.query.conversations.findMany({
        where: eq(schema.conversations.userId, user.id),
        orderBy: desc(schema.conversations.updatedAt),
      });

      return rows.map(toConversation);
    },
  );

  route.get(
    '/:id',
    {
      schema: {
        params: paramsSchema,
        response: { 200: conversationWithMessagesSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      const user = requireUser(request);

      const conversation = await findConversation(app.db, user.id, request.params.id);
      if (!conversation) return reply.code(404).send({ message: 'Conversation not found' });

      const messages = await app.db.query.messages.findMany({
        where: eq(schema.messages.conversationId, conversation.id),
        orderBy: asc(schema.messages.createdAt),
      });

      return { ...toConversation(conversation), messages: messages.map(toMessage) };
    },
  );

  route.delete('/:id', { schema: { params: paramsSchema } }, async (request) => {
    const user = requireUser(request);

    await app.db
      .delete(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, request.params.id),
          eq(schema.conversations.userId, user.id),
        ),
      );

    return { ok: true };
  });
}
