# Setup

What is needed to make the real pipeline work — a question in, DAX executed
against Power BI, an answer out.

The app already runs **without** any of this in demo mode
(`pnpm --filter @powerbia/api demo`, see [docs/README.md](./docs/README.md)).
Everything below is only for the live path.

---

## 1. Secrets you generate

```bash
openssl rand -hex 32   # DAX_GATEWAY_TOKEN
openssl rand -hex 32   # DATASET_SECRET_KEY       ← must be exactly 64 hex chars
openssl rand -hex 32   # SESSION_COOKIE_SECRET
```

`DATASET_SECRET_KEY` is **not rotatable in place** — changing it makes every
stored dataset secret undecryptable.

## 2. Environment variables

`apps/api/src/env.ts` validates these at import time, so the API refuses to boot
with a precise message rather than failing later.

### Required

| Variable | Constraint | Value |
|---|---|---|
| `DATABASE_URL` | non-empty | `postgres://powerbia:powerbia@localhost:5432/powerbia` |
| `OPENAI_API_KEY` | non-empty | platform.openai.com |
| `DAX_GATEWAY_URL` | valid URL | `http://localhost:8080` (see §4.1) |
| `DAX_GATEWAY_TOKEN` | non-empty | generated above; the gateway container needs the same value |
| `DATASET_SECRET_KEY` | exactly 64 hex chars | generated above |
| `SESSION_COOKIE_SECRET` | ≥ 32 chars | generated above |

### Optional

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` sets the `secure` cookie flag, which then **requires HTTPS** |
| `PORT` | `3000` | |
| `WEB_ORIGIN` | `http://localhost:5173` | Drives CORS **and** the origin check on mutations — a wrong value blocks all writes |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint — Azure OpenAI, OpenRouter, vLLM, Ollama |
| `LLM_MODEL` | `gpt-4.1` | Must support strict structured outputs |
| `POSTGRES_PASSWORD` | `powerbia` | Compose only; must agree with `DATABASE_URL` |

### `PBI_*` behaves differently — read this

| Variable | Value |
|---|---|
| `PBI_TENANT_ID` | Entra tenant GUID |
| `PBI_CLIENT_ID` | App registration (client) GUID |
| `PBI_CLIENT_SECRET` | Client secret **value** |
| `PBI_WORKSPACE_NAME` | Workspace name, exactly as shown in Power BI |
| `PBI_DATASET_NAME` | Semantic model name, exactly as shown |

These are **not runtime API config**. They are read once by
`packages/db/src/seed.ts` and written into the `datasets` row with the secret
encrypted; the API then reads the connection from the database.

- Editing them after seeding does nothing. Re-seed on an empty database, or
  `UPDATE datasets SET …`.
- Quote values containing spaces (`PBI_WORKSPACE_NAME="My Workspace"`) or
  `set -a; . ./.env` breaks.

## 3. The Azure / Power BI side

Not environment variables, all required, and **the most likely blocker**.

1. **Entra ID app registration** — Azure portal → Entra ID → App registrations.
   Add a client secret and copy the value immediately; it is shown once. Note the
   expiry: an expired secret surfaces as a generic auth failure. No Power BI API
   permissions are needed — access comes from the workspace.

2. **Tenant setting: "Allow service principals to use Power BI APIs"** — Power BI
   admin portal → Tenant settings → Developer settings. Usually scoped to a
   security group, and the app registration must be a **member of that group**.
   Needs a Fabric/Power BI administrator, so **start this first**.

3. **A capacity with an XMLA read endpoint** — ADOMD connects over XMLA, which
   does not exist on shared capacity. The workspace must be on Premium (P/EM),
   Premium Per User, or Fabric (F). Set **XMLA Endpoint** to `Read` in capacity
   settings, and check the tenant setting *"Allow XMLA endpoints and Analyze in
   Excel with on-premises datasets"*.

4. **Workspace access** — add the service principal as **Member** or
   **Contributor**. (Viewer + Build on the dataset can suffice for read-only
   XMLA, but Member avoids a class of permission puzzles.)

5. **OpenAI** — quota for 4–6 model calls per question, on a model with strict
   structured output support.

6. **Egress** — the gateway needs `login.microsoftonline.com` and `*.powerbi.com`
   on 443; the API needs `api.openai.com`.

## 4. Two code gaps that block this regardless of credentials

### 4.1 The gateway is not reachable from the host

`docker-compose.yml` only `expose`s port 8080, deliberately — just the API should
reach it. But **`apps/api` has no Dockerfile**, so the API cannot run inside
compose either. Until an API image exists, publish the port:

```yaml
# docker-compose.yml → dax-gateway
ports:
  - "8080:8080"
```

The gateway container image has also **never been built**: `dotnet build` passes,
but `docker compose build dax-gateway` is unverified.

### 4.2 No way to register a dataset through the app

`GET /api/datasets`, `GET /api/datasets/:id/context` and `DELETE` exist; `POST`
does not. The seed script is the only path and it hardcodes the Iowa model.
See [docs/todo.md](./docs/todo.md) P1 #4 and #5.

## 5. Order to do it in

1. Start §3.2 (tenant setting) and §3.3 (capacity + XMLA) — they may need an
   administrator and have the longest lead time.
2. Create the app registration (§3.1) and add it to the workspace (§3.4).
3. Fill `.env` with the generated secrets, `OPENAI_API_KEY` and the `PBI_*` values.
4. Publish the gateway port (§4.1) and point `DAX_GATEWAY_URL` at it.
5. Bring it up:

   ```bash
   docker compose up -d postgres dax-gateway
   pnpm db:migrate
   pnpm db:seed
   ```

6. **Test the gateway alone before involving the LLM:**

   ```bash
   curl -s localhost:8080/health

   curl -s localhost:8080/query \
     -H "authorization: Bearer $DAX_GATEWAY_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"connection":{"tenantId":"…","clientId":"…","clientSecret":"…",
          "workspaceName":"…","datasetName":"…"},
          "dax":"EVALUATE ROW(\"ok\", 1)"}'
   ```

   `EVALUATE ROW("ok", 1)` touches no tables, so it isolates authentication and
   connectivity from anything about the model. Follow with
   `EVALUATE INFO.TABLES()` to confirm the introspection functions work on your
   capacity.

7. Only then ask a question in the UI.

Expect to iterate on the prompts once real DAX starts flowing — **no question has
ever been answered end to end**. [docs/todo.md](./docs/todo.md) P0 covers what to
watch for.
