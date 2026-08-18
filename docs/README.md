# Power BIA — documentation

Power BIA lets non-technical users query a Power BI semantic model in natural
language. A question goes in, an LLM pipeline turns it into DAX, Power BI
executes it, and the answer comes back as prose plus an interactive chart that
can be pinned to a dashboard.

This directory documents the production rewrite. The original Python MVP is in
`legacy/` and still runs — keep it until the parity harness exists
(see [todo.md](./todo.md)).

## Read in this order

| Document | What it covers |
|---|---|
| [../SETUP.md](../SETUP.md) | **Every credential, tenant setting and capacity requirement needed to make the real pipeline work** |
| [architecture.md](./architecture.md) | The four deployables, how a request flows, why the pieces are split this way |
| [pipeline.md](./pipeline.md) | The LLM pipeline stage by stage, and the card builder — the part that carries the product's value |
| [data-model.md](./data-model.md) | Postgres schema, the dataset catalog, secret encryption |
| [api.md](./api.md) | Every endpoint, with the streaming chat contract |
| [frontend.md](./frontend.md) | Routes, card renderers, chart rules, theming, i18n |
| [decisions.md](./decisions.md) | Non-obvious calls and what they cost — read before changing them |
| [todo.md](./todo.md) | **What is left to do.** Start here if you are picking this up. |

## Current state

| Phase | Contents | State |
|---|---|---|
| 0 | Monorepo, Nix devshell, docker-compose, CI | Done |
| 1 | `packages/contracts` — shared Zod schemas | Done |
| 2 | `packages/db` — Drizzle schema, migration, seed | Done |
| 3 | `services/dax-gateway` — .NET over ADOMD.NET | Compiles; **never run against real Power BI** |
| 4 | `apps/api` — Fastify, auth, pipeline, cards | Serves; **pipeline never run against real Power BI** |
| 5 | `apps/web` — React, DaisyUI, TanStack | Builds and serves; **never visually reviewed** |
| 6 | Parity harness, observability, hardening | **Not started** |

Roughly 6,500 lines across the four packages. The plan this was built from is at
`~/.config/claude/plans/functional-snuggling-micali.md`.

### What is actually verified

- Lint clean (75 files), 0 typecheck errors across all packages, 19 tests pass.
- The gateway builds with zero warnings.
- The migration applies to Postgres 17; all 13 tables exist.
- Against a live API: register, login, `/auth/me`, 401 without a cookie,
  per-user scoping of conversations and dashboards.
- Dataset list and context round-trip the curated column notes and labels.
- Dashboard create → add widget → batched layout save → pin toggle → read back.
- A malformed card is rejected with a 400 by the shared contract.

### What is explicitly NOT verified

- **No question has ever been answered end to end.** That needs
  `OPENAI_API_KEY` and real `PBI_*` credentials. Every LLM stage and the whole
  gateway path are unexercised.
- **Nobody has looked at the UI.** Layout, spacing and chart geometry are
  unconfirmed; only that modules transform and the bundle builds.
- The 19 tests cover the card builder and password hashing. Nothing else has
  tests.

## Quickstart

The host has no Node or .NET — everything runs through the Nix devshell.

```bash
nix develop                      # node 24, pnpm 11, dotnet 10, psql 17
pnpm install
cp .env.example .env             # then fill in the values below
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed                     # inserts the Iowa Liquor Sales model
pnpm dev                         # api on :3000, web on :5173
```

Open http://localhost:5173. The web dev server proxies `/api` to the API, so the
app is same-origin and the `SameSite=Strict` session cookie behaves as it will in
production.

Required in `.env`: `OPENAI_API_KEY`, and `PBI_TENANT_ID` / `PBI_CLIENT_ID` /
`PBI_CLIENT_SECRET` / `PBI_WORKSPACE_NAME` / `PBI_DATASET_NAME`. The three
generated secrets (`DAX_GATEWAY_TOKEN`, `DATASET_SECRET_KEY`,
`SESSION_COOKIE_SECRET`) each want `openssl rand -hex 32`. Quote any value
containing a space, so `set -a; . ./.env` works.

## Demo mode — running it without credentials

To show the app with no Power BI or OpenAI access, seed a demo account with
pre-built cards:

```bash
pnpm --filter @powerbia/api demo
```

That creates `demo@unnic.ai` / `demo-password-1234` with a 13-widget dashboard
covering every card kind except `choice`, plus three conversations with cards and
DAX. The numbers are invented; the card shapes are the real contract shapes, so
every renderer is exercised by genuine data. It is re-runnable — it drops the
demo user's dashboards and conversations before rebuilding them.

The env variables still have to be *present and well-formed* (Zod validates them
at boot), but they can be fake. **Typing a question in demo mode will fail** at
the first model call and surface an error in the chat — the demo is for showing
the rendered result, not the pipeline.

## Checks

```bash
pnpm lint          # biome
pnpm typecheck     # tsc across all packages
pnpm test          # vitest
pnpm build         # turbo build
```

For the gateway: `cd services/dax-gateway && dotnet build -c Release`.

## Gotchas that will cost you an hour

- **Rebuild `packages/db` and `packages/contracts` after editing them.** The API
  runs through `tsx`, which resolves the workspace packages to their built
  `dist/`. Editing `src` and restarting the API changes nothing until
  `pnpm --filter @powerbia/db build` runs. This bit during development.
- **`pnpm dev` for the API uses `tsx watch`, which does not watch `dist/`.** Same
  trap from the other direction.
- **A Drizzle relation needs both sides declared.** A lone `many()` compiles fine
  and then fails at query time with "not enough information to infer relation".
- **Keep vite on `^8`.** `@vitejs/plugin-react` 6 peer-depends on vite 8 and
  fails with `ERR_PACKAGE_PATH_NOT_EXPORTED: ./internal` on vite 7.
- **pnpm 11 blocks postinstall scripts** unless named in `allowBuilds` in
  `pnpm-workspace.yaml`.
- **The XMLA endpoint requires Premium, PPU or Fabric capacity.** If the gateway
  cannot connect, check the capacity before debugging the code.
