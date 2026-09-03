# Decisions

Non-obvious calls, why they were made, and what reversing them costs. Read this
before "fixing" something here — several of these look like mistakes until you know
the reason.

Decisions the user made explicitly are marked **[user]**. Decisions that departed
from the approved plan are marked **[departure]**.

---

## Architecture

### .NET ADOMD sidecar rather than REST-only **[user]**

The XMLA endpoint via ADOMD.NET has no row caps and full DMV/`INFO.*` access; the
Power BI REST `executeQueries` endpoint caps at 100k rows / 1M values. The cost is
a second language and runtime in the repo.

`DaxExecutor` in `apps/api/src/dax/executor.ts` is an interface with one
implementation. A REST executor was in the plan as a fallback and was **not
built** — the interface is the seam if it is needed.

**Requires Premium, PPU or Fabric capacity.** If the gateway cannot connect, check
that first.

### The gateway is stateless and has one endpoint **[departure]**

The plan had it holding a dataset registry and exposing `/query` plus `/metadata`.
Instead it takes credentials per request and exposes only `/query`.

Two reasons: Postgres stays the single home for secrets, so the gateway needs no
database, no migrations and no deploy coupling; and `INFO.*` introspection is
itself DAX, so `/metadata` would have been the same code path with a different
name.

### Column normalisation lives in TypeScript, not the gateway **[departure]**

The plan put `Table[Column]` → `Column` normalisation in the gateway. It is in
`dax/columns.ts` instead, so any second executor shares the behaviour rather than
reimplementing it in another language.

### One model, named by the environment and nowhere else **[user]**

`PBI_*` in `.env` is the only authority on which Power BI model the app talks to.
The API writes those five values into the `datasets` row on every boot
(`datasets/provision.ts`). There is no route that creates, lists, connects or
deletes a model, no id in any `/api/dataset` path, and no picker in the UI.
Switching models is an `.env` edit plus a restart.

The MVP — and this app until recently — let an admin type a connection into the
UI, which meant two authorities for the same fact: a `.env` nobody trusted and a
database row nobody could see. Then it grew a dataset list and a navbar selector,
which was a third: whichever row the browser happened to remember.

What it costs: an instance cannot serve two models. That is the intent. Anyone
who needs two runs two instances, which is also the only way to keep their
credentials, catalogues and curated notes apart.

The row is **reused** rather than replaced on a source change, so conversations
and dashboards survive. The one decision that throws data away — "does this stored
row describe a different model?" — is isolated in `pointsElsewhere`
(`datasets/source.ts`) and has a test. Which row is the active one is
`selectActiveRow` in the same file, shared by provisioning and by every request.

Rows the environment does not point at can only exist in a database that predates
the reuse rule. They are unreachable and are logged at boot, never deleted: a
stale row still owns somebody's conversations.

### Model catalog in Postgres, curated by hand **[user]**

`note` and `labels` on `dataset_columns` are curated; everything else is
introspectable. Introspection can find names and types but not "this is the only
summable column" — and those notes are what make the DAX correct. See
[data-model.md](./data-model.md) for the upsert requirement.

### Deterministic heuristics, not an LLM, for the introspection gap **[user]**

`INFO.*` returns names, types, relationships and real model measures. It does not
return table roles, `is_aggregatable`, sample values or the date range — all of
which the prompts lean on. An LLM enrichment pass was considered and rejected:
these rules are cheap, reproducible and testable, and a wrong guess here is
invisible until the DAX comes back wrong.

The rules live in `apps/api/src/datasets/heuristics.ts`. A table is `date` when
its `DataCategory` is `Time` or a fact joins to it on a datetime column, `fact`
when it is the many-side of a relationship, `dimension` otherwise. A column is
aggregatable when it is numeric, not a key, not a relationship endpoint, not in a
date table, not `SummarizeBy = None`, and its name does not read like a unit price
or a rate. That last rule errs towards non-additive on purpose: it only drops the
`[SUMABLE]` hint, whereas a wrongly summable price actively invites bad DAX.

Against the live Iowa model these reproduce the hand-written seed exactly. What
they cannot decide is reported as `warnings` rather than guessed.

### Extra context is a fourth prompt layer **[user]**

`datasets.extra_context` is admin-written prose, pushed into `buildInstructions`
after the schema and before the role — **with no flag, so every stage gets it**.
The router and the titler receive no schema, and they are precisely the stages
that cannot make sense of a model whose tables are called `TBL_VTA_CAB`.

It sits in its own section rather than inside `schemaSection`, because that
function's output format is tuned against the MVP's `esquema_para_prompt()` and
must stay byte-identical — `prompts.test.ts` asserts that it does. Capped at 8k
characters: it rides on up to eight LLM calls per question.

---

## Security

### scrypt rather than argon2id

argon2 is a native module. On NixOS, prebuilt `.node` binaries are a recurring
source of pain, and compiling adds a toolchain to every install. Node ships scrypt,
which OWASP lists as an acceptable alternative to argon2id.

Cost parameters (`N=2^15, r=8, p=1`) are stored alongside the hash, so they can be
raised later without invalidating existing passwords. If you move to argon2id, the
`scrypt$...` prefix makes a migrate-on-login path straightforward.

### Origin check rather than a CSRF token **[departure]**

The plan promised a double-submit CSRF token. Shipped instead: `SameSite=Strict`
on the session cookie plus an origin check on all unsafe methods
(`apps/api/src/app.ts`). Equivalent protection for a first-party SPA, one less
round trip and no token plumbing. Revisit if the API ever needs to serve a
third-party origin.

### Session tokens are hashed at rest

`sessions.token_hash` is the SHA-256 of the cookie value. A database leak does not
hand over live sessions.

---

## Pipeline

### The staged pipeline was kept; it was not turned into an agent

Deciding the visualization **before** generating DAX is what lets the generator be
told the exact data shape and column aliases to produce. That is why the charts come
out right. A tool-calling agent loop would lose it. See
[pipeline.md](./pipeline.md).

### Prompts stay in Spanish **[user]**

Identifiers are English; prompt text is Spanish. The prompts are tuned against the
model and retranslating them is an uncontrolled change with no way to detect
regressions until the parity harness exists.

### Sentinel strings became structured fields

The MVP signalled clarification and out-of-range by prefixing its output with
`NECESITA_ACLARACION:` / `FUERA_DE_RANGO:` and parsing with `startswith`. These are
now typed outcomes on `daxGenerationSchema`.

Because OpenAI's strict structured output rejects `anyOf` at the schema root, the
wire schema is a flat object mapped to the discriminated union immediately after.
Keep that split for any other union-shaped output.

### Filters are applied deterministically

`applyFilters` wraps the generated DAX in `CALCULATETABLE`. The MVP injected the
slicer state into the prompt as Spanish prose and the model did not always comply,
so a filtered dashboard could show unfiltered numbers. The repair stage sees the
unfiltered DAX and the wrapper is re-applied after, so the model never touches it.

### The writer no longer returns a title **[departure]**

The MVP's writer returned `{ text, title }`. Wrapping that call in structured output
would stream JSON tokens at the user instead of readable prose, so `answerData`
streams plain text and the card title comes from the decider's `suggestedTitle` —
which the MVP already used as its fallback.

Cost: the title cannot reflect the actual returned data. It is derived from the
question, which is what titles describe anyway.

---

## Frontend

### DaisyUI stock themes, MVP styling dropped **[user]**

No custom palette or design tokens. The MVP's hand-rolled CSS variable system
(~1,500 lines) is gone.

### No dual-axis combo chart **[departure]**

`combo` is two stacked panels sharing an x-axis, not bar + line on a secondary
axis. Two y-scales let any pair of series be made to look correlated by choosing
the scales, so the implied comparison is unverifiable — it is the single most
common charting mistake.

The capability is preserved. `ComboChart.tsx` is self-contained if you want the
Power BI look back; that is a product call, not a technical one.

### The chart palette was validated, not chosen by eye

Eight hues, each mode stepped for its own surface. Checked against the real DaisyUI
surfaces on lightness band, chroma floor, adjacent-pair CVD separation,
normal-vision floor and contrast. Both modes pass. Light mode's contrast warning on
three hues is met by always-present legends and hover tooltips.

Do not add a ninth hue. The API folds past eight into "Otros".

### Table values stay typed and are formatted client-side

The MVP pre-formatted table cells to strings server-side with `_fmt`, which emitted
en-US separators regardless of language — a Spanish user saw `1,234.56`. Cells are
now `string | number | boolean | null` and formatted with `Intl.NumberFormat`.

### react-grid-layout rather than a free canvas **[departure]**

The MVP was a free canvas with absolute pixel positions and hand-rolled drag/resize.
Grid layout snaps to a 12-column grid — **a real UX change** — in exchange for
collision handling, responsive breakpoints and no layout maths of our own.

### Search params rather than path params for selection

`/chat?c=<id>` instead of `/chat/$conversationId`. Half the route files, still
deep-linkable.

### Apps do not emit declarations

`apps/*` set `declaration: false, composite: false`. Emitting `.d.ts` from the API
would require naming the AI SDK's internal stream types, which are not portably
nameable. Only `packages/*` are consumable.

### A route file exports `Route` and nothing else

The page component lives in `components/`; the file under `routes/` is a
three-line wrapper. Exporting anything else from a route file defeats the router
plugin's automatic code splitting, and it makes the page untestable without
standing up the real route tree. `LoginForm` was the first one moved.

---

## Operations

### Three ways to run it, and Nix is never the only one **[departure]**

`docker compose`, plain pnpm with Node 24 on the host, and `nix develop` all
work, and the canonical commands live in `package.json` so all three run the same
thing. The devshell provides the toolchain and nothing else.

Before this, the README told people the host needed no Node and `start.sh` exited
without Nix — which made a Nix installation a hard prerequisite for a TypeScript
project.

### Every service runs alone, in Docker or on the host

Each compose service declares a profile, publishes its port, carries
`extra_hosts: ["host.docker.internal:host-gateway"]`, and takes every dependency
address from an environment variable. No source file names a neighbour. That is
what makes "API in Docker, Postgres on the host" a `.env` edit — the combinations
are in [development.md](./development.md).

The one literal that used to break this was the Vite proxy target; it is now
`API_PROXY_TARGET`.

### The flake exposes devShells and checks, not packages

The deployable artifacts are the Docker images. A `buildNpmPackage` of a pnpm
workspace would be a second, divergent build of the same thing, with an
`npmDepsHash` to re-paste on every lockfile edit. `nix flake check` runs what Nix
can check hermetically — the Nix formatting and shellcheck — and the JavaScript
lint, typecheck and tests stay in CI where pnpm has already installed
`node_modules`.

### The database-backed tests refuse to skip in CI

They need a real Postgres and create a throwaway database per vitest worker
(`apps/api/src/test/database.ts`). Locally they skip when `DATABASE_URL` is unset,
because a fresh clone should not fail before Docker is up. Under `CI` they throw
instead: a database-backed suite that quietly passes because nobody started
Postgres is worse than one that fails.

SQLite was never an option. The queries under test are Drizzle against Postgres 17
with `jsonb`, enums and cascading foreign keys.

---

## Dropped from the MVP on purpose

- **`followups`** — was wired end-to-end but always returned `[]`, with a dead
  `_FOLLOWUPS_TEMPLATE` constant. The field is retained in `cardPartSchema`;
  nothing populates it. Either implement or remove it, but do not ship a no-op.
- **The client-sent `history` array** — the MVP's frontend sent it on every request
  and the server ignored it entirely in favour of its own dict. Removed.
- **In-memory `_sessions`** — replaced by reading `messages`.
- **`_COL_ES`** — a hardcoded Spanish dictionary of Iowa column names, now
  per-dataset curated `labels`.
- **Bare `except Exception: return default`** — the MVP silently degraded to a
  default decision on any error, so a broken prompt looked like a table of the
  wrong measure. Failures now surface.

---

## Version pins worth knowing

- **vite must stay `^8`.** `@vitejs/plugin-react` 6 peer-depends on vite 8 and
  fails with `ERR_PACKAGE_PATH_NOT_EXPORTED: ./internal` under vite 7. An earlier
  pin of `^7.3.1` came from reading the *nixpkgs* package version rather than npm.
- **MSAL pinned to 4.87.0** in `DaxGateway.csproj`. ADOMD pulls in 4.56.0
  transitively, which carries NU1901/NU1902 advisories. Referencing it directly
  overrides the transitive version; the build is warning-free.
- **AI SDK 7** — see [api.md](./api.md) for the v5→v7 differences.
- All third-party versions live in the `catalog:` in `pnpm-workspace.yaml`. Bump
  there, not in individual `package.json` files.
