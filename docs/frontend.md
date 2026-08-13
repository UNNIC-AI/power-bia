# Frontend

React 19 + Vite 8 + Tailwind 4 + DaisyUI 5 + TanStack Router/Query + Recharts 3.

## Routes

File-based, generated into `routeTree.gen.ts` by `@tanstack/router-plugin/vite`.
The generated file is gitignored from lint and regenerates on dev/build — don't
edit it.

```
__root.tsx              Outlet + 404
login.tsx               Sign in / register (one form, toggled)
_authed.tsx             Auth guard + app shell (nav, dataset strip, theme, locale, logout)
_authed/index.tsx       redirect → /chat
_authed/chat.tsx        Conversation sidebar + ChatPanel
_authed/dashboards.tsx  Dashboard sidebar + DashboardCanvas
```

Selection lives in **typed search params** rather than path params: `/chat?c=<id>`
and `/dashboards?d=<id>`. Fewer route files, still deep-linkable. Note that
`validateSearch` declaring `c: string | undefined` means every `Link` and
`navigate` must pass the key explicitly — `search={{ c: undefined }}`, not
`search={{}}`, which is a type error.

`ChatPanel` is keyed on the conversation id so switching conversations remounts it
and replays that conversation's history as the initial messages.

## State

TanStack Query owns all server state; hooks are centralised in `lib/queries.ts`
with a `keys` object so invalidation is not stringly-typed. `lib/api.ts` is a thin
typed fetch wrapper that throws `ApiError` with the server's message.

No global client state library. Theme is a small context (`lib/theme-context.tsx`),
locale is i18next, everything else is server state or local component state.

## Card renderers

```
components/cards/CardView.tsx    Dispatcher (exhaustive switch) + kpi/choice/note + CardPanel
components/cards/TableCard.tsx   Client-paginated, 25 rows/page
components/cards/FilterCard.tsx  Slicer: search, multi-select, clear
components/charts/SeriesChart.tsx  bar · line · area · multi_line · grouped_bar · stacked_bar
components/charts/PieChart.tsx     Donut with % labels
components/charts/ComboChart.tsx   Two stacked panels (see below)
components/charts/primitives.tsx   Shared axes, tooltip, legend, series→rows transform
components/charts/palette.ts       The validated categorical palette
```

The switch in `CardView` is exhaustive over the discriminated union from
contracts. **Adding a card kind to contracts makes this file a compile error**,
which is the intended behaviour — the MVP's string switch silently rendered an
empty div.

`CardPanel` wraps a card with its title, the truncation notice (`subtitle`) and an
optional actions slot, used for the pin button in chat.

## Chart rules

These follow the data-viz guidance and were validated, not guessed.

**The palette is fixed and validated.** Eight categorical hues, each mode stepped
for its own surface rather than flipped. Run against the actual DaisyUI surfaces,
both modes pass all six checks — lightness band, chroma floor, adjacent-pair CVD
separation, normal-vision floor, contrast. Light mode carries a contrast warning on
aqua, yellow and magenta (below 3:1 on white), which obliges the relief rule: a
legend is always present for two or more series, and every mark has a hover
tooltip.

**Slots are assigned in fixed order and never cycled.** The API folds anything past
the eighth series into "Otros", so a ninth hue is never needed. If you add series
capacity, fold or facet — do not generate a colour.

**No dual-axis charts.** `combo` renders as two vertically stacked panels sharing
one x-axis, not two y-scales on one plot. Two y-scales can be chosen to make any
pair of series look correlated, so the comparison the chart appears to support is
not one the reader can verify. This is a **deliberate departure from the MVP**,
which drew bar + line on a secondary axis. The capability — seeing two measures
together — is preserved. If your users specifically expect the Power BI look, this
is the place to change it, and `ComboChart.tsx` is self-contained.

Other specs: 2px lines, dots at r=4 and suppressed past 24 points, 4px rounded
data-ends on unstacked bars, a surface-coloured hairline between adjacent and
stacked fills so they don't read as one mark, recessive grid (horizontal only) and
axis ink derived from `currentColor` so it follows the theme.

`showTrend` fits a least-squares line (`withTrend` in `SeriesChart.tsx`) and draws
it dashed at reduced opacity, single-series only. It answers "is it going up?"
rather than leaving the user to guess.

## Theming

DaisyUI's stock `light` and `dark` themes, no custom palette:

```css
@import 'tailwindcss';
@plugin "daisyui" { themes: light --default, dark --prefersdark; }
```

The toggle stamps `data-theme` on `<html>`; the initial value comes from
localStorage falling back to `prefers-color-scheme`. Charts read the theme through
`useTheme()` to pick their palette column, because Recharts needs concrete colour
values rather than CSS variables for series fills.

`styles.css` also carries a handful of react-grid-layout overrides, restyled to use
DaisyUI tokens. Biome does not lint CSS here — it cannot parse Tailwind's
`@plugin` at-rule, so `**/*.css` is excluded in `biome.json`.

## Dashboard canvas

`components/dashboard/DashboardCanvas.tsx`, on react-grid-layout **v2**. The v2 API
differs from v1 in ways worth knowing:

- `cols` / `rowHeight` / `margin` moved into a `gridConfig` prop
- `draggableHandle` moved into `dragConfig.handle`
- there is no `WidthProvider`; width comes from the `useContainerWidth()` hook
- v2 ships its own TypeScript types, so no `@types/react-grid-layout`

Behaviour: drag by the widget header, resize from the corner, `pinned` maps to
react-grid-layout's `static` so a locked widget cannot be moved or resized. Layout
changes are saved batched per gesture via `PUT /layouts`.

Slicer changes debounce 700ms, then re-execute every non-filter widget that has a
`query`, passing the collected filters. Filter pills in the header clear a slicer
in one click. Export is `window.print()` with `print:hidden` on the chrome.

Asking a question in the dashboard's own input creates a widget, or a `note`
widget when the pipeline returns prose without a card.

## i18n

`lib/i18n.ts` holds the `es` and `en` resources inline — small enough that
separate JSON files would only add indirection. Locale is persisted to
localStorage and flows to the API on every request, where it controls both the
language the model answers in and which curated column labels are used.

Numbers and dates are formatted client-side with `Intl` (`lib/format.ts`). The MVP
formatted server-side with en-US separators regardless of the selected language, so
a Spanish user saw `1,234.56`.

## Not ported from the MVP

Deliberately or not yet — see [todo.md](./todo.md): the unread pip for responses
arriving in a background conversation, editable display name, and DAX syntax
highlighting (the viewer shows plain monospace).
