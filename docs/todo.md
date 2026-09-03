# What is left to do

Handoff notes. Ordered by priority — the first section is the only one that
answers "does this thing actually work?", so start there regardless of what looks
more interesting.

Read [decisions.md](./decisions.md) before changing anything that looks wrong;
several odd-looking choices are deliberate and documented.

---

## P0 — Correctness is still unproven at scale

### 1. ~~Run one question end to end~~ — DONE

The pipeline works against live Power BI and OpenAI. Four questions answered in
~8s each, covering `kpi`, `line`, `bar` and the out-of-range refusal. The gateway
executes DAX over XMLA, and `INFO.TABLES()` works on the capacity.

Setup that made it work is in [setup.md](./setup.md). Two things learned:

- Run the gateway with `dotnet run -c Release` from `services/dax-gateway` for
  local work; it is far quicker than building the container, which still has
  never been built.
- Repointing at another model is `PBI_*` plus a restart: the API rewrites the
  dataset row on boot, reusing it so conversations and dashboards survive. The
  `db connection` script that used to do this by hand is gone.

Known nit: the writer sometimes formats numbers in its Spanish prose with en-US
separators (`29,841,264` rather than `29.841.264`). Card values are formatted
client-side and are correct; this is only the prose. One line in `WRITER_ROLE`.

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

### 4. ~~Dataset introspection~~ — DONE

`POST /api/dataset/introspect` exists, and the API refreshes any stale
catalogue at boot (`INTROSPECT_ON_STARTUP`, `INTROSPECT_MAX_AGE_HOURS`).
`apps/api/src/datasets/` holds it: `info-queries.ts` (the four `INFO.*` payloads
and their parsers), `heuristics.ts` (roles, `is_aggregatable`, type mapping),
`probes.ts` (sample values and the date range) and `introspect.ts` (the
reconciling writer).

Verified against the live Iowa model: it reproduces the seed's hand-written
catalogue exactly — the same 4 tables with the same roles, the same 45 columns,
`Invoices[Bottles Sold]` as the only summable one, and the same
`2012-01-01 → 2021-12-31` range that was hardcoded. The 16 curated notes, 23
curated labels and 17 synonyms survived untouched.

What `INFO.*` cannot give is filled deterministically, not by an LLM, and what the
heuristics cannot decide comes back as `warnings` on the report. Anything still
wrong is corrected by hand through `extra_context` (below).

### 5. ~~Dataset endpoints~~ — DONE, then narrowed

`PATCH /api/dataset`, `POST /api/dataset/introspect` and
`POST /api/dataset/context` exist, all admin-only.

The create and delete endpoints, and the connection form that used them, are gone:
the Power BI source is `PBI_*` and the API writes it into the row on every boot
(`datasets/provision.ts`). Changing model is an environment edit plus a restart,
which also drops the catalogue of the model that was left behind and introspects
the new one.

The list endpoint and the navbar picker are gone too. There is one model and the
environment names it, so no path carries an id, no request body carries a dataset
id, and the server resolves the active row itself (`findActiveDataset`). Chat and
dashboards read it through `useDataset()`, which is now a plain query over
`GET /api/dataset`.

Self-registration is closed: `POST /auth/register` only answers while there are no
users at all, and whoever claims an empty instance becomes its `admin`
(`routes/auth.ts`). Every account after that is created by an admin from the Users
dialog (`routes/users.ts`), which also resets passwords and removes accounts.
Members can change their own password and nothing else.

### 6. Admin curation UI — partially done

A Settings dialog (`apps/web/src/components/SettingsDialog.tsx`, admin-only) edits
the dataset's `extra_context`, triggers a re-sync, and asks the assistant to
rewrite that context from the catalogue. The first draft is written automatically
the first time a model is introspected, so the layer is never empty — which it
always was while it had to be typed from scratch.

Column notes, labels, measures and synonyms are still SQL-only; a plain table
editor behind the `admin` role would still pay for itself.

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

### 8. ~~Deployment~~ — DONE

`apps/api/Dockerfile` and `apps/web/Dockerfile` are multi-stage with `dev` and
`runtime` targets; `docker-compose.yml` runs every service behind a profile, and
`docker-compose.prod.yml` is the production shape (runtime targets, no bind
mounts, resource limits, secrets required rather than defaulted, the gateway
unpublished, nginx serving the SPA and proxying `/api`). CI builds all three
images. `/healthz` and `/readyz` exist. Backups, restore and rollback are written
down in [deployment.md](./deployment.md).

What is left here: nothing blocking, but nobody has restored a dump into a clean
environment yet, and the restore command in `deployment.md` should be exercised
once before it is trusted.

### 9. Tests — 80, and both sides are wired

The scaffolding is in place on both sides: 72 in the API and 8 in the web app.
Route tests go through `buildApp()` and `app.inject()` against a real Postgres
(a throwaway database per vitest worker); component tests go through the DOM with
Testing Library, `user-event` and MSW. CI runs both with a Postgres service and
the suites refuse to skip there.

Still missing, in value order:

- `dax/filters.ts` — `applyFilters` does string surgery around `EVALUATE` and
  `ORDER BY`. It is pure and trivially testable and currently untested. **Highest
  value per line of any test you could write.**
- `dax/sanitize.ts` — same argument.
- `dax/columns.ts` — `resolveColumn` bracket/case handling.
- Route tests for `/api/conversations`, `/api/dashboards` and `/api/users`. Only
  `/api/auth` and `/api/dataset` are covered.
- `conversations/store.ts` `loadHistory()` pairing logic.
- Component tests for the chat panel and the dashboard canvas.
- One Playwright path against the compose stack: sign in, ask a question, pin the
  card. The money path, and the only test that would cover the streaming contract.
- CI runs `dotnet test` in `services/dax-gateway` and **there are no .NET tests**,
  so that step is decorative.

### 10. Hardening

- Rate limiting is global (120/min), with a tighter 10/min on login and register.
  It should be per-user, and the LLM endpoints deserve a much tighter budget than
  the CRUD ones.
- `deleteExpiredSessions()` exists in `auth/sessions.ts` and is **never called**.
  Needs a periodic job.
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
- ~~**Chat is hardcoded to the first dataset.**~~ Both routes now read the active
  model from `useDataset()`; the picker appears in the navbar once there is more
  than one.
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
5. ~~P1 #4 and #5 — introspection and the dataset endpoints~~ — done. The model
   itself is chosen in `PBI_*`; the UI curates it and can have it re-read.
6. Everything else by whatever the product needs.
