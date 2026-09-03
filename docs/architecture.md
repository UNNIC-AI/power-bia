# Architecture

## Four deployables

```
┌──────────────┐   /api proxy    ┌──────────────┐   bearer    ┌──────────────┐
│  apps/web    │ ──────────────▶ │  apps/api    │ ──────────▶ │ dax-gateway  │
│ React + Vite │   session       │  Fastify     │   HTTP      │  .NET 10     │
└──────────────┘   cookie        └──────┬───────┘             └──────┬───────┘
                                        │                            │ XMLA
                                   ┌────▼─────┐                ┌─────▼──────┐
                                   │ Postgres │                │ Power BI   │
                                   └──────────┘                └────────────┘
                                        ▲
                                   ┌────┴──────────────┐
                                   │ OpenAI (AI SDK 7) │
                                   └───────────────────┘
```

`packages/contracts` and `packages/db` are libraries, not deployables. Contracts
is imported by **both** apps; that is the point of it.

## Repository layout

```
apps/
  api/          Fastify: auth, pipeline, cards, routes
  web/          React: routes, card renderers, dashboard canvas
packages/
  contracts/    Zod schemas + inferred types — the shared vocabulary
  db/           Drizzle schema, migrations, seed, secret encryption
services/
  dax-gateway/  .NET minimal API wrapping ADOMD.NET
legacy/         The Python MVP, still runnable
docs/           This directory
```

## Why the pieces are split this way

**`packages/contracts` is the keystone.** Every card shape, the visualization
decision, and every request/response body is defined once in Zod. Fastify
validates against it via `fastify-type-provider-zod`; the React client infers its
types from the same source. The MVP passed cards as untyped JSON and dispatched on
`card.kind` with a string switch that silently rendered nothing for an unknown
kind — that class of bug is now a compile error.

**The gateway is a separate service because ADOMD.NET is .NET-only.** There is no
usable Node client for the XMLA endpoint. The MVP shelled out to a .NET console
binary once per query, paying process startup and a hard 60-second wall each time.
Promoting it to a long-lived HTTP service removes both.

**The gateway is stateless.** It receives the Power BI credentials with each
request rather than holding a registry. That keeps Postgres as the single place
secrets live, and means the gateway needs no database access, no migrations and no
deploy coupling. In production it is not port-published — only the API reaches it,
over the internal network, with a shared bearer token. The development compose
file does publish it, because the normal shape there is an API running on the
host; `docker-compose.prod.yml` takes the port back out.

**The gateway has one query endpoint, not two.** Model introspection uses DAX
`INFO.*` functions, which go through the same `/query` path. A separate
`/metadata` endpoint would have been redundant.

## Request flow: a question

1. **`apps/web`** — `useChat` posts to `/api/chat`. The AI SDK's transport wants
   to send a message array; `prepareSendMessagesRequest` reshapes the body into
   the API's `{ conversationId, text, locale, filters, forcedChartType }`
   contract.
2. **`routes/chat.ts`** — resolves the session, loads the `DatasetContext` and the
   decrypted connection, finds or creates the conversation, reads the last few
   messages as follow-up context, persists the user message.
3. **`pipeline/run.ts`** — routes the intent, decides the visualization, generates
   DAX, executes it, repairs once on failure, builds the card. See
   [pipeline.md](./pipeline.md).
4. **`routes/chat.ts`** — opens a `createUIMessageStream`, writes the card as a
   typed `data-card` part, merges the prose stream, and pipes the whole thing to
   the raw response with `pipeUIMessageStreamToResponse`. After the stream
   finishes it persists the assistant message with its card, DAX and decision.
5. **`apps/web`** — renders prose from text parts and the chart from the
   `data-card` part, through the exhaustive switch in `CardView`.

The MVP blocked until the entire chain finished, which for route → decide →
generate → execute → repair → answer meant several seconds of nothing.

## Request flow: a dashboard widget refresh

Widget refresh, inline query editing and slicer changes all go to `POST /api/query`
instead — the same pipeline, but returning a single JSON `{ text, card, dax }`
rather than a stream, because there is no prose to stream into a widget.

## Session and identity

Opaque 32-byte tokens, SHA-256 hashed in `sessions`, carried in an httpOnly
`SameSite=Strict` cookie. An `onRequest` hook resolves `request.user` on every
request; `requireUser()` throws a 401. Passwords use Node's built-in scrypt.

CSRF is covered by the `SameSite=Strict` cookie plus an origin check on
`POST`/`PUT`/`PATCH`/`DELETE`, rather than a double-submit token. See
[decisions.md](./decisions.md).

Everything user-owned — conversations, dashboards — is scoped by `userId` in the
query, not filtered after the fact. The MVP had a single hardcoded
`_SHARED_WORKSPACE` string and no users at all, so anyone could read or delete
anyone's work.

## Configuration

`apps/api/src/env.ts` validates the environment with Zod at import time, so a
missing or malformed variable fails at boot with a precise message rather than at
first use. `DATASET_SECRET_KEY` must be exactly 64 hex characters; the schema
enforces it.
