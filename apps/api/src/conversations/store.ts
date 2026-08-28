import type { Card, VizDecision } from '@powerbia/contracts';
import { type Database, schema } from '@powerbia/db';
import { and, desc, eq } from 'drizzle-orm';
import type { HistoryEntry } from '../pipeline/stages.js';

type ConversationRow = typeof schema.conversations.$inferSelect;

const HISTORY_LIMIT = 5;
const TITLE_LIMIT = 60;

export async function findConversation(db: Database, userId: string, conversationId: string) {
  return db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.id, conversationId),
      eq(schema.conversations.userId, userId),
    ),
  });
}

/**
 * The first message is only a placeholder title: the real one is generated from
 * the exchange once the answer exists (see `pipeline/retitle.ts`). Keeping the
 * placeholder means a conversation is never nameless, not even if that
 * generation fails.
 */
export async function ensureConversation(options: {
  db: Database;
  userId: string;
  datasetId: string;
  conversationId: string | null;
  firstMessage: string;
}): Promise<{ conversation: ConversationRow; created: boolean }> {
  const { db, userId, datasetId, conversationId, firstMessage } = options;

  if (conversationId) {
    const existing = await findConversation(db, userId, conversationId);
    if (existing) return { conversation: existing, created: false };
  }

  const [created] = await db
    .insert(schema.conversations)
    .values({ userId, datasetId, title: firstMessage.slice(0, TITLE_LIMIT) })
    .returning();

  if (!created) throw new Error('Could not create conversation');

  return { conversation: created, created: true };
}

/**
 * Follow-up context, read back from Postgres. The MVP kept this in a
 * process-local dict, so it was lost on restart and wrong with several workers.
 */
export async function loadHistory(db: Database, conversationId: string): Promise<HistoryEntry[]> {
  const rows = await db
    .select({
      text: schema.messages.text,
      dax: schema.messages.dax,
      resultColumns: schema.messages.resultColumns,
      role: schema.messages.role,
    })
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(HISTORY_LIMIT * 2);

  const history: HistoryEntry[] = [];

  for (const row of rows.reverse()) {
    if (row.role === 'user') {
      history.push({ question: row.text, dax: null, resultColumns: null });
      continue;
    }

    const last = history.at(-1);
    if (last) {
      last.dax = row.dax;
      last.resultColumns = row.resultColumns;
    }
  }

  return history.slice(-HISTORY_LIMIT);
}

export async function appendMessage(options: {
  db: Database;
  conversationId: string;
  role: 'user' | 'assistant';
  text: string;
  card?: Card | null;
  dax?: string | null;
  decision?: VizDecision | null;
  resultColumns?: string[] | null;
}) {
  const { db, conversationId, role, text, card, dax, decision, resultColumns } = options;

  const [message] = await db
    .insert(schema.messages)
    .values({
      conversationId,
      role,
      text,
      card: card ?? null,
      dax: dax ?? null,
      decision: decision ?? null,
      resultColumns: resultColumns ?? null,
    })
    .returning();

  await db
    .update(schema.conversations)
    .set({ updatedAt: new Date() })
    .where(eq(schema.conversations.id, conversationId));

  return message;
}
