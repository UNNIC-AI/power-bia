import type { Card, LocalizedLabel, VizDecision } from '@powerbia/contracts';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const userRole = pgEnum('user_role', ['member', 'admin']);
export const messageRole = pgEnum('message_role', ['user', 'assistant']);
export const tableRole = pgEnum('table_role', ['fact', 'dimension', 'date']);
export const cardinality = pgEnum('cardinality', ['*:1', '1:1', '1:*']);
export const measureSource = pgEnum('measure_source', ['introspected', 'curated']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  role: userRole('role').notNull().default('member'),
  createdAt,
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the opaque cookie token; the token itself is never stored. */
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt,
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const datasets = pgTable('datasets', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  tenantId: text('tenant_id').notNull(),
  clientId: text('client_id').notNull(),
  /** AES-256-GCM ciphertext. See `encryptSecret` in ./crypto.ts. */
  clientSecretEncrypted: text('client_secret_encrypted').notNull(),
  workspaceName: text('workspace_name').notNull(),
  datasetName: text('dataset_name').notNull(),
  dateMin: text('date_min').notNull(),
  dateMax: text('date_max').notNull(),
  /**
   * Prose about the model. First written by the LLM from the introspected
   * catalogue, then curated by an admin. It reaches every prompt stage and is
   * the only channel for what introspection cannot infer: what an undescriptive
   * table name means, business vocabulary, or a correction to something the
   * heuristics deduced wrong.
   */
  extraContext: text('extra_context').notNull().default(''),
  /**
   * When the LLM last wrote `extraContext`. Nulled the moment an admin saves
   * their own text, so the UI never labels a human's words as generated.
   */
  extraContextGeneratedAt: timestamp('extra_context_generated_at', { withTimezone: true }),
  lastIntrospectedAt: timestamp('last_introspected_at', { withTimezone: true }),
  createdAt,
});

export const datasetTables = pgTable(
  'dataset_tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: tableRole('role').notNull(),
    description: text('description').notNull().default(''),
  },
  (t) => [uniqueIndex('dataset_tables_name_idx').on(t.datasetId, t.name)],
);

/**
 * `note` and `labels` are curated by an admin, everything else is introspected.
 * Re-introspection must upsert on (tableId, name) so curation survives.
 */
export const datasetColumns = pgTable(
  'dataset_columns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableId: uuid('table_id')
      .notNull()
      .references(() => datasetTables.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    dataType: text('data_type').notNull(),
    sampleValue: text('sample_value'),
    isAggregatable: boolean('is_aggregatable').notNull().default(false),
    note: text('note'),
    labels: jsonb('labels').$type<LocalizedLabel>().notNull().default({}),
  },
  (t) => [uniqueIndex('dataset_columns_name_idx').on(t.tableId, t.name)],
);

export const datasetMeasures = pgTable(
  'dataset_measures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    expression: text('expression').notNull(),
    /**
     * Curated measures are business vocabulary written by hand, and some hold
     * prompt guidance rather than executable DAX. Reconciliation deletes only
     * the rows it introspected, so those survive a re-sync; the `curated`
     * default keeps every pre-existing row safe.
     */
    source: measureSource('source').notNull().default('curated'),
  },
  (t) => [uniqueIndex('dataset_measures_name_idx').on(t.datasetId, t.name)],
);

export const datasetRelationships = pgTable(
  'dataset_relationships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    fromColumn: text('from_column').notNull(),
    toColumn: text('to_column').notNull(),
    cardinality: cardinality('cardinality').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  // The other catalogue tables reach this column through a unique index; this one
  // has none, and repointing the environment deletes every row by dataset_id.
  (t) => [index('dataset_relationships_dataset_idx').on(t.datasetId)],
);

export const datasetSynonyms = pgTable(
  'dataset_synonyms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    term: text('term').notNull(),
    target: text('target').notNull(),
  },
  (t) => [uniqueIndex('dataset_synonyms_term_idx').on(t.datasetId, t.term)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversations_user_idx').on(t.userId, t.updatedAt)],
);

/**
 * Replaces the MVP's in-memory `_sessions` dict: follow-up context is read back
 * from here, so it survives restarts and works with more than one worker.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRole('role').notNull(),
    text: text('text').notNull(),
    card: jsonb('card').$type<Card>(),
    dax: text('dax'),
    decision: jsonb('decision').$type<VizDecision>(),
    resultColumns: jsonb('result_columns').$type<string[]>(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    createdAt,
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

export const dashboards = pgTable(
  'dashboards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt,
  },
  (t) => [index('dashboards_user_idx').on(t.userId)],
);

export const widgets = pgTable(
  'widgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dashboardId: uuid('dashboard_id')
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),
    card: jsonb('card').$type<Card>().notNull(),
    query: text('query'),
    /** The DAX the question produced, so the edit panel can show prompt and DAX together. */
    dax: text('dax'),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    createdAt,
  },
  (t) => [index('widgets_dashboard_idx').on(t.dashboardId)],
);

export const daxQueryLog = pgTable(
  'dax_query_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    dax: text('dax').notNull(),
    durationMs: integer('duration_ms').notNull(),
    rowCount: integer('row_count'),
    error: text('error'),
    createdAt,
  },
  (t) => [
    index('dax_query_log_dataset_idx').on(t.datasetId, t.createdAt),
    // Deleting an account nulls this column across the log; unindexed, that is a
    // sequential scan of every query ever run.
    index('dax_query_log_user_idx').on(t.userId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  conversations: many(conversations),
  dashboards: many(dashboards),
}));

export const datasetsRelations = relations(datasets, ({ many }) => ({
  tables: many(datasetTables),
  measures: many(datasetMeasures),
  relationships: many(datasetRelationships),
  synonyms: many(datasetSynonyms),
}));

export const datasetTablesRelations = relations(datasetTables, ({ one, many }) => ({
  dataset: one(datasets, { fields: [datasetTables.datasetId], references: [datasets.id] }),
  columns: many(datasetColumns),
}));

export const datasetColumnsRelations = relations(datasetColumns, ({ one }) => ({
  table: one(datasetTables, { fields: [datasetColumns.tableId], references: [datasetTables.id] }),
}));

/**
 * Drizzle infers a relation only when both sides are declared; a lone `many()`
 * fails at query time rather than at build time.
 */
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const datasetMeasuresRelations = relations(datasetMeasures, ({ one }) => ({
  dataset: one(datasets, { fields: [datasetMeasures.datasetId], references: [datasets.id] }),
}));

export const datasetRelationshipsRelations = relations(datasetRelationships, ({ one }) => ({
  dataset: one(datasets, { fields: [datasetRelationships.datasetId], references: [datasets.id] }),
}));

export const datasetSynonymsRelations = relations(datasetSynonyms, ({ one }) => ({
  dataset: one(datasets, { fields: [datasetSynonyms.datasetId], references: [datasets.id] }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const dashboardsRelations = relations(dashboards, ({ one, many }) => ({
  user: one(users, { fields: [dashboards.userId], references: [users.id] }),
  widgets: many(widgets),
}));

export const widgetsRelations = relations(widgets, ({ one }) => ({
  dashboard: one(dashboards, { fields: [widgets.dashboardId], references: [dashboards.id] }),
}));
