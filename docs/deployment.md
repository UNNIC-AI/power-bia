# Deployment

Docker is the target. `docker-compose.prod.yml` is the production shape and is
deliberately **not** an overlay on `docker-compose.yml`: that file exists to make
development combinations easy, and its bind mounts, `dev` build targets and
default database password are exactly what must not reach a server.

## The images

| Image | Dockerfile | Target | Serves |
|---|---|---|---|
| API | `apps/api/Dockerfile` | `runtime` | Fastify on :3000, `node dist/index.js`, as the `node` user |
| Web | `apps/web/Dockerfile` | `runtime` | nginx on :8080 with the built SPA, proxying `/api` |
| Gateway | `services/dax-gateway/Dockerfile` | — | .NET on :8080 |

Both Node images are built from the repo root, because the apps depend on the
workspace packages. The API image copies manifests before sources so
`pnpm install` is cached across code edits, and no secret is ever a build
argument — they all arrive as runtime environment.

Nothing builds them automatically. `docker compose build` is the only thing that
catches a broken Dockerfile, so run it before a deploy rather than during one.

## Topology

Only the web container is published. It serves the static bundle and proxies
`/api` to the API over the compose network, which is what keeps the app
same-origin and lets the session cookie stay `SameSite=Strict` with no CORS
involved.

```
internet -> web (nginx :8080) -> api :3000 -> dax-gateway :8080 -> Power BI (XMLA)
                                    |
                                 postgres :5432
```

The gateway is **not published**. It holds the Power BI service principal
credentials and only the API has any business reaching it. If you find yourself
publishing it to debug something, take the port back out afterwards.

Put a TLS terminator in front of the web container. `NODE_ENV=production` makes
the session cookie `Secure`, so the app does not work over plain HTTP.

## Deploying

```bash
# Secrets come from the environment or a secret store, never from a file in the repo.
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

The `migrate` service runs once, before the API starts —
`depends_on: { migrate: { condition: service_completed_successfully } }`.
**Migrations are never applied by a booting application:** with more than one
replica, two processes race.

`docker-compose.prod.yml` uses `${VAR:?}` for every secret, so a missing variable
stops the deploy instead of silently starting an instance with a known password.
The full list is in `.env.example`; the ones with no safe default are in the table
in [`README.md`](../README.md).

Pin image tags rather than rebuilding in place once there is more than one
environment.

## Switching the Power BI model

Edit `PBI_*` and restart the API. The environment is the only authority: the
values are written into the `datasets` row on every boot. The row is reused, so
conversations and dashboards survive. If the workspace or dataset name changed,
the previous model's catalogue and generated context are dropped and the new model
is introspected during that same start.

There is no route and no UI for this, by design — see
[decisions.md](./decisions.md).

## Health checks

| Endpoint | Meaning | Use it for |
|---|---|---|
| `GET /healthz` | The process is up. Says nothing about dependencies | liveness probe, container `HEALTHCHECK` |
| `GET /readyz` | Postgres and the gateway actually answer | readiness probe, load balancer |

`/readyz` returns `{ status, database, gateway }` and 503s when the database does
not answer. The gateway is **reported but does not fail the check**: the API is
still useful for reading stored conversations and dashboards while Power BI is
unreachable, and taking the instance out of rotation for that would be worse than
serving it.

Both are unauthenticated, both log at `warn` so a probe every few seconds does not
fill the log, and both are excluded from the OpenAPI document.

## Logs and errors

Pino writes JSON to stdout at `info` in production; the platform collects it.
`authorization`, `cookie` and `set-cookie` are redacted.

A 5xx returns `{ message: "Internal server error", requestId }` and nothing else.
The stack, the SQL and Power BI's own wording stay in the log next to that request
id — which is the only thing a client gets to correlate with. 4xx return the
guard's or the schema's own message, because that message is meant to be read.

## Backups and restore

A backup nobody has restored is not a backup. Take one, restore it somewhere else,
and only then call it done.

**Dump** — nightly, from cron on the host:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner \
  > "/backups/powerbia-$(date +%F).dump"
```

`--format=custom` so `pg_restore` can be selective, `--no-owner` so a restore
does not need the same role names. Keep them off the application host, and
encrypt them: the dump contains the AES-256-GCM ciphertext of the Power BI client
secret, the password hashes and every conversation.

**Restore** — the exact command, tested:

```bash
# Into an empty database. --clean --if-exists makes it re-runnable.
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner \
  < /backups/powerbia-2026-09-03.dump
```

`DATASET_SECRET_KEY` must be the same value the dump was taken under. Restore the
data with a rotated key and the stored Power BI secret cannot be decrypted; the
app boots, and every question fails at DAX execution. Back that key up with the
dumps, separately.

Nothing else in the stack holds state. The gateway is stateless, the web
container is static files, and the API keeps sessions in Postgres — so a restore
signs everybody out and nothing more.

## Rollback

```bash
# Application only, no schema change involved.
docker compose -f docker-compose.prod.yml up -d --no-deps api web
```

Migrations are one-directional: there are no down migrations, so rolling back
across one means restoring a dump. That is the reason for the additive rule in
[development.md](./development.md) — add a nullable column, backfill, add the
constraint later, and never `DROP` in the same release that stops writing to a
column. Kept that way, the previous image runs against the new schema and a
rollback is the one command above.

## What is not here yet

Observability beyond structured logs. Add OpenTelemetry when something actually
consumes traces, not before. Tracked in [todo.md](./todo.md).
