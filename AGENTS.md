# AGENTS.md

Power BIA lets non-technical users query a Power BI semantic model in natural
language: a question goes in, an LLM pipeline turns it into DAX, Power BI
executes it, and the answer comes back as prose plus a chart that can be pinned
to a dashboard.

This file is operational. What the project is and how it works is in
[`docs/`](./docs/README.md); how to run it is in [`README.md`](./README.md).

## Commands

Everything runs from the repo root. There are three ways in and none of them is
privileged: `docker compose`, plain pnpm with Node 24 on the host, or
`nix develop`. The commands below are the same in all three.

```bash
pnpm install
pnpm dev                  # api on :3000, web on :5173
pnpm build
pnpm lint                 # biome check (lint + format)
pnpm lint:fix
pnpm typecheck            # tsc --noEmit across every package
pnpm test                 # vitest, api + web
pnpm db:generate          # write a migration from packages/db/src/schema.ts
pnpm db:migrate           # apply migrations
pnpm db:seed              # idempotent metadata seed
pnpm --filter @powerbia/api demo   # demo user, dashboard and conversations

cd services/dax-gateway && dotnet build -c Release && dotnet test
```

**Tests need Postgres.** `docker compose --profile db up -d` first. The suites
that touch the database create their own throwaway database per vitest worker
(`apps/api/src/test/database.ts`) and skip when `DATABASE_URL` is unset - except
under `CI`, where they fail rather than skip.

**Rebuild the workspace packages after editing them.** The API runs through
`tsx`, which resolves `@powerbia/db` and `@powerbia/contracts` to their built
`dist/`, and `tsx watch` does not watch `dist/`. Run
`pnpm --filter @powerbia/contracts --filter @powerbia/db build`.

**Nothing on the Node side reads `.env`.** No dotenv, no direnv. Export it:
`set -a; . ./.env; set +a`. Quote any value containing a space.

## Layout

```
apps/api/src/
  index.ts        listen, graceful shutdown
  app.ts          buildApp(): plugins, hooks, error handler, health, routes
  env.ts          the whole environment, Zod-parsed at import, throws on a gap
  auth/           scrypt hashing, opaque sessions in Postgres
  cards/          build.ts (the card builder) + table.ts + reduce.ts
  conversations/  message persistence
  datasets/       provision.ts + source.ts (PBI_* -> the dataset row)
                  introspect.ts (INFO.* -> catalogue) + heuristics + probes
                  sync.ts, context.ts
  dax/            columns, sanitize, filters, identifiers, executor
  pipeline/       prompts.ts, stages.ts, run.ts, retitle.ts
  routes/         one file per resource
  test/           env.ts, database.ts - helpers, not suites

apps/web/src/
  routes/         file-based routes only; a route file exports Route and nothing else
  components/     grouped by area (cards, charts, chat, dashboard) plus shared ones
  lib/            api client, queries, i18n, formatting, theme
  test/           setup.ts, server.ts (msw), render.tsx

packages/contracts/src/   the only source of truth for anything crossing HTTP
packages/db/src/          schema.ts, client.ts, crypto.ts, seed.ts
services/dax-gateway/     .NET 10 over ADOMD.NET: /health and /query
legacy/                   the original Python MVP, still runnable, not a dependency
```

Where a new file goes: a shape that crosses the wire goes in
`packages/contracts`; a route goes in `apps/api/src/routes`; a page goes in
`apps/web/src/routes` as a thin wrapper over a component; business logic goes
beside the domain it belongs to, never in a route handler.

## Invariants

Break one of these and the app is wrong in a way tests may not catch. The
reasoning is in [`docs/decisions.md`](./docs/decisions.md).

- **There is exactly one Power BI model and the environment names it.** `PBI_*`
  is written into the `datasets` row on every boot (`datasets/provision.ts`).
  There is no route to create, list or delete a model, no id in any
  `/api/dataset` path, and no picker in the UI. Switching models is an `.env`
  edit plus a restart.
- **Re-introspection never touches the curated layer.** `note` and `labels` on
  `dataset_columns`, the synonyms, and measures with `source = 'curated'`
  survive any sync. `introspect.test.ts` guards this.
- **`datasets.extra_context` belongs to the admin after its first draft.** The
  model writes it once; a sync never rewrites non-empty text.
- **The visualization decision is made before the DAX is generated.** That is
  what lets the generator be told the exact shape to produce. Do not turn the
  pipeline into a tool-calling agent without solving this first.
- **Dashboard filters are applied deterministically**, by wrapping the DAX in
  `CALCULATETABLE` (`dax/filters.ts`), never as prose in a prompt.
- **The catalogue is discovered with `INFO.*`, never hand-written.** What
  `INFO.*` does not give is filled by deterministic heuristics, never an LLM.
- **Migrations are never applied on application start.** They are a command, a
  compose service, or a deploy step.
- **The gateway stores no credentials.** It receives them per request; the
  database is the only place secrets live, encrypted with AES-256-GCM.

## Conventions

- Identifiers in English. Product prose is Spanish and English through i18n.
- **The system prompts stay in Spanish.** They are tuned against the model and
  are not retranslated. They live only in `apps/api/src/pipeline/prompts.ts`.
- Versions are centralized in the `catalog:` of `pnpm-workspace.yaml`. Never put
  a range in a `package.json`.
- Interactive components are Radix primitives with DaisyUI classes. Never
  hand-roll a dialog, menu, select or tooltip, and never use the CSS-only
  version of something that has to work from a keyboard.
- Look for a TanStack answer first (Query, Router, Form, Table, Virtual) before
  reaching for another library.
- Config comes from the environment and is parsed once, in `env.ts`. Never read
  `process.env` deeper in the code.
- Every route declares a response schema. It documents the API and it stops
  internal fields leaking.
- Apps do not emit `.d.ts`; only `packages/*` are consumable.

## Code style

- Comments explain why, not what. JSDoc on exported functions and types.
- **No emojis.** Not in code, comments, commits, logs, CLI output, docs or UI.
  UI glyphs come from Tabler Icons.
- **Source stays ASCII.** No em dashes, arrows, box drawing or curly quotes in
  code, comments, log messages or CLI output - `-` and `->` read fine. Markdown
  is exempt. The exceptions are real user-facing content and real data: the
  Spanish prompts in `pipeline/prompts.ts`, the i18n strings in `lib/i18n.ts`,
  and the seed data.
- Formatting is Biome's job, not a review topic. Conventional commits.
- Delete dead code rather than commenting it out.

## Do not touch

- `apps/web/src/routeTree.gen.ts` - generated by the router plugin, committed.
- `packages/db/drizzle/**` - migrations already applied. Add a new one instead.
- `pnpm-lock.yaml`, `flake.lock` - committed, changed only by their own tools.
- `legacy/` - kept runnable until the parity harness captures its fixtures.
- `apps/api/src/pipeline/prompts.ts` - tuned against the model. Change it
  deliberately, never as part of a sweep.
