# Data model

Drizzle schema in `packages/db/src/schema.ts`; generated SQL in
`packages/db/drizzle/`. Postgres 17.

## Tables

### Identity

| Table | Notes |
|---|---|
| `users` | email unique, `password_hash`, `display_name`, role `member`/`admin` |
| `sessions` | PK is the **SHA-256 of the cookie token** — the token itself is never stored. `expires_at` is checked in the lookup query |

### Dataset catalog

| Table | Notes |
|---|---|
| `datasets` | One Power BI connection. Structured `tenant_id` / `client_id` / `workspace_name` / `dataset_name`, plus `client_secret_encrypted`. `date_min` / `date_max` drive the pipeline's temporal awareness |
| `dataset_tables` | name, role (`fact` / `dimension` / `date`), description |
| `dataset_columns` | name, type, sample value, `is_aggregatable`, **`note`**, **`labels`** |
| `dataset_measures` | business vocabulary → DAX expression |
| `dataset_relationships` | from/to column, cardinality, active |
| `dataset_synonyms` | user term → canonical target |

`note` and `labels` are **curated by hand; everything else is introspectable.**
This split is the whole reason the catalog is in the database rather than a config
file. Introspection can rediscover that a column is called `Bottles Sold` and is an
integer. It cannot rediscover "this is the only summable column in the model" or
"never `ORDER BY` this in a monthly grouping" — and those notes are what make the
generated DAX correct.

**Any future introspection must upsert on `(table_id, name)` and preserve `note`
and `labels`.** Wiping them silently degrades DAX quality with no error anywhere.
There are unique indexes on `(dataset_id, name)` and `(table_id, name)` to make
that upsert natural.

`labels` is a partial per-locale record (`{ es?, en? }`), replacing the MVP's
hardcoded `_COL_ES` dictionary of Iowa-specific column names. It feeds
`createLabelResolver` in `apps/api/src/datasets/context.ts`, which falls back to a
cleaned-up column name when no label is curated.

### Conversations

| Table | Notes |
|---|---|
| `conversations` | scoped by `user_id`, ordered by `updated_at` |
| `messages` | role, text, `card` (JSONB), `dax`, `decision` (JSONB), `result_columns`, and token/cost columns |

`messages.dax` and `messages.result_columns` exist so follow-up context can be
reconstructed from the database instead of process memory. `decision` is stored for
debugging: when a chart comes out wrong, the decision is the first thing to look at.

`input_tokens` / `output_tokens` / `cost_usd` exist but **nothing writes to them
yet** — see [todo.md](./todo.md).

### Dashboards

| Table | Notes |
|---|---|
| `dashboards` | scoped by `user_id` |
| `widgets` | `card` (JSONB), **`query`**, `x`/`y`/`width`/`height` in grid cells, `pinned` |

`widgets.query` is the natural-language question that produced the card. It means a
dashboard can be **recomputed from its questions** rather than serving whatever
numbers happened to be cached in its JSON. The MVP stored only the card, so
dashboards silently went stale; it had an auto-refresh hack for table widgets only.

Layout units are react-grid-layout cells on a 12-column grid, not pixels.

### Observability

`dax_query_log` — dax, duration, row count, error, dataset, user. **Table exists,
nothing writes to it yet.**

## Secret encryption

`packages/db/src/crypto.ts`. AES-256-GCM, key from `DATASET_SECRET_KEY` (exactly
32 bytes as 64 hex chars, enforced by both the env schema and `toKey`). Stored as
`iv:authTag:ciphertext`, each base64.

The MVP kept a single `PBI_CONNECTION_STRING` env var containing the service
principal secret in plaintext and pulled the fields out with five regexes. Storing
the fields structurally also removes a real failure mode: a secret containing `;`
would have silently truncated that connection string.

The gateway rebuilds the connection string itself and quotes values that contain
`;` or `"` (`Quote()` in `Program.cs`).

## Migrations

```bash
pnpm db:generate    # after editing schema.ts
pnpm db:migrate
pnpm db:seed
```

`drizzle.config.ts` requires `DATABASE_URL` even for `generate`, so export it
first.

`packages/db/src/seed.ts` is the port of the MVP's `schema.py`: 4 tables, 45
columns with their curated notes and labels, 7 measures, 3 relationships, 17
synonyms. It is idempotent — it exits if a dataset with that name already exists.
It reads the `PBI_*` variables for the connection fields, so seeding without them
produces correct metadata but a connection that cannot authenticate.

## Gotchas

- **A Drizzle relation needs both sides declared.** `datasetsRelations` declaring
  `measures: many(datasetMeasures)` is not enough; `datasetMeasuresRelations` must
  declare the inverse `one(datasets)`. A lone `many()` compiles and typechecks
  fine, then fails at query time with `There is not enough information to infer
  relation "datasets.measures"`. This shipped as a bug and was only caught by an
  actual HTTP request.
- **Rebuild the package after editing it.** `pnpm --filter @powerbia/db build` —
  the API resolves `dist/`, not `src/`.
- `casing: 'snake_case'` is set in both `drizzle.config.ts` and `createDatabase`;
  they must agree.
