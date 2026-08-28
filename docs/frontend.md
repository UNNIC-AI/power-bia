# Frontend

React 19 + Vite 8 + Tailwind 4 + DaisyUI 5 + Radix primitives + TanStack Router/Query +
Recharts 3.

## Routes

File-based, generated into `routeTree.gen.ts` by `@tanstack/router-plugin/vite`.
The generated file is gitignored from lint and regenerates on dev/build — don't
edit it.

```
__root.tsx              Outlet + 404
login.tsx               Sign in / register (one form, toggled)
_authed.tsx             Auth guard + app shell (sidebar toggle, dataset strip, theme, locale, logout)
_authed/index.tsx       redirect → /chat
_authed/chat.tsx        Sidebar of chats + ChatPanel
_authed/dashboards.tsx  Sidebar of views + DashboardCanvas
```

Selection lives in **typed search params** rather than path params: `/chat?c=<id>`
and `/dashboards?d=<id>`. Fewer route files, still deep-linkable. Note that
`validateSearch` declaring `c: string | undefined` means every `Link` and
`navigate` must pass the key explicitly — `search={{ c: undefined }}`, not
`search={{}}`, which is a type error.

The two tabs — at the top of the sidebar, not in the navbar — read **Chat** and
**Views**. The route paths and the `dashboards` i18n namespace keep the older
name: renaming them buys nothing and breaks every existing link.

`ChatPanel` is remounted to switch conversations, which replays that
conversation's history as the initial messages — `useChat` reads `messages` only
when it initialises. It is keyed on a **generation counter**, not on the
conversation id directly, because of one transition where the id changes but the
thread does not: a brand-new conversation learns its id from the first frame of
its own answer stream. Keying on the id remounted the panel there, tearing down
the in-flight `useChat`; the history that replaced it could not contain the answer
yet, so the answer only appeared after a manual refresh.

`ChatRoute` therefore reconciles `?c=` against the previous value during render
and advances the generation on every move except that adoption. Doing it there
rather than inside the navigation helpers is what keeps the browser's own Back and
Forward correct — they change the search param without going through `select`.

## State

TanStack Query owns all server state; hooks are centralised in `lib/queries.ts`
with a `keys` object so invalidation is not stringly-typed. `lib/api.ts` is a thin
typed fetch wrapper that throws `ApiError` with the server's message.

No global client state library. Theme is a small context (`lib/theme-context.tsx`),
whether the sidebar is open is another (`lib/sidebar-context.tsx`), locale is
i18next, everything else is server state or local component state.

The sidebar needs a context because the toggle lives in the navbar and the panel
it opens lives inside each route, so the state has to sit above both. Open is the
default and the choice is remembered in `localStorage`, like the theme.

## Behaviour primitives: Radix

Interactive behaviour comes from the unified [`radix-ui`](https://www.radix-ui.com)
package; the look stays DaisyUI's, applied to the primitives' parts.

| Wrapper | Primitive | Replaces |
|---|---|---|
| `components/Menu.tsx` | `DropdownMenu` | DaisyUI's CSS-only dropdown, which opened on `:focus-within` — no roving focus, no Esc, no way to close it from a handler |
| `components/Tooltip.tsx` | `Tooltip` | `title` attributes on icon-only buttons: a delay the user cannot see coming, unstyled, and nothing at all on touch |
| `components/ConfirmDialog.tsx` | `AlertDialog` | a native `<dialog>` driven imperatively with `showModal()` |
| `components/chat/DaxViewer.tsx` | `Collapsible` | a bare `useState` toggle with no `aria-expanded` |

Two deliberate non-adoptions: the slicer's checkboxes stay native inputs inside
`<label>`, which is already accessible and keeps DaisyUI's `checkbox` styling; and
the sidebar's screen switch stays TanStack `Link`s rather than Radix `Tabs`, because
the router owns which one is active.

Radix tooltips are decoration, not names — every icon button keeps its own
`aria-label`. `Tooltip.Provider` is mounted once in `main.tsx` so moving between
two icon buttons shows the second tooltip immediately.

Styling gotcha worth remembering: DaisyUI's `modal-box` is transparent and scaled
down until an enclosing `.modal` opens it, so putting that class on Radix content
renders a dialog that is present in the accessibility tree and invisible on
screen. Dialog surfaces are built from tokens instead.

## The question box

Both screens ask questions through the same component, `components/Prompt.tsx`:
Enter submits, Shift+Enter inserts a newline, and the field grows with the text up
to six rows before it scrolls. The height is measured from the element's own
`scrollHeight` in a layout effect, so wrapped lines count like typed ones and the
new height paints in the same frame as the character that caused it. `items-end`
on the row keeps the button on the last line as the field grows.

The component also owns the footer band it sits in — border, padding and all.
When each screen supplied its own, chat's `p-4` and the view's `p-3` made the box
jump a few pixels as you switched tabs. Only the button differs: chat sends a
message, a view adds a widget, so the icon and its label are props. The
placeholder is not — it reads `prompt.placeholder` itself.

## The sidebar

`components/Sidebar.tsx` is one list for both screens: a chat row and a view row
differ only in what selecting them means. It renders the screen switch, the New
button, and the rows; each row carries a three-dot menu with **Rename**,
**Regenerate title** and **Delete**, and the row's timestamp as the menu's header
rather than as a column — a date on every row is noise, but it is exactly what you
want when you have opened the menu to decide something about that row.

Renaming happens in place: the menu item swaps the row for an input, Enter or blur
commits, Esc cancels. The row itself is a flex line with the label button and the
menu trigger as siblings; it used to be a button nested inside a button, which is
invalid HTML, and the browser resolved clicks to the outer one — so the old trash
icon selected the row it was meant to delete.

Creating a view no longer asks for a name up front: it is created as "Untitled
view" and named afterwards, by hand or from the model. That is what let the two
lists become one component.

## Destructive actions

Deleting a chat or a view goes through `components/ConfirmDialog.tsx`, a Radix
`AlertDialog`: the focus trap, Esc handling and inert background that the native
`<dialog>` gave us, but driven by the `open` prop rather than by an effect calling
`showModal()`. It also defaults focus to Cancel and wires the title and body as
the accessible name and description, which is the right shape for a destructive
question. The route still owns the `pendingDelete` row.

The dialog names the row it is about to remove, because the sidebar truncates long
titles and the menu that opened it has already closed.

Removing a **widget** from a view is deliberately not guarded: it is a single card
that can be pinned again from chat, not a thread or a whole dashboard.

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

DaisyUI's stock `light` and `black` themes, no custom palette:

```css
@import 'tailwindcss';
@plugin "daisyui" { themes: light --default, black --prefersdark; }
```

The app's own mode is `light | dark` everywhere — the chart palette and axis ink
are keyed on the *surface*, not on whichever DaisyUI theme paints it. `DAISY_THEME`
in `lib/theme.ts` is the only place the theme names appear, so swapping the dark
theme for another (`dracula`, `night`, back to `dark`) is a one-line change with no
churn in `palette.ts`.

The toggle stamps `data-theme` on `<html>`; the initial value comes from
localStorage falling back to `prefers-color-scheme`. Charts read the theme through
`useTheme()` to pick their palette column, because Recharts needs concrete colour
values rather than CSS variables for series fills.

### Corners

DaisyUI splits radius into `--radius-selector` (checkbox, toggle, badge),
`--radius-field` (input, button, tab) and `--radius-box` (card, modal, menu).
`styles.css` points all three at a single `--radius-app`, so one value decides
every corner in the app and the three scales can never drift apart.

Components therefore do **not** set their own `rounded-*`. The two allowed shapes
are the tokens — `rounded-box` / `rounded-field` on hand-built surfaces that are
not DaisyUI components, such as the tooltip and the menu — and `rounded-full`
where a pill is intended, like the sidebar's screen switch and the send button.
A one-off `rounded-2xl` on the prompt was exactly the drift this rule prevents.

## Icons

`@tabler/icons-react`, imported from the package root (`import { IconX } from
'@tabler/icons-react'`). **Do not deep-import** `dist/esm/icons/IconX.mjs` — those
files ship no `.d.ts`, so the import is untyped. The barrel costs nothing in the
bundle: the package is ESM with `sideEffects: false`, and a production build ships
only the icons actually referenced (13 at the time of writing) plus a 0.9 kB shared
factory chunk.

House style is `size={14}` on `btn-xs`, `16` on `btn-sm`/navbar, `18` on `btn`, with
`stroke={1.75}` throughout — Tabler's default stroke of 2 is heavy at small sizes.
An icon-only button carries both `title` and `aria-label`, since the glyph it
replaced was at least readable text.

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

The pencil opens the widget's edit panel: the question on top, the DAX it
generated underneath. The panel keeps a minimum height and overlays whatever is
below it, because a KPI widget is four rows tall and would otherwise squeeze the
DAX into a sliver. Running the edited question stores the new DAX alongside the
new card.

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
