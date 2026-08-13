# What is left to do

Handoff notes. Ordered by priority — the first section is the only one that
answers "does this thing actually work?", so start there regardless of what looks
more interesting.

Read [decisions.md](./decisions.md) before changing anything that looks wrong;
several odd-looking choices are deliberate and documented.

---

## P0 — Nobody knows whether this works yet

### 1. Run one question end to end

**Nothing in the LLM pipeline or the gateway has ever executed against real
Power BI.** Every stage typechecks and the deterministic parts are unit-tested, but
no question has produced an answer.

You need in `.env`: `OPENAI_API_KEY` and real `PBI_TENANT_ID`, `PBI_CLIENT_ID`,
`PBI_CLIENT_SECRET`, `PBI_WORKSPACE_NAME`, `PBI_DATASET_NAME`. Then re-seed (or
update the `datasets` row — the seed writes whatever the `PBI_*` variables held at
seed time, and encrypts the secret).

The gateway is not port-published in compose, so either run the API inside compose
or temporarily publish 8080 to reach it from the host devshell.

Expect to iterate on the prompts. Watch for:

- the model emitting DAX that `patchMeasureOnlySummarize` does not catch
- column aliases not matching what `buildCard` tries to resolve, which shows up as
  a chart silently degrading to a table
- `INFO.*` availability on your capacity (needed later for introspection)

**Requires Premium, PPU or Fabric capacity for XMLA.** Check that before debugging
code.

### 2. Golden-question parity harness

This is the safety net the whole rewrite is missing, and it has a **hard ordering
constraint: capture the fixtures from `legacy/` BEFORE dismantling it.**

Steps:

1. Get the MVP running (`cd legacy && python3 server.py`, needs its own `.env`
   with `OPENAI_API_KEY` and `PBI_CONNECTION_STRING`).
2. Pick ~25 questions covering: one per chart type, both languages, a
   deliberately out-of-range period, an ambiguous question that should trigger
   clarification, a filter creation, and a follow-up.
3. Record for each: the generated DAX and the resulting card JSON.
4. Assert the new pipeline produces **executable DAX and the same card kind**.
   Do not assert DAX string equality — the prompts were reworded and the model is
   nondeterministic in wording even at temperature 0.

Put it in `apps/api/src/pipeline/parity.test.ts`, gated behind an env flag so CI
does not need credentials.

Without this, there is no way to know whether the ported prompts regressed.

### 3. Look at the UI

Nobody has. Layout, spacing, chart geometry, dark mode and responsive behaviour are
unverified — only that modules transform and the bundle builds.

`agent-browser` was not installed on this machine. Either install it
(`npm i -g agent-browser && agent-browser install`) or just open
http://localhost:5173 and check the obvious: chart label collisions, the dashboard
grid at narrow widths, whether the DaisyUI dark theme reads well with the chart
palette.

---

## P1 — Promised in the plan, not built

### 4. Dataset introspection

`POST /api/datasets/:id/introspect` was in the plan and **does not exist**. Today
the only way to get a dataset is `pnpm db:seed`, which hardcodes the Iowa model.

The schema is ready for many datasets; the ingestion path is not. Implement by
sending `EVALUATE INFO.TABLES()` / `INFO.COLUMNS()` / `INFO.MEASURES()` /
`INFO.RELATIONSHIPS()` through the existing gateway `/query`.

**Critical:** upsert on `(table_id, name)` and **preserve `note` and `labels`**.
Those are hand-curated and are what make the DAX correct — see
[data-model.md](./data-model.md). Wiping them degrades output quality with no
error anywhere.

### 5. Dataset create/update endpoints

Only `GET /`, `GET /:id/context` and `DELETE /:id` exist. There is no
`POST /api/datasets`, so a new Power BI connection cannot be added without editing
the seed. `datasetConnectionInputSchema` in contracts is already defined for it and
unused.

### 6. Admin curation UI

There is no way to edit column notes, labels, measures or synonyms except SQL.
Given how much these matter, a plain table editor behind the `admin` role would pay
for itself. The role column exists and `DELETE /datasets/:id` already checks it.

### 7. Observability

- `dax_query_log` exists and **nothing writes to it**. Wire it into
  `executor.ts` or `run.ts`: dax, duration, row count, error, dataset, user.
- `messages.input_tokens` / `output_tokens` / `cost_usd` exist and are never
  populated. The AI SDK returns usage on each call; thread it through.
- OpenTelemetry spans across the pipeline stages were planned. AI SDK 7 extracted
  telemetry into `@ai-sdk/otel` — install and register it, then `telemetry` is
  opt-out.

Without these, there is no way to see which stage is slow or what a question costs.

---

## P2 — MVP features not carried over

Each of these existed in `legacy/index.html` and does not exist now.

| Feature | Where it was | Notes |
|---|---|---|
| Unread pip on background conversations | `_pendingConvs` | Responses arriving in a non-active conversation showed a dot in the sidebar. Needs per-conversation streaming state. |
| DAX syntax highlighting | `daxHighlight` | `DaxViewer.tsx` renders plain monospace. |
| Editable display name | `startEditName` | No profile editing at all. |
| Follow-up suggestion chips | always `[]` in the MVP too | `cardPartSchema.followUps` is plumbed end-to-end and nothing fills it. **Decide: implement or delete.** Do not leave a no-op. |

### `rechart_previous` is only half wired

`run.ts` passes the previous result's columns to the decider, but the MVP's
optimisation — **re-execute the cached DAX instead of regenerating** when the
decision can be satisfied by columns already present — is not implemented. Today
"ponlo en barras" costs a full generate + execute. `messages.dax` and
`result_columns` are stored, so the data is there.

---

## P3 — Production readiness

### 8. Deployment

`docker-compose.yml` only defines `postgres` and `dax-gateway`. There are no
Dockerfiles for `apps/api` or `apps/web`, so the full stack cannot come up with one
command. The API needs a Node image; the web app needs a static build served
behind something that also proxies `/api` (which is what makes the same-origin
cookie work in production).

### 9. Tests

Currently 19, covering `cards/build.ts` and `auth/passwords.ts`. Missing:

- `dax/filters.ts` — `applyFilters` does string surgery around `EVALUATE` and
  `ORDER BY`. It is pure and trivially testable and currently untested. **Highest
  value per line of any test you could write.**
- `dax/sanitize.ts` — same argument.
- `dax/columns.ts` — `resolveColumn` bracket/case handling.
- Route-level tests with `app.inject()` — no HTTP test exists.
- `conversations/store.ts` `loadHistory()` pairing logic.
- Anything in the frontend. No component tests at all.
- CI runs `dotnet test` in `services/dax-gateway` and **there are no .NET tests**,
  so that step is decorative.

### 10. Hardening

- Rate limiting is global (120/min). It should be per-user, and the LLM endpoints
  deserve a much tighter budget than the CRUD ones.
- `deleteExpiredSessions()` exists in `auth/sessions.ts` and is **never called**.
  Needs a periodic job.
- `/health` returns `ok` unconditionally. It should check Postgres and the gateway
  so a load balancer learns something from it.
- No React error boundary. A render error in one card blanks the app; the MVP had a
  try/catch fallback that rendered text without the chart.
- No retry or circuit breaking around the gateway. A cold XMLA endpoint is slow on
  first connect.

---

## Known rough edges

Small, real, and cheap to fix:

- **Navigation during render.** `_authed.tsx` and `login.tsx` call `navigate()` in
  the component body when auth state is wrong. It works, but the idiomatic fix is
  `beforeLoad` with the router's context, which also removes the flash.
- **Pin uses the latest question, not the pinned card's.** `ChatPanel` keeps
  `lastQuestion` in a single ref, so pinning an older card in a long conversation
  attaches the most recent question as the widget's `query`. Store the question per
  message instead.
- **Chat is hardcoded to the first dataset.** `datasets.data?.[0]` in
  `_authed/chat.tsx`. Dashboards already carry a `datasetId`; chat should too once
  more than one dataset exists.
- **`useAddWidget(firstDashboard?.id ?? '')`** — the hook is constructed with an
  empty id when no dashboard exists. `onPin` is not passed in that case so it is
  never called, but it is fragile.
- **Conversation titles are the first 60 characters of the first message** and are
  never improved. A one-line summarisation call would read better.
- **`legacy/` is excluded from lint and typecheck** but still committed, which is
  intentional (fixtures). Delete it only after P0 #2 is done.

---

## Suggested order

1. P0 #1 — get one question working. Everything else is guesswork until then.
2. P0 #2 — capture the parity fixtures **while `legacy/` still runs**.
3. P3 #9's first three bullets — the pure-function tests, an hour of work.
4. P0 #3 — look at the UI, fix what is ugly.
5. P1 #4 and #5 — introspection and dataset CRUD, which is what makes this
   multi-tenant in practice rather than just in schema.
6. Everything else by whatever the product needs.
