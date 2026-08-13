# The LLM pipeline

This is where the product's value lives. The prompts and the card builder are
ports of the MVP's hard-won knowledge; treat them as load-bearing.

## Shape

Seven stages, orchestrated by `apps/api/src/pipeline/run.ts`:

```
routeIntent ─┬─ conversation      → answerConversation (stream)
             ├─ create_filter     → resolveFilterColumn → DISTINCT → filter card
             └─ query / follow_up / rechart_previous
                  └─ decideVisualization
                       ├─ needsClarification → text or choice card, stop
                       └─ generateDax
                            ├─ needs_clarification → text, stop
                            ├─ out_of_range        → text, stop
                            └─ dax → applyFilters → execute
                                        └─ on error: repairDax → execute again
                                             └─ buildCard + answerData (stream)
```

| Stage | File | Model call |
|---|---|---|
| `routeIntent` | `stages.ts` | structured, 5-value enum |
| `decideVisualization` | `stages.ts` | structured, `vizDecisionSchema` |
| `generateDax` | `stages.ts` | structured, flat DAX outcome |
| execute | `dax/executor.ts` | **none — deterministic** |
| `repairDax` | `stages.ts` | structured, one retry only |
| `answerData` / `answerConversation` | `stages.ts` | streamed prose |
| `resolveFilterColumn` | `stages.ts` | structured |

## Why the visualization is decided before the DAX exists

This is the single most important design property, and it is easy to destroy by
"improving" the pipeline into a tool-calling agent.

`decideVisualization` runs on the question and the model schema alone, before any
data. Its output tells `generateDax` the **exact data shape to produce** —
long format with a series column for `multi_line`, two measures on the same row
for `combo`, a `ROW()` scalar for `kpi`. The generator is also told the exact
column aliases to project, so `buildCard` can bind result columns by name
afterwards.

If the model instead chose a chart after seeing arbitrary data, the shapes would
not line up and the charts would be wrong. A free-running agent loop would lose
this. Don't.

There is one genuinely subtle rule in the decider, inherited from the MVP: when
comparing the same period across different years ("precio por mes de 2020 y
2021"), the x-axis must **not** be a column that already contains the year, or
each year lands on different labels and the lines never overlap. The x-axis
becomes the month name and the series column becomes the year.

## Prompts

All prompt text lives in `apps/api/src/pipeline/prompts.ts` and is **in Spanish**,
deliberately — it is tuned against the model and retranslating it would be an
uncontrolled change. Identifiers around it are English.

`buildInstructions()` assembles three layers:

1. **System context** — what the assistant is, which pipeline stage this is, and
   the standing rules (never mention DAX to the user, never invent figures,
   answer in the requested language).
2. **Temporal context** (optional) — today's date plus the dataset's real range,
   and the rule that separates the two kinds of time reference. "El mes pasado" is
   anchored to today and may fall **outside** the data, in which case the correct
   answer is to refuse; "el último mes con datos" is anchored to the dataset's max
   date. Conflating these was a real MVP bug class.
3. **Schema** (optional) — rendered from the `DatasetContext`: tables, columns with
   type, sample value, `[SUMABLE]` marker and curated note; relationships;
   business measures; user synonyms.

The schema section is generated from database rows by `schemaSection()`, but its
**output format matches the MVP's `esquema_para_prompt()` exactly**, because the
prompts are tuned against that layout. If you change the rendering, re-run the
parity harness.

`describeRequiredShape()` renders the decision into the instruction block the
generator receives.

### The DAX rules worth knowing

`GENERATOR_ROLE` encodes rules that were learned by watching Power BI reject
things. The important ones:

- `SUMMARIZECOLUMNS` always needs a grouping column first. For a single scalar,
  use `EVALUATE ROW("alias", CALCULATE(...))` instead.
- Range filters go in a `CALCULATETABLE` wrapper, not a `FILTER` inside
  `SUMMARIZECOLUMNS`.
- `ORDER BY` may only reference columns present in the projection.
- Never order by a surrogate date key in a monthly grouping — there are many
  values per group and Power BI errors. Order by the `YYYY/MM` text column.
- Multi-series output must be long format, one row per (x, series) pair. Never
  pivot series into columns.

## Deterministic helpers — do not "simplify" these away

| Helper | File | Why it exists |
|---|---|---|
| `stripCodeFences` | `dax/sanitize.ts` | Models wrap DAX in ``` fences |
| `patchMeasureOnlySummarize` | `dax/sanitize.ts` | Rewrites `SUMMARIZECOLUMNS("x", expr, FILTER(...))` into `ROW("x", CALCULATE(expr, FILTER(...)))`, saving a repair round trip for a mistake the model makes often |
| `normalizeColumnName` | `dax/columns.ts` | `Calendar[Año#Mes]` → `Año#Mes`; measure aliases arrive bare and must pass through untouched |
| `resolveColumn` | `dax/columns.ts` | Binds a declared alias to a real result column, case- and bracket-insensitively |
| `applyFilters` | `dax/filters.ts` | Wraps generated DAX in `CALCULATETABLE` with the slicer predicates |

### Filters are applied deterministically

The MVP appended the dashboard's slicer state to the prompt as Spanish prose
(`"(filtros activos: Store Name: Smith, Casey)"`) and relied on the model to
translate it into the right `CALCULATETABLE`. It did not always comply, so a
dashboard could silently show unfiltered numbers.

Now `applyFilters` splices the predicates in around the generated query, and the
model is never responsible for honouring filter state. Note that the **repaired**
query is re-wrapped too — the repair stage sees the unfiltered DAX, so the wrapper
never gets mangled by the model.

## The card builder

`apps/api/src/cards/build.ts` is the highest-risk port in the rewrite: ~120 lines
of shape logic that was previously written against pandas. It has **15 tests**
(`build.test.ts`) covering every branch below.

There is no pandas in Node, so `cards/table.ts` provides the small typed helper it
needs — column lookup, dtype inference by inspecting values, distinct labels in
first-seen order, group-by-sum.

### The rule: data shape overrides the model's choice

`buildCard` degrades deterministically rather than rendering something broken:

| Situation | Result |
|---|---|
| One row, no categorical column | `kpi`, whatever was decided |
| `combo` with no distinct second measure | downgrades to `line` |
| `multi_line` with no resolvable series column | downgrades to `line` |
| `grouped_bar` / `stacked_bar` with no series column | downgrades to `bar` |
| Multi-series that resolves to all-zero values | downgrades to single series |
| `line` / `area` with one point | `kpi` |
| `pie` with no positive values | `table` |
| No resolvable numeric measure | `table` |
| No resolvable x-axis | `table` |

Column binding is by declared alias first (`resolveColumn`), then by position as a
fallback, because the model does not always honour the requested alias.

### Data reduction (`cards/reduce.ts`)

Three limits, each with a different rule, each surfacing a `subtitle` notice so
the user knows the chart is truncated:

- **Series capped at 8**, the palette length. The surplus is folded into "Otros"
  by descending total. A ninth colour is never generated.
- **Non-temporal axes** truncated to the top 15 **by value**. A model with ~1,900
  stores otherwise produces a payload the browser cannot draw.
- **Temporal axes** truncated to the **last 120 points**, never by value —
  truncating a time series by magnitude destroys chronological continuity.

The distinction between the last two is the point. Getting it backwards produces a
line chart with holes in it.

## Follow-up context

`conversations/store.ts` `loadHistory()` reads the last few messages back from
Postgres and pairs each user question with the assistant's DAX and result columns.

The MVP kept this in a module-level dict keyed by cookie, so context died on
restart and was wrong with more than one worker. Reading it from the database
fixes both, and is why `messages` stores `dax` and `resultColumns`.
