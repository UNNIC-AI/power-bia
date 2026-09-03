# Setup

What is needed to make the real pipeline work — a question in, DAX executed
against Power BI, an answer out.

The app already runs **without** any of this in demo mode
(`pnpm --filter @powerbia/api demo`, see [../README.md](../README.md)).
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

### `PBI_*` — the only place the Power BI model is chosen

| Variable | Value |
|---|---|
| `PBI_TENANT_ID` | Entra tenant GUID |
| `PBI_CLIENT_ID` | App registration (client) GUID |
| `PBI_CLIENT_SECRET` | Client secret **value** |
| `PBI_WORKSPACE_NAME` | Workspace name, exactly as shown in Power BI |
| `PBI_DATASET_NAME` | Semantic model name, exactly as shown |
| `PBI_MODEL_NAME` | Optional display name for the UI. Defaults to `PBI_DATASET_NAME` |

The API reads all five on every boot and writes them into the `datasets` row, with
the secret encrypted (`provisionDatasetFromEnv`, `apps/api/src/datasets/provision.ts`).
Nothing in the UI can change them.

- **To point the app at a different model: edit these and restart.** The row is
  reused, so conversations and dashboards survive. Because the catalogue then
  describes a model nobody is querying any more, it is dropped along with the
  generated context, and the new model is introspected during that same boot.
- The five are a unit. With any of them missing the API still boots and serves
  whatever the database holds — that is what demo mode relies on — and logs a
  warning.
- Quote values containing spaces (`PBI_WORKSPACE_NAME="My Workspace"`) or
  `set -a; . ./.env` breaks.
- `MODEL_CONTEXT_LOCALE` (`es` by default) is the language the assistant writes
  the model's context in when it does so at boot, with no user to ask.

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

## 4. Two things about the local setup

### 4.1 The gateway port

`docker-compose.yml` publishes 8080, because the normal development shape is the
API running on the host and needing to reach the gateway:

```bash
docker compose --profile gateway up -d
```

**In a deployment it is not published.** The gateway holds the service principal
credentials and only `apps/api` has any business reaching it, so
`docker-compose.prod.yml` uses `expose` instead of `ports`. See
[deployment.md](./deployment.md).

The container image builds and serves live DAX. It needed
`services/dax-gateway/.dockerignore`: the host `obj/` was being copied over the
container's restore output by `COPY . .`, and the ADOMD package then failed with
`NETSDK1064: package … was not found`.

### 4.2 There is no way to register a model through the app, on purpose

There is one Power BI model and the `PBI_*` block above is the only place it is
named. The API writes those values into the `datasets` row on every boot
(`datasets/provision.ts`), so there is no create, list or delete route, no id in
any `/api/dataset` path, and no picker in the UI.

Switching models is: edit `.env`, restart. The row is reused, so conversations and
dashboards survive; if the workspace or dataset name changed, the previous model's
catalogue and generated context are dropped and the new one is introspected in
that same start.

## 5. Order to do it in

1. Start §3.2 (tenant setting) and §3.3 (capacity + XMLA) — they may need an
   administrator and have the longest lead time.
2. Create the app registration (§3.1) and add it to the workspace (§3.4).
3. Fill `.env` with the generated secrets, `OPENAI_API_KEY` and the `PBI_*` values.
4. Point `DAX_GATEWAY_URL` at `http://localhost:8080` (§4.1).
5. Bring it up — `./start.sh live --smoke` does 5 and 6 in one go, or by hand:

   ```bash
   docker compose --profile db --profile gateway up -d
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

Expect to iterate on the prompts once real DAX starts flowing. Four questions
have been answered end to end (see [README.md](./README.md)), which is a smoke
test, not coverage — [todo.md](./todo.md) P0 covers what to watch for.
