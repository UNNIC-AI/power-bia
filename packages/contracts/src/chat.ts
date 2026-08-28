import { z } from 'zod';
import { cardSchema } from './cards.js';
import { chartTypeSchema, localeSchema } from './viz.js';

/**
 * Dashboard slicer state. The MVP appended these to the prompt as Spanish prose
 * and hoped the model honoured them; they are now applied to the generated DAX
 * deterministically, so the table name is required.
 */
export const filterSelectionSchema = z.object({
  table: z.string(),
  column: z.string(),
  values: z.array(z.string()).min(1),
});

export const chatRequestSchema = z.object({
  datasetId: z.uuid(),
  conversationId: z.uuid().nullable().default(null),
  text: z.string().min(1).max(2000),
  locale: localeSchema.default('es'),
  filters: z.array(filterSelectionSchema).default([]),
  forcedChartType: chartTypeSchema.nullable().default(null),
  choiceId: z.string().nullable().default(null),
});

/** Non-streaming path used by widget refresh and inline widget editing. */
export const queryRequestSchema = z.object({
  datasetId: z.uuid(),
  text: z.string().min(1).max(2000),
  locale: localeSchema.default('es'),
  filters: z.array(filterSelectionSchema).default([]),
  forcedChartType: chartTypeSchema.nullable().default(null),
});

export const queryResponseSchema = z.object({
  text: z.string(),
  card: cardSchema.nullable(),
  dax: z.string().nullable(),
});

/** Payload of the `data-card` part streamed alongside the prose. */
export const cardPartSchema = z.object({
  card: cardSchema.nullable(),
  dax: z.string().nullable(),
  followUps: z.array(z.object({ label: z.string(), text: z.string() })),
});

export const messageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  card: cardSchema.nullable(),
  dax: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const conversationSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  datasetId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const conversationWithMessagesSchema = conversationSchema.extend({
  messages: z.array(messageSchema),
});

/** Titles are generated from the thread; renaming overrides that. */
export const renameConversationSchema = z.object({ title: z.string().min(1).max(120) });

/** Ask for a fresh generated title. The locale decides what language it is in. */
export const regenerateTitleSchema = z.object({ locale: localeSchema.default('es') });

export type FilterSelection = z.infer<typeof filterSelectionSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type QueryRequest = z.infer<typeof queryRequestSchema>;
export type QueryResponse = z.infer<typeof queryResponseSchema>;
export type CardPart = z.infer<typeof cardPartSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type RenameConversation = z.infer<typeof renameConversationSchema>;
export type RegenerateTitle = z.infer<typeof regenerateTitleSchema>;
export type ConversationWithMessages = z.infer<typeof conversationWithMessagesSchema>;
