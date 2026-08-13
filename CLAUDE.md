# Power BIA — Asistente conversacional de Power BI

## Qué es este proyecto

**Power BIA** permite a usuarios no técnicos consultar modelos de datos de Power BI en
**lenguaje natural**. El usuario pregunta ("¿Cuáles fueron las ventas en 2020?"), el sistema
genera DAX, lo ejecuta contra Power BI y devuelve la respuesta en prosa más una visualización
interactiva que puede fijarse a un dashboard.

El MVP original (Python + FastAPI + un `index.html` de 3.942 líneas) vive en `legacy/` y sigue
siendo ejecutable — se conserva para capturar fixtures de paridad hasta que se complete la
migración.

---

## Estado de la migración

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Monorepo, flake devshell, docker-compose, CI | ✅ |
| 1 | `packages/contracts` — esquemas Zod compartidos | ✅ |
| 2 | `packages/db` — Drizzle, migración aplicada (13 tablas) | ✅ |
| 3 | `services/dax-gateway` — .NET 10 sobre ADOMD.NET | ✅ compila |
| 4 | `apps/api` — Fastify, auth, pipeline LLM, cards | ✅ arranca y sirve |
| 5 | `apps/web` — React + Tailwind + DaisyUI + TanStack | ⬜ pendiente |
| 6 | Harness de paridad y hardening | ⬜ pendiente |

**Documentación completa en [`docs/`](./docs/README.md)** — arquitectura, pipeline,
modelo de datos, API, frontend, decisiones y, sobre todo,
[`docs/todo.md`](./docs/todo.md) con lo que queda pendiente.

Plan original: `~/.config/claude/plans/functional-snuggling-micali.md`

---

## Stack

- **Monorepo:** pnpm workspaces + Turborepo. Versiones centralizadas en el `catalog:` de
  `pnpm-workspace.yaml` — no pongas rangos en los `package.json`.
- **Toolchain:** `nix develop` (node 24, pnpm 11, dotnet 10, psql 17). No hay node ni dotnet
  fuera del devshell.
- **Backend:** Fastify 5 + AI SDK 7 + Drizzle + Postgres 17
- **Gateway DAX:** .NET 10 minimal API sobre ADOMD.NET (XMLA)
- **Frontend:** React 19 + Tailwind 4 + DaisyUI 5 + TanStack Router/Query + Recharts
- **Lint/format:** Biome. **Tests:** Vitest.

### AI SDK 7 — diferencias que importan

Es ESM-only y requiere Node 22+. Respecto a v5:

- `system` → **`instructions`**
- No existe `generateObject`: usa `generateText({ output: Output.object({ schema }) })` y lee
  `.output`
- Los helpers de streaming son funciones sueltas de `'ai'`, no métodos del resultado:
  `createUIMessageStream`, `toUIMessageStream`, `pipeUIMessageStreamToResponse`
- `onFinish` → `onEnd`, `fullStream` → `stream`
- El structured output estricto de OpenAI no admite `anyOf` en la raíz: los esquemas de salida
  son objetos planos que luego se mapean a la unión discriminada del dominio

---

## Estructura

```
apps/api/src/
├─ app.ts                 Fastify: plugins, hook de sesión, registro de rutas
├─ env.ts                 Env validado con Zod (falla al arrancar si falta algo)
├─ auth/                  scrypt + sesiones opacas en Postgres
├─ cards/                 build.ts (el port de construir_card) + table.ts + reduce.ts
├─ dax/                   columns · sanitize · filters · executor
├─ datasets/context.ts    DatasetContext desde la BD + resolución de etiquetas
├─ pipeline/              prompts.ts (español, afinados) · stages.ts · run.ts
└─ routes/                auth · chat · conversations · dashboards · datasets

packages/contracts/src/   cards · viz · chat · dashboard · dataset · auth
packages/db/src/          schema.ts · client.ts · crypto.ts
services/dax-gateway/     Program.cs (dos endpoints: /health, /query)
legacy/                   MVP Python original, aún ejecutable
```

---

## Convenciones

- **Identificadores en inglés**, prosa de producto en español/inglés vía i18n.
- **Los system prompts se quedan en español**: están afinados contra el modelo y no se
  retraducen. Viven solo en `apps/api/src/pipeline/prompts.ts`.
- `packages/contracts` es la única fuente de verdad de las formas de datos. Si una forma
  cruza el límite HTTP, se define ahí y ambos lados la importan.
- Los comentarios explican el **por qué**, no el qué. El código se explica solo.
- Las apps (`apps/*`) no emiten `.d.ts`; solo los `packages/*` son consumibles.

## Decisiones no obvias

- **scrypt en vez de argon2**: argon2 es un módulo nativo y en NixOS eso da problemas. scrypt
  va en Node y OWASP lo acepta como alternativa. Los parámetros de coste se guardan junto al
  hash para poder subirlos sin invalidar contraseñas.
- **El gateway no guarda credenciales**: las recibe por petición. La BD sigue siendo el único
  sitio donde viven los secretos (cifrados con AES-256-GCM).
- **El gateway solo tiene `/query`**: la introspección del modelo usa funciones `INFO.*`, que
  son DAX, así que no hace falta un endpoint aparte.
- **Los filtros del dashboard se aplican de forma determinista** envolviendo el DAX en
  `CALCULATETABLE` (`dax/filters.ts`). El MVP los inyectaba como prosa en el prompt.
- **La decisión de visualización se toma ANTES de generar el DAX**. Es lo que permite decirle
  al generador la forma exacta de datos que debe producir, y es la razón de que los gráficos
  salgan bien. No lo convertías en un agente con tools sin perder esto.
- **El contexto de seguimiento se lee de la tabla `messages`**, no de memoria del proceso.

---

## Comandos

```bash
nix develop                      # entra al devshell
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev                         # api + web
pnpm typecheck && pnpm test && pnpm lint
```

`.env` se genera a partir de `.env.example`. Requiere `OPENAI_API_KEY` y las credenciales
`PBI_*` del service principal para que el pipeline funcione de verdad.
