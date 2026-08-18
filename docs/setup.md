# What is needed to make it actually work

The app runs today in demo mode with fake credentials (see
[README.md](./README.md)). This is the checklist for making the real pipeline
work — a question in, DAX executed against Power BI, an answer out.

Three groups: **environment variables**, **the Azure / Power BI side**, and
**two code gaps** that block the happy path regardless of credentials.

---

## 1. Environment variables

`apps/api/src/env.ts` validates these with Zod at import time, so the API refuses
to boot with a precise message rather than failing at first use.

### Required — the API will not start without these

| Variable | Constraint | Where to get it |
|---|---|---|
| `DATABASE_URL` | non-empty | `postgres://powerbia:powerbia@localhost:5432/powerbia` for the compose database |
| `OPENAI_API_KEY` | non-empty | platform.openai.com → API keys |
| `DAX_GATEWAY_URL` | valid URL | `http://dax-gateway:8080` inside compose, `http://localhost:8080` if you publish the port |
| `DAX_GATEWAY_TOKEN` | non-empty | `openssl rand -hex 32` — the same value must reach the gateway container |
| `DATASET_SECRET_KEY` | **exactly 64 hex chars** | `openssl rand -hex 32`. AES-256-GCM key for dataset secrets |
| `SESSION_COOKIE_SECRET` | ≥ 32 chars | `openssl rand -hex 32` |

`DATASET_SECRET_KEY` is not rotatable in place — changing it makes every stored
dataset secret undecryptable. Re-seed or re-encrypt if you change it.

### Optional — sensible defaults

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` turns on the `secure` cookie flag, which then **requires HTTPS** |
| `PORT` | `3000` | |
| `WEB_ORIGIN` | `http://localhost:5173` | Must be a valid URL. Used for CORS **and** the origin check on mutations, so a wrong value blocks all writes |
| `LLM_MODEL` | `gpt-4.1` | Must be a model that supports strict structured outputs |

### Compose-only

| Variable | Default | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | `powerbia` | Must agree with `DATABASE_URL` |

### The `PBI_*` variables are different — read this

| Variable | Example |
|---|---|
| `PBI_TENANT_ID` | Entra tenant GUID |
| `PBI_CLIENT_ID` | App registration (client) GUID |
| `PBI_CLIENT_SECRET` | App registration client secret **value** |
| `PBI_WORKSPACE_NAME` | The workspace name exactly as it appears in Power BI |
| `PBI_DATASET_NAME` | The semantic model name exactly as it appears |

**These are not runtime API configuration.** They are read *once*, by
`packages/db/src/seed.ts`, and written into the `datasets` row (with the secret
encrypted). The API afterwards reads the connection from the database, never from
the environment.

Consequences:

- Editing `PBI_*` after seeding changes nothing. Re-run the seed on an empty
  database, or `UPDATE datasets SET ...` directly.
- Because there is no `POST /api/datasets` endpoint yet (see §3), the seed is
  currently the only supported way to register a connection.
- Quote any value containing a space (`PBI_WORKSPACE_NAME="Demo Workspace"`), or
  `set -a; . ./.env` breaks.

---

## 2. The Azure / Power BI side

None of this is an environment variable, and all of it is required. This is the
part most likely to be the actual blocker.

### 2.1 Entra ID app registration

Creates the service principal and yields `PBI_TENANT_ID`, `PBI_CLIENT_ID` and
`PBI_CLIENT_SECRET`.

- Azure portal → Entra ID → App registrations → New registration.
- Certificates & secrets → New client secret. **Copy the value immediately**;
  it is not shown again. Note the expiry — an expired secret fails as an auth
  error, not as an obvious "expired" message.
- No Power BI API delegated permissions are needed for the XMLA path; access is
  granted through the workspace, not through API scopes.

### 2.2 Tenant setting: service principals may use Power BI APIs

Power BI admin portal → Tenant settings → Developer settings → **"Allow service
principals to use Power BI APIs"** → Enabled, normally scoped to a specific
security group. **The app registration must be a member of that group.**

Requires a Fabric/Power BI administrator. This is frequently the step that needs
someone else, so start it early.

### 2.3 Capacity with an XMLA read endpoint

ADOMD.NET connects over XMLA, which is **not available on shared capacity**. The
workspace must be on:

- Power BI Premium (P / EM SKU), or
- Premium Per User (PPU), or
- Fabric capacity (F SKU).

Then, in the capacity settings, set **XMLA Endpoint** to `Read` (or
`Read Write`). Also check the tenant setting **"Allow XMLA endpoints and Analyze
in Excel with on-premises datasets"**.

If the gateway cannot connect, verify the capacity and this endpoint setting
before debugging any code.

### 2.4 Workspace access for the service principal

Add the service principal to the workspace. **Member** or **Contributor** is the
reliable choice. (Viewer plus Build permission on the dataset can be enough for
read-only XMLA, but Member avoids a class of permission puzzles.)

### 2.5 OpenAI

- A key with access to `LLM_MODEL` and quota to spare — one question costs
  4–6 model calls (route, decide, generate, maybe repair, answer).
- The model must support **strict structured outputs**; the pipeline depends on
  them for the routing, decision and DAX stages.

### 2.6 Network egress

The gateway needs to reach `login.microsoftonline.com` and
`*.powerbi.com` (XMLA, port 443). The API needs to reach `api.openai.com`.

---

## 3. Code gaps that block the happy path

Credentials alone are not sufficient. Two things are missing.

### 3.1 The gateway is not reachable from the host

`docker-compose.yml` declares `expose: 8080` for `dax-gateway`, deliberately —
only the API should reach it. But **there is no Dockerfile for `apps/api`**, so
the API cannot currently run inside compose either.

Until an API image exists, publish the port for local work:

```yaml
# docker-compose.yml, dax-gateway service
ports:
  - "8080:8080"
```

and set `DAX_GATEWAY_URL=http://localhost:8080`.

Also note the gateway container image has **never been built** —
`dotnet build` passes, but `docker compose build dax-gateway` is unverified.

### 3.2 There is no way to add a dataset through the app

`GET /api/datasets`, `GET /api/datasets/:id/context` and `DELETE /api/datasets/:id`
exist. `POST` does not. The seed is the only path, and it hardcodes the Iowa
model. See [todo.md](./todo.md) P1 #4 and #5.

---

## 4. Order to do this in

1. Get §2.2 (tenant setting) and §2.3 (capacity + XMLA read) moving — they may
   need an administrator and are the long lead time.
2. Create the app registration (§2.1) and add it to the workspace (§2.4).
3. Fill `.env`: the generated secrets, `OPENAI_API_KEY`, and the `PBI_*` values.
4. Publish the gateway port (§3.1) and set `DAX_GATEWAY_URL` accordingly.
5. `docker compose up -d postgres dax-gateway && pnpm db:migrate && pnpm db:seed`
6. Smoke-test the gateway on its own before involving the LLM:

   ```bash
   curl -s localhost:8080/health

   curl -s localhost:8080/query \
     -H "authorization: Bearer $DAX_GATEWAY_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"connection":{"tenantId":"…","clientId":"…","clientSecret":"…",
          "workspaceName":"…","datasetName":"…"},
          "dax":"EVALUATE ROW(\"ok\", 1)"}'
   ```

   `EVALUATE ROW("ok", 1)` needs no tables, so it isolates authentication and
   connectivity from anything about the model. Then try
   `EVALUATE INFO.TABLES()` to confirm the introspection functions work on your
   capacity.
7. Only then ask a question in the UI.

Expect to iterate on the prompts once real DAX starts flowing — nothing in the
pipeline has ever run against live Power BI. [todo.md](./todo.md) P0 covers what
to watch for.
