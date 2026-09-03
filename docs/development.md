# Development

Prerequisites and the first-run steps are in [installation.md](./installation.md).
This file is the day-to-day.

## The loop

```bash
set -a; . ./.env; set +a          # every shell that runs a pnpm command
docker compose --profile db --profile gateway up -d
pnpm dev
```

`pnpm dev` runs both watchers through Turborepo: the API on :3000 through `tsx
watch`, the web app on :5173 through Vite. The Vite dev server proxies `/api` to
the API, so the app is same-origin in development and the `SameSite=Strict`
session cookie behaves exactly as it will in production behind nginx.

Before pushing:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## Mixing Docker and the host

Every service declares a compose profile, publishes its port, and takes every
dependency address from an env var. Nothing addresses a neighbour by a hardcoded
name. That is what makes the combinations below `.env` edits rather than code
changes.

Every service also carries `extra_hosts: ["host.docker.internal:host-gateway"]`,
which is what makes that name resolve on Linux; it is native on macOS.

```bash
docker compose --profile all up -d              # everything in Docker
docker compose --profile db up -d               # just Postgres
docker compose --profile db --profile gateway up -d   # the usual: both, rest on the host
docker compose --profile api up -d              # the API and the gateway in Docker
docker compose --profile web up -d              # the web app in Docker
docker compose --profile migrate up migrate     # one-shot migration
```

The addresses each combination needs:

| Combination | Set in `.env` |
|---|---|
| Everything on the host | `DATABASE_URL=...@localhost:5432/...`, `DAX_GATEWAY_URL=http://localhost:8080` |
| Everything in compose | nothing — the compose defaults are already the compose-network addresses |
| API in Docker, Postgres on the host | `COMPOSE_DATABASE_URL=...@host.docker.internal:5432/powerbia` |
| Web in Docker, API on the host | `COMPOSE_API_PROXY_TARGET=http://host.docker.internal:3000` |

**Why two names for the same address.** `DATABASE_URL` and `DAX_GATEWAY_URL` are
what a process on the host reads. `COMPOSE_DATABASE_URL` and
`COMPOSE_DAX_GATEWAY_URL` are what a container reads. They have to be different
names: compose interpolates `.env` into the compose file itself, so
`DATABASE_URL: ${DATABASE_URL:-postgres://...@postgres:5432/...}` would always
resolve to the host-side value `.env` already defines, and the compose-network
default would never apply. That is exactly the bug the split fixes.

Host-side published ports are variables too — `POSTGRES_PORT`, `GATEWAY_PORT`,
`API_PORT`, `WEB_PORT` — so a port already taken by something else does not need
the compose file edited:

```bash
API_PORT=3010 WEB_PORT=5183 docker compose --profile all up -d
```

## Tests

```bash
docker compose --profile db up -d
set -a; . ./.env; set +a
pnpm test
```

**A real Postgres, never a stand-in.** The queries under test are Drizzle against
Postgres 17 with `jsonb`, enums and cascading foreign keys; SQLite or a mocked
query builder would prove the code compiles and nothing else. Each vitest worker
creates its own `powerbia_test_<worker>` database, migrates it, and drops it on
the next run, so files run in parallel without sharing rows and a crashed run
leaves nothing behind (`apps/api/src/test/database.ts`).

Those suites skip when `DATABASE_URL` is unset — **except under `CI`, where they
fail rather than skip.** A database-backed suite that quietly passes because
nobody started Postgres is worse than one that fails.

What is worth testing here:

- **API routes through `app.inject()`**, never by calling a handler directly.
  `buildApp()` takes `{ databaseUrl, executor, bootstrap }` so a test owns its
  database and no request reaches Power BI. Per route: the happy path, the
  unauthenticated rejection, and one validation failure.
- **Frontend components through the DOM**, with `renderInApp` (`src/test/render.tsx`)
  wrapping them in a QueryClient and a memory router. Query by role, label and
  text; interact with `user-event`.
- **The network stubbed at the HTTP layer with MSW**, not by mocking the API
  client — that keeps `lib/api.ts`, the error mapping and the Query wiring inside
  the test. An unhandled request fails the test rather than returning undefined.
- **Radix components from the keyboard**: the dialog opens, focus lands inside it,
  Escape closes it. A CSS-only dialog passes a screenshot and fails this.
- **Never a live model provider.** Nothing in the suite calls OpenAI.

**Every bug gets a failing test first.** The reproduction already exists, so it is
the cheapest test that will ever be written, and it is the only thing that keeps
the bug fixed.

## The traps

- **Editing `packages/db` or `packages/contracts` appears to do nothing.** The API
  runs through `tsx`, which resolves workspace packages to their built `dist/`,
  and `tsx watch` does not watch `dist/`. Run
  `pnpm --filter @powerbia/contracts --filter @powerbia/db build`.
- **`.env` is not loaded for you.** No dotenv, no `--env-file`, no direnv on the
  Node side. `set -a; . ./.env; set +a`, and quote values containing a space.
- **Compose fails before starting anything.** It interpolates
  `DAX_GATEWAY_TOKEN` while loading `.env`, so an empty value breaks every compose
  command.
- **Every write 403s while reads work.** `WEB_ORIGIN` drives CORS *and* the origin
  check on mutations.
- **A test file under `apps/web/src/routes/` is not a route.** The router plugin
  ignores `*.test.tsx` there, and a route file should export `Route` and nothing
  else — put the page component in `components/` so the route stays one
  code-split unit.

## Debugging

- The API logs through Pino, pretty-printed at `debug` level in development.
  `authorization`, `cookie` and `set-cookie` are redacted in every environment.
- A 5xx returns `{ message, requestId }`; the stack is in the log next to that
  request id. 4xx return the guard's or the schema's own message.
- `GET /healthz` says the process is up. `GET /readyz` reports whether Postgres
  and the gateway actually answer, and 503s if the database does not.
- `GET /api/openapi.json` is the OpenAPI document, generated from the same Zod
  schemas the routes validate against.
- Drizzle Studio: `pnpm --filter @powerbia/db studio`.
- Gateway logs: `docker compose logs -f dax-gateway`.
- Test the gateway without involving the LLM. `EVALUATE ROW("ok", 1)` touches no
  table, so it isolates auth and connectivity from anything about the model — the
  exact curl is in [setup.md](./setup.md), and `./start.sh live --smoke` runs it.

## Database changes

```bash
# 1. edit packages/db/src/schema.ts
pnpm db:generate      # writes packages/db/drizzle/NNNN_name.sql
# 2. read the generated SQL before committing it
pnpm db:migrate
```

Autogenerate misses enum changes and gets column renames wrong — it drops and
recreates. Read every generated migration.

Additive first: add a nullable column, backfill, then add the constraint. A
destructive migration ships in a later release than the code that stopped using
the column, and never in the same PR.

Seeds are separate and idempotent, and never carry data a migration should.
