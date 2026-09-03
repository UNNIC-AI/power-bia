# Power BIA

Ask a Power BI semantic model questions in plain language. A question goes in, an
LLM pipeline turns it into DAX, Power BI executes it, and the answer comes back as
prose plus an interactive chart that can be pinned to a dashboard.

**Status:** working end to end against live Power BI and OpenAI. The parity
harness against the original MVP is not written yet — see [`docs/todo.md`](./docs/todo.md).

## Stack

- TypeScript everywhere, pnpm workspaces plus Turborepo
- **Frontend:** React 19, Vite, Tailwind 4, DaisyUI 5, Radix primitives, Tabler
  Icons, TanStack Router and Query, Recharts
- **API:** Fastify 5, Zod schemas shared with the frontend, Vercel AI SDK 7, Pino
- **Gateway:** .NET 10 minimal API over ADOMD.NET, speaking XMLA to Power BI
- **Data:** Postgres 17 with Drizzle ORM and file migrations
- **Tooling:** Biome, Vitest, Docker, Nix

## Quickstart

Three ways in. All three work, none is privileged, and they mix: any service can
run in Docker while its neighbours run on the host.

Every path starts the same way:

```bash
cp .env.example .env

# The three generated secrets need real values even in demo mode.
for v in DAX_GATEWAY_TOKEN DATASET_SECRET_KEY SESSION_COOKIE_SECRET; do
  sed -i "s|^$v=.*|$v=$(openssl rand -hex 32)|" .env
done
```

### 1. Docker

Nothing else installed, nothing on the host.

```bash
docker compose --profile all up -d --build
docker compose --profile migrate up migrate
```

Open <http://localhost:5173>. To stop: `docker compose --profile all down`.

### 2. Local tooling

Node 24 and .NET 10 on the host, Postgres and the gateway in containers. Exact
versions and per-OS notes are in [`docs/installation.md`](./docs/installation.md).

```bash
docker compose --profile db --profile gateway up -d

set -a; . ./.env; set +a       # nothing on the Node side reads .env by itself
pnpm install
pnpm db:migrate
pnpm --filter @powerbia/api demo   # optional: a navigable app with invented numbers
pnpm dev
```

Open <http://localhost:5173>. The demo account is `demo@unnic.ai` /
`demo-password-1234`; without it, the first account you register becomes the admin.

### 3. Nix

The devshell provides the toolchain; the commands are the same as path 2.

```bash
nix develop
docker compose --profile db --profile gateway up -d
set -a; . ./.env; set +a
pnpm install && pnpm db:migrate && pnpm dev
```

`./start.sh` does path 3 end to end, including the traps: re-entering the
devshell, exporting `.env`, generating the secrets, waiting for Postgres,
rebuilding the workspace packages, migrating and seeding.

```bash
./start.sh              # live if .env carries real credentials, demo otherwise
./start.sh demo         # invented numbers, no credentials used
./start.sh live --smoke # query Power BI once before starting
./start.sh --status     # what is up and what is not
./start.sh --stop       # stop the containers (--reset also wipes the database)
```

## Environment

`.env.example` lists every variable the code reads, with a safe default or a
placeholder. The ones without a default:

| Variable | What it is for | Example |
|---|---|---|
| `DATABASE_URL` | Postgres. The only knob the app reads for it | `postgres://powerbia:powerbia@localhost:5432/powerbia` |
| `OPENAI_API_KEY` | Any OpenAI-compatible provider | `sk-...` |
| `DAX_GATEWAY_URL` | Where the .NET gateway answers | `http://localhost:8080` |
| `DAX_GATEWAY_TOKEN` | Shared bearer token, API to gateway | `openssl rand -hex 32` |
| `DATASET_SECRET_KEY` | AES-256-GCM key for the stored service principal secret. Exactly 64 hex chars | `openssl rand -hex 32` |
| `SESSION_COOKIE_SECRET` | Signs the session cookie. 32 chars or more | `openssl rand -hex 32` |
| `PBI_TENANT_ID` and four more `PBI_*` | **The only place the Power BI model is chosen** | see below |

Ones worth knowing about, all defaulted: `NODE_ENV`, `PORT`, `WEB_ORIGIN` (drives
CORS *and* the origin check on every mutation), `API_PROXY_TARGET` (where the web
dev server forwards `/api`), `LLM_MODEL` (`gpt-4.1`), `OPENAI_BASE_URL`,
`INTROSPECT_ON_STARTUP`, `INTROSPECT_MAX_AGE_HOURS`, `MODEL_CONTEXT_LOCALE`, and
the compose-only `POSTGRES_PORT` / `GATEWAY_PORT` / `API_PORT` / `WEB_PORT` and
`COMPOSE_*` addresses - see [`docs/development.md`](./docs/development.md).

**Nothing on the Node side reads `.env`.** No dotenv, no direnv. Export it in
every shell where you run a `pnpm` command: `set -a; . ./.env; set +a`. Quote any
value containing a space. Compose reads `.env` on its own, and it interpolates
`DAX_GATEWAY_TOKEN` while loading the file, so every compose command fails while
that value is empty.

### One model, chosen in `.env`

`PBI_TENANT_ID`, `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET`, `PBI_WORKSPACE_NAME` and
`PBI_DATASET_NAME` are the only place the Power BI model is named. The API writes
them into the `datasets` row on **every** boot. There is no route that creates,
lists or deletes a model, and no picker in the UI. Pointing the app at a different
model is: edit `.env`, restart. The row is reused, so conversations and dashboards
survive; the catalogue of the model you left behind is dropped, and the new one is
introspected during that same start.

The credentials, the Entra app registration, the tenant settings and the XMLA
capacity requirement are all in [`docs/setup.md`](./docs/setup.md), which is where
the real work is.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API on :3000, web on :5173, both in watch mode |
| `pnpm build` | Build every package |
| `pnpm test` | Vitest, API and web. **Needs Postgres** — see below |
| `pnpm typecheck` | `tsc --noEmit` across every package |
| `pnpm lint` / `pnpm lint:fix` | Biome, lint and format |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:generate` | Write a migration from `packages/db/src/schema.ts` |
| `pnpm db:seed` | Idempotent metadata seed |
| `pnpm --filter @powerbia/api demo` | Demo user, dashboard and conversations |
| `pnpm --filter @powerbia/db studio` | Drizzle Studio |

The database-backed suites need a real Postgres — `docker compose --profile db up
-d` — and create their own throwaway database per vitest worker. They skip when
`DATABASE_URL` is unset, except under `CI`, where they fail rather than skip.

## What runs where

| Piece | Port | Profile |
|---|---|---|
| `apps/web` — React, Vite dev server | 5173 | `web` |
| `apps/api` — Fastify | 3000 | `api` |
| Postgres 17 | 5432 | `db` |
| `services/dax-gateway` — .NET over ADOMD.NET | 8080 | `gateway` |

Every service publishes its port and takes every dependency address from an env
var, which is what lets any one of them run in Docker against neighbours on the
host, or the other way round. The combinations are in
[`docs/development.md`](./docs/development.md).

In production the gateway is **not** published — it holds the Power BI service
principal credentials and only the API has any business reaching it. See
`docker-compose.prod.yml` and [`docs/deployment.md`](./docs/deployment.md).

## Layout

```
apps/api            Fastify: auth, the LLM pipeline, the card builder
apps/web            React SPA
packages/contracts  Zod schemas, the only source of truth for anything on the wire
packages/db         Drizzle schema, migrations, seed
services/dax-gateway  .NET 10 over ADOMD.NET: /health and /query
docs                Architecture, pipeline, data model, API, setup, decisions
legacy              The original Python MVP, still runnable
```

## Docs

- [`docs/README.md`](./docs/README.md) — start here, reading order and current state
- [`docs/installation.md`](./docs/installation.md) — prerequisites and exact versions
- [`docs/setup.md`](./docs/setup.md) — every credential and tenant setting the live path needs
- [`docs/development.md`](./docs/development.md) — day-to-day workflow and the Docker/host combinations
- [`docs/deployment.md`](./docs/deployment.md) — images, migrations, backups, rollback
- [`docs/architecture.md`](./docs/architecture.md) — the four deployables and the request path
- [`docs/pipeline.md`](./docs/pipeline.md) — the LLM pipeline stage by stage
- [`docs/api.md`](./docs/api.md) — every endpoint and the streaming chat contract
- [`docs/data-model.md`](./docs/data-model.md) — Postgres schema and the dataset catalogue
- [`docs/frontend.md`](./docs/frontend.md) — routes, renderers, theming, i18n
- [`docs/decisions.md`](./docs/decisions.md) — non-obvious calls and what they cost
- [`AGENTS.md`](./AGENTS.md) — how to run, test and lint, for humans and agents

## Troubleshooting

- **The API refuses to boot naming an env variable.** That is `apps/api/src/env.ts`
  doing its job. Quote any value containing a space.
- **Every write returns an error while reads work.** `WEB_ORIGIN` drives CORS and
  the origin check on mutations. A wrong value blocks all writes.
- **Editing `packages/db` or `packages/contracts` seems to have no effect.** The
  API runs through `tsx`, which resolves them to their built `dist/`, and
  `tsx watch` does not watch `dist/`. Run `pnpm build`.
- **The gateway cannot connect to Power BI.** Check the capacity before the code:
  XMLA does not exist on shared capacity. The workspace needs Premium, PPU or
  Fabric, with the XMLA endpoint set to `Read`.
- **`docker compose` fails before starting anything.** It interpolates
  `DAX_GATEWAY_TOKEN` when it loads `.env`, so an empty value breaks every compose
  command, including one that only starts Postgres.
- **Typing a question in demo mode fails** at the first model call. The demo
  exercises every renderer, not the pipeline.

The longer list of traps that cost an hour each is in
[`docs/README.md`](./docs/README.md).

## Legacy MVP

The original Python and FastAPI MVP is in [`legacy/`](./legacy/) and still runs.
It is kept until the parity harness captures its golden questions
([`docs/todo.md`](./docs/todo.md) P0 #2), not because anything depends on it.
