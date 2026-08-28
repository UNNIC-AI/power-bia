import type { Locale } from '@powerbia/contracts';
import { type Database, schema } from '@powerbia/db';
import { asc, eq } from 'drizzle-orm';
import { loadDatasetContext } from '../datasets/context.js';
import { generateTitle } from './stages.js';

/** Enough of the thread to know what it is about; the rest is repetition. */
const TURN_LIMIT = 6;
const WIDGET_LIMIT = 12;

/**
 * Titles are generated from what a conversation or a view actually contains,
 * rather than from the first question — which stopped describing the thread as
 * soon as it moved on. Both entry points read the content back from Postgres so
 * there is one code path for the automatic pass and for the explicit one.
 *
 * Returns `null` when there is nothing to title yet, which is not an error: an
 * empty view has no widgets to summarise.
 */
export async function retitleConversation(options: {
  db: Database;
  conversationId: string;
  datasetId: string;
  locale: Locale;
}): Promise<string | null> {
  const { db, conversationId, datasetId, locale } = options;

  const dataset = await loadDatasetContext(db, datasetId);
  if (!dataset) return null;

  const rows = await db
    .select({ role: schema.messages.role, text: schema.messages.text })
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.createdAt))
    .limit(TURN_LIMIT);

  const context = rows
    .filter((row) => row.text.trim())
    .map((row) => `${row.role === 'user' ? 'Usuario' : 'Asistente'}: ${row.text}`)
    .join('\n');
  if (!context) return null;

  const title = await generateTitle({ context, dataset, locale });
  if (!title) return null;

  await db
    .update(schema.conversations)
    .set({ title })
    .where(eq(schema.conversations.id, conversationId));

  return title;
}

export async function retitleDashboard(options: {
  db: Database;
  dashboardId: string;
  datasetId: string;
  locale: Locale;
}): Promise<string | null> {
  const { db, dashboardId, datasetId, locale } = options;

  const dataset = await loadDatasetContext(db, datasetId);
  if (!dataset) return null;

  const widgets = await db
    .select({ card: schema.widgets.card, query: schema.widgets.query })
    .from(schema.widgets)
    .where(eq(schema.widgets.dashboardId, dashboardId))
    .orderBy(asc(schema.widgets.createdAt))
    .limit(WIDGET_LIMIT);

  // The question behind a widget describes it better than its card title, which
  // the visualisation stage wrote for a chart axis rather than for a summary.
  const context = widgets
    .map((widget) => widget.query ?? widget.card.title)
    .filter((line): line is string => Boolean(line?.trim()))
    .map((line) => `- ${line}`)
    .join('\n');
  if (!context) return null;

  const name = await generateTitle({
    context: `Gráficos que contiene la vista:\n${context}`,
    dataset,
    locale,
  });
  if (!name) return null;

  await db.update(schema.dashboards).set({ name }).where(eq(schema.dashboards.id, dashboardId));

  return name;
}
