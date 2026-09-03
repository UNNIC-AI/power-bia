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
| [installation.md](./installation.md) | Prerequisites and exact versions for each of the three ways to run it |
| [setup.md](./setup.md) | **Every credential, tenant setting and capacity requirement needed to make the real pipeline work** |
| [development.md](./development.md) | The day-to-day loop, the Docker/host combinations, tests, the traps |
| [architecture.md](./architecture.md) | The four deployables, how a request flows, why the pieces are split this way |
| [pipeline.md](./pipeline.md) | The LLM pipeline stage by stage, and the card builder — the part that carries the product's value |
| [data-model.md](./data-model.md) | Postgres schema, the dataset catalog, secret encryption |
| [api.md](./api.md) | Every endpoint, with the streaming chat contract |
| [frontend.md](./frontend.md) | Routes, card renderers, chart rules, theming, i18n |
| [deployment.md](./deployment.md) | Images, migrations, health checks, backups and restore, rollback |
| [decisions.md](./decisions.md) | Non-obvious calls and what they cost — read before changing them |
| [todo.md](./todo.md) | **What is left to do.** Start here if you are picking this up. |

## Current state

| Phase | Contents | State |
|---|---|---|
| 0 | Monorepo, Nix devshell, docker-compose, CI | Done |
| 1 | `packages/contracts` — shared Zod schemas | Done |
| 2 | `packages/db` — Drizzle schema, migration, seed | Done |
| 3 | `services/dax-gateway` — .NET over ADOMD.NET | Working against live Power BI over XMLA |
| 4 | `apps/api` — Fastify, auth, pipeline, cards | Working end to end against live Power BI + OpenAI |
| 5 | `apps/web` — React, DaisyUI, TanStack | Working; chat and dashboard reviewed visually |
| 6 | Parity harness, observability | **Not started** |
| 7 | Packaging: Dockerfiles per service, compose profiles, route and DOM tests, health checks, CI | Done |

Roughly 6,500 lines across the four packages. The plan this was built from is at
`~/.config/claude/plans/functional-snuggling-micali.md`.

### What is actually verified

- Lint clean, 0 typecheck errors across all packages, **80 tests pass** — 72 in
  the API (including route tests through `app.inject()` against a real Postgres)
  and 8 in the web app (through the DOM, with the network stubbed by MSW).
- **All three run paths work**: `docker compose --profile all`, plain pnpm on the
  host, and `nix develop`. `nix flake check` passes.
- The API and web images build and were smoke-tested: `/healthz` answers,
  `/readyz` reports `{ database: true, gateway: true }`, an unauthenticated
  `/api/dataset` is a 401, and nginx serves the SPA with its history fallback.
- The gateway builds with zero warnings and **executes DAX against live Power BI
  over XMLA** (`EVALUATE ROW("ok", 1)` returns in ~18s cold, ~1.3s warm).
- `INFO.TABLES()` works on the capacity, so introspection is viable.
- The migration applies to Postgres 17; all 13 tables exist.
- Auth: login, `/auth/me`, 401 without a cookie, per-user scoping. Registration is
  closed once an account exists (403), and the admin routes were exercised end to
  end: create, list, reset password (kills that user's sessions), self password
  change (keeps the caller's), 409 on removing yourself, 403 for a member.
- The model summary and its context round-trip the curated column notes and labels.
- Dashboard create → add widget → batched layout save → pin toggle → read back.
- A malformed card is rejected with a 400 by the shared contract.
- Chat and dashboard reviewed visually in a real browser.

**Four questions answered end to end** against the live model, ~8s each:

| Question | Result |
|---|---|
| "¿Cuántas botellas se vendieron en 2020?" | `kpi` · `ROW(...)` not `SUMMARIZECOLUMNS`, year filter unquoted |
| "Evolución de botellas vendidas por mes en 2020" | `line` · canonical `CALCULATETABLE` + `SUMMARIZECOLUMNS` pattern |
| "Top 5 categorías por botellas vendidas en 2021" | `bar` · `TOPN(5)` |
| "¿Cuáles fueron las ventas del mes pasado?" | **Correctly refused** — anchored to today, saw it fell outside 2012–2021, did not substitute a nearby period |

### What is still NOT verified

- **No systematic parity check against the MVP.** Four questions is a smoke test,
  not the golden-question harness — see [todo.md](./todo.md) P0 #2, which still
  has to be captured from `legacy/` before it is dismantled.
- The 80 tests cover the card builder, password hashing, the introspection
  invariants, the auth routes and the single-model routes through `app.inject()`,
  and two frontend components through the DOM. Still untested: the DAX helpers
  (`filters.ts` most of all), the pipeline stages, the remaining routes, the chat
  panel and the dashboard canvas. See [todo.md](./todo.md) #9.
- No end-to-end test. The money path - sign in, ask, pin - is exercised by hand.
- The restore command in [deployment.md](./deployment.md) is written down but has
  not been run against a real dump yet.

## Quickstart

The three ways to run it are in [../README.md](../README.md) and the
prerequisites in [installation.md](./installation.md). The short version, with
Postgres and the gateway in containers and the app on the host:

```bash
cp .env.example .env             # then fill in the values below
docker compose --profile db --profile gateway up -d
set -a; . ./.env; set +a
pnpm install
pnpm db:migrate
pnpm db:seed                     # inserts the Iowa Liquor Sales model
pnpm dev                         # api on :3000, web on :5173
```

`./start.sh` does exactly that, plus the traps. `docker compose --profile all up
-d --build` runs everything in containers instead.

Open http://localhost:5173. The web dev server proxies `/api` to the API, so the
app is same-origin and the `SameSite=Strict` session cookie behaves as it will in
production.

Required in `.env`: `OPENAI_API_KEY`, and `PBI_TENANT_ID` / `PBI_CLIENT_ID` /
`PBI_CLIENT_SECRET` / `PBI_WORKSPACE_NAME` / `PBI_DATASET_NAME` — the Power BI
model is chosen there and nowhere else, so switching models means editing those
and restarting. The three
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
pnpm test          # vitest. Needs Postgres: docker compose --profile db up -d
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
- **Compose interpolates `.env` into `docker-compose.yml` itself.** A container
  address therefore cannot reuse the host-side variable name - the host value
  would always win and the compose default would never apply. Hence
  `COMPOSE_DATABASE_URL` and friends; see [development.md](./development.md).
- **A `*.test.tsx` under `apps/web/src/routes/` is not a route.** The router
  plugin ignores it, and a route file exports `Route` and nothing else.
