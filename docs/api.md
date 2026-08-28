| POST | `/` | `{ name, datasetId }` |
| PATCH | `/:id` | `{ name }` — renames it by hand |
| POST | `/:id/name` | `{ locale }` — regenerates the name from the widgets it holds. A view with none keeps its current name |
| GET | `/` | Summaries with widget counts and `createdAt` || GET | `/:id` | With all messages, oldest first. 404 if not owned |
| PATCH | `/:id` | `{ title }` — renames it by hand |
| POST | `/:id/title` | `{ locale }` — regenerates the title from the thread. 502 if the model call fails |
| DELETE | `/:id` | Cascades to messages |

A conversation is inserted with its first message as a placeholder title, and the
real one is generated from the first exchange before the answer stream closes —
so the sidebar shows it on the refetch the client already fires on finish. If that
call fails the placeholder stands; the answer is never at risk. `POST /:id/title`
is the same generation on demand, for a thread that has moved on from what it
started as.
# HTTP API

Fastify with `fastify-type-provider-zod`. Every body, param and response is
validated against a schema from `packages/contracts`, so a validation failure
returns a 400 naming the offending field rather than a 500 later.

All routes except `/health` and `/api/auth/*` require a session.

## Endpoints

### Auth — `/api/auth`

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/register` | `registerSchema` | Password min 12 chars. Sets the session cookie. 409 if the email exists |
| POST | `/login` | `loginSchema` | Sets the session cookie. 401 on bad credentials |
| POST | `/logout` | — | Deletes the session row and clears the cookie |
| GET | `/me` | — | The current user. 401 without a valid cookie |

Responses never include `password_hash` — they are parsed through `userSchema`
first.

### Datasets — `/api/datasets`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Summaries: name, description, date range, table and measure counts |
| GET | `/:id/context` | The full `DatasetContext` — the same structure the prompts consume |
| DELETE | `/:id` | Admin only (403 otherwise) |

There is **no** `POST /api/datasets`. Datasets are created by the seed script
only. See [todo.md](./todo.md).

### Chat — `/api`

| Method | Path | Notes |
|---|---|---|
| POST | `/chat` | **Streams.** See below |
| POST | `/query` | Non-streaming `{ text, card, dax }`. Used by widget refresh and inline widget editing |

Both take `datasetId`, `text`, `locale`, `filters`, `forcedChartType`; `/chat` also
takes `conversationId`.

`forcedChartType` lets a widget re-run its question and keep its chart type, which
is how refresh preserves the shape the user chose.

### Conversations — `/api/conversations`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | The current user's conversations, newest first |
| GET | `/:id` | With all messages, oldest first. 404 if not owned |
| PATCH | `/:id` | `{ title }` — renames it by hand |
| POST | `/:id/title` | `{ locale }` — regenerates the title from the thread. 502 if the model call fails |
| DELETE | `/:id` | Cascades to messages |

A conversation is inserted with its first message as a **placeholder** title, and
the real one is generated from the first exchange before the answer stream closes
— which is what makes the sidebar show it on the refetch the client already fires
on finish. If that call fails the placeholder stands: titling never takes the
answer down with it. `POST /:id/title` is the same generation on demand, for a
thread that has moved on from what it started as.

### Dashboards — `/api/dashboards`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | Summaries with widget counts and `createdAt` |
| GET | `/:id` | With widgets. 404 if not owned |
| POST | `/` | `{ name, datasetId }` |
| PATCH | `/:id` | `{ name }` — renames it by hand |
| POST | `/:id/name` | `{ locale }` — regenerates the name from the widgets it holds; a view with none keeps its current name |
| DELETE | `/:id` | Cascades to widgets |
| POST | `/:id/widgets` | `{ card, query, dax, layout }` — the card is validated against the union |
| PATCH | `/:id/widgets/:widgetId` | Partial: `card`, `query`, `dax`, `pinned`, `layout` |
| DELETE | `/:id/widgets/:widgetId` | |
| PUT | `/:id/layouts` | Batch `[{ id, x, y, width, height }]` in one transaction |

`PUT /:id/layouts` exists because the MVP fired a full dashboard save on every
mouse-up during a drag. One request per gesture, one transaction.

Ownership is enforced by `ownedDashboard()` before any widget mutation, so widget
IDs cannot be used to reach into another user's dashboard.

## The streaming chat contract

`POST /api/chat` returns an AI SDK UI message stream (SSE), not JSON. The route
hijacks the Fastify reply and pipes the stream to the raw response.

Two typed data parts travel alongside the prose:

| Part | Persistence | Payload |
|---|---|---|
| `data-conversation` | transient | `{ conversationId }` — so the client can adopt a newly created conversation |
| `data-card` | persistent, id `card` | `{ card, dax, followUps }` |

Transient parts reach the client only through `useChat`'s `onData` callback; they
are not added to message history. Persistent parts appear in `message.parts` and
survive a reload, which is why the card is persistent and the conversation id is
not.

Server side (`routes/chat.ts`):

```ts
const stream = createUIMessageStream<ChatUIMessage>({
  execute: async ({ writer }) => {
    writer.write({ type: 'data-conversation', data: { conversationId }, transient: true });
    writer.write({ type: 'data-card', id: 'card', data: { card, dax, followUps: [] } });
    if (outcome.stream) writer.merge(toUIMessageStream({ stream: outcome.stream.stream }));

    const answer = outcome.text ?? (await readStreamText(outcome.stream));
    await appendMessage({ ...answer, card, dax });
  },
});

reply.hijack();
await pipeUIMessageStreamToResponse({ response: reply.raw, stream });
```

The assistant message is persisted **inside `execute`, before the stream closes**.
`createUIMessageStream` holds the stream open until an async `execute` settles, so
the conversation is readable from the database the instant the client sees the
stream end. Persisting after `pipeUIMessageStreamToResponse` instead — as this did
originally — raced the refetch the client fires on finish, which could cache a
conversation whose answer had not landed yet.

The await does not stall the prose: `merge` is already draining the model stream
into the response, and `readStreamText()` reads its own tee. `readStreamText()`
swallows errors so a client disconnecting mid-answer does not lose the persisted
message.

### Client side

The AI SDK transport wants to POST a message array. The API takes a single
question. `prepareSendMessagesRequest` bridges them in
`apps/web/src/components/chat/ChatPanel.tsx` — it pulls the text off the last
message and merges it into the body. Persisted history is converted back into the
same part shapes by `toUIMessages`, so the live stream and a reloaded conversation
render through identical code.

## AI SDK 7 notes

The version matters; v7 moved things.

- `system` → **`instructions`**
- `generateObject` **does not exist** — use `generateText({ output: Output.object({ schema }) })` and read `.output`
- Stream helpers are standalone functions exported from `ai`, not methods on the
  result: `createUIMessageStream`, `toUIMessageStream`,
  `pipeUIMessageStreamToResponse`
- `onFinish` → `onEnd`, `fullStream` → `stream`
- ESM-only, Node 22+

**OpenAI strict structured output does not allow `anyOf` at the schema root.** The
DAX outcome is therefore a flat object on the wire (`daxOutputSchema` in
`stages.ts`) that is mapped to the discriminated union `DaxGeneration` immediately
after. Keep that separation if you add other union-shaped outputs.

## Errors

`errorSchema` (`{ message }`) is registered as the 404 response on routes that can
miss. This is not decoration: with `fastify-type-provider-zod`, a response map
containing only `200` makes `reply.code(404).send({ message })` a **type error**,
because `send` is typed to the 200 schema.
