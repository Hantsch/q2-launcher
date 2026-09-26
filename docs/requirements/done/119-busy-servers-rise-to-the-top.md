---
id: 119
title: busy servers rise to the top
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the Servers view wanting to know where something is going on right now, not to read an
alphabetical directory of mostly-empty infrastructure. So the list they land on has to already be
ordered toward activity: favourites the user cares about pinned on top, then the busiest servers,
without the user touching a single control. From there, a user who wants a different order — by map,
by ping, by name — can change it, and the launcher remembers that choice the next time the view
opens.

This story is the ordering of the rows [[118]] defines; it does not change what a row shows or which
markers appear, and it does not decide which servers are in the list at all — that is [[120]]'s
filters and search, which have to compose with whatever order this story produces. The rows
themselves come from the scan engine ([[114]]) inside the module from [[106]].

## Acceptance Criteria

- [x] **AC1** — With no user-chosen sort in effect, the list orders favourites first, then the
      remaining servers by occupancy descending (GB-L3).
- [x] **AC2** — In the default order, gamemode only breaks ties between servers with the same
      favourite status and the same occupancy; it never groups the list — a busier server is always
      above a less busy one, whatever their gamemodes.
- [x] **AC3** — A user can change which column the list is sorted by, from the list's own UI.
- [x] **AC4** — A user-chosen sort persists across sessions — reopening the Servers view (or
      restarting the launcher) shows the same sort the user last chose, not the default.
- [x] **AC5** — The sort/filter engine that produces this ordering is a pure, unit-tested module,
      independent of the list UI (GB-A6).

## Open Questions

- [x] ~~**Q1 — Is gamemode a grouping key or only a tie-break?** (concept §18 open point 3)~~
      answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Gamemode as grouping key or tie-break: **tie-break only** — favourites, then
  occupancy descending, then gamemode among equal occupancy (2026-09-25, planning).
- **Occupancy means the known player count, not the fill ratio.** The requirement asks for "where
  something is going on", and a ratio would rank a 1/2 duel above a 12/32 FFA.
- **The player count comes from 118's `knownPlayerCount`, and gamemode from 118's stored
  `entry.gamemode`.** Nothing is re-derived here, so the sort, the row marker and [[120]]'s filters
  cannot disagree.
- **Favourite comes from the row's live `favourite` flag (118), never from `origins`.** `origins`
  lags behind an un-favourite (118 Decisions).
- **A stale row sorts by its last known count, and an unknown count sorts below every known count,
  0 included.** This matches 118's "the waiting marker follows the known count, stale or not", and
  an unscanned server is not evidence of activity.
- **Gamemode tie-break rank:** `deathmatch`, `team`, `ctf`, `coop`, `single`, then unknown. This is
  player-versus-player first, which is what the browser exists for (duels). Unknown goes last.
- **The final tie-break is the display name (`name ?? address`), then the address.** That makes the
  order total and deterministic, so rows do not jump between refreshes, and a [[120]] filter over it
  keeps the relative order (120 AC6).
- **Favourites stay pinned on top in every sort, not only the default.** The interview quote is
  "favouriten immer on top", and AC1 only fixes what the default does. A column sort orders the
  rows inside the favourite group and inside the rest.
- **The sortable columns are 118's five fields:** name, mod, players, map and ping. The concept says
  "every column", and gamemode is a marker, not a column.
- **Each column has a natural first direction:** name/mod/map A→Z, players high→low, ping low→high.
  A tie inside a column falls back to the default order.
- **An unknown value ("—") sorts last in both directions.** A dash is not a value, so reversing the
  order must not float every unscanned row to the top.
- **Clicking a column cycles through three states: natural direction → reversed → default order.**
  The default must stay reachable from the list's own UI without a second control.
- **The current sort is shown as visible text** (`servers-sort-current`), and the active column
  button carries `aria-pressed`. Status is never icon-only (design-tokens).
- **The sort is persisted in main as an optional `ServersState.listSort`, where absent means the
  default order.** `state.json` is the app's one persistence store, and there is no `localStorage`
  anywhere in the renderer. Keeping the field optional also leaves the ~15 test files that build
  `ServersState` literals untouched.
- **Two new invoke channels, `list.getSort` and `list.setSort`,** with strict zod payloads. Sort is
  a list-view preference, not a scan setting, so it does not ride on `scan.patchSettings`.
- **A malformed persisted `listSort` degrades to absent (default order).** It never resets the rest
  of the `servers` key. This is the same field-level-forgiving rule as `parseServersScanSettings`.
- **The engine lives in `src/shared/servers/list-sort.ts`,** pure, with no React and no IPC (GB-A6).
  [[120]] adds its filter module next to it and composes it with this one in `ServersView`.
- **Persistence across a restart is proven by reading `state.json` off disk plus a `page.reload()`.**
  The flow harness keeps the app alive (`withApp`), and `servers-scan-settings.mjs` is the
  precedent.

## Plan

Builds on [[118]]'s `ServerListRow` (`favourite`, `gamemode`) and `row-markers.ts`. Order: shared
engine → contract and main → renderer.

1. **D1 (shared, pure):** `list-sort.ts` holds the types, the default comparator, the column
   comparator and a `nextSort` cycle helper, with a colocated unit test.
2. **D2 (contract + main):** `ServersState.listSort?`, `serverListSortSchema`, the
   `list.getSort`/`list.setSort` handlers, forgiving parse in `main/lib/schemas.ts`, and the
   read/merge/persist handlers in `main/modules/servers/index.ts`.
3. **D3 (renderer):** `getListSort`/`setListSort` in the client, a `ServerSortBar` above the list,
   and `ServersView` rendering `sortServerRows(entries, sort)`. It loads the sort on mount and
   persists it on change. Plus i18n and one e2e flow.

Out of scope: filters/search ([[120]]), list states ([[121]]), what a row shows ([[118]]).

## Deliverables

- [x] **D1 — the sort engine (shared, pure).**
  - Create `src/shared/servers/list-sort.ts` with a colocated `list-sort.test.ts`:
    - Types:
      - `export type ServerSortColumn = 'name' | 'mod' | 'players' | 'map' | 'ping'`
      - `export type ServerSortDirection = 'asc' | 'desc'`
      - `export interface ServerListSort { column: ServerSortColumn; direction: ServerSortDirection }`
      - `export const SERVER_SORT_COLUMNS` (readonly array, in that order)
    - `sortServerRows(rows: readonly ServerListRow[], sort: ServerListSort | undefined): ServerListRow[]`
      returns a new array and never mutates the input. Every comparison starts with favourites
      first (`row.favourite`), in every mode.
    - **Default** (`sort` undefined):
      - occupancy descending via `knownPlayerCount` (`src/shared/servers/row-markers.ts`); an
        unknown count goes below every known count, 0 included;
      - then gamemode rank from `row.gamemode`: `deathmatch` < `team` < `ctf` < `coop` < `single`
        < undefined;
      - then display name `name ?? address`, compared with
        `localeCompare(…, 'en', { sensitivity: 'base', numeric: true })`;
      - then `address`.
    - **Column sort:** favourites first, then the column value in `direction`, then the default
      comparator as the tie-break. The column values are:
      - name: `name ?? address`
      - mod: `mod`
      - players: `knownPlayerCount`
      - map: `map`
      - ping: `rttMs`
      An undefined value sorts last in **both** directions.
    - `export const NATURAL_DIRECTION: Record<ServerSortColumn, ServerSortDirection>` =
      name/mod/map `asc`, players `desc`, ping `asc`.
    - `nextSort(current: ServerListSort | undefined, column): ServerListSort | undefined` cycles:
      - another column (or none) → `{ column, direction: NATURAL_DIRECTION[column] }`
      - same column at natural direction → reversed
      - same column reversed → `undefined` (default order)
  - Files: `src/shared/servers/list-sort.ts`, `src/shared/servers/list-sort.test.ts`.
  - Mirror: `src/shared/servers/row-markers.ts` (118 D1) for the pure-helper-plus-colocated-test
    shape.
  - Tests (`list-sort.test.ts`):
    - "default order: favourites first, then occupancy descending"
    - "gamemode only breaks occupancy ties and never groups" (dm 1, ctf 6, dm 3, ctf 3 →
      ctf 6, dm 3, ctf 3, dm 1)
    - "unknown player count sorts below zero"
    - "the order is total: name then address break the remaining ties" (the same result for any
      shuffled input)
    - "a column sort keeps favourites pinned and orders by the column in both directions"
    - "an unknown column value sorts last in both directions"
    - "nextSort cycles natural, reversed, default"
    - "does not mutate its input"
  - Acceptance: `npx vitest run src/shared/servers/list-sort.test.ts` passes, and
    `npm run typecheck` is clean.

- [x] **D2 — the sort is persisted (contract + main).**
  - In `src/shared/modules/servers.ts`:
    - Re-export the D1 types from `../servers/list-sort`.
    - Add `export const serverListSortSchema = z.object({ column: z.enum([...SERVER_SORT_COLUMNS]), direction: z.enum(['asc','desc']) }).strict()`.
    - Add the optional field `listSort?: ServerListSort` to `ServersState` (absent = default
      order). Doc comment: user-chosen list sort, story 119.
    - Add the handlers `listGetSort: 'list.getSort'` (payload `serversNoInputSchema`, resolves
      `ServerListSort | null`) and `listSetSort: 'list.setSort'` (payload
      `z.object({ sort: serverListSortSchema.nullable() }).strict()`, resolves the persisted
      `ServerListSort | null`).
    - Add both to `SERVERS_HANDLER_SCHEMAS`.
  - In `src/main/lib/schemas.ts`, `parseServersState` reads
    `serverListSortSchema.safeParse(raw?.listSort)` and sets `listSort` only on success. Absent or
    malformed input → the key is omitted, and the other keys are unaffected.
  - In `src/main/modules/servers/index.ts`, register both handlers with the same read/merge/persist
    discipline as `scanPatchSettings`:
    - `null` → persist `current` without `listSort`, via destructuring;
    - otherwise → `{ ...current, listSort: sort }`;
    - return what `setServersState` stored (`?? null`).
  - Files: `src/shared/modules/servers.ts`, `src/shared/modules/servers.test.ts` (update the exact
    `SERVERS_HANDLERS` `toEqual`), `src/main/lib/schemas.ts`, `src/main/lib/schemas.test.ts`,
    `src/main/modules/servers/index.ts`, `src/main/modules/servers/index.test.ts`.
  - Mirror: the `scanGetSettings`/`scanPatchSettings` handlers and their tests.
  - Tests:
    - `schemas.test.ts`:
      - "parseServersState keeps a valid listSort and drops a malformed one without touching the
        rest"
      - "a state file without listSort parses to the default order"
    - `index.test.ts`:
      - "list.setSort persists the sort and list.getSort returns it"
      - "list.setSort null clears the persisted sort"
      - "list.setSort rejects an unknown column"
  - Acceptance: `npx vitest run src/main/lib/schemas.test.ts src/main/modules/servers src/shared/modules`
    passes, and `npm run typecheck` is clean.

- [x] **D3 — sorting on the real surface (renderer + flow).**
  - In `src/renderer/src/modules/servers/client.ts`, add:
    - `getListSort(): Promise<Outcome<ServerListSort | null>>`
    - `setListSort(sort: ServerListSort | null): Promise<Outcome<ServerListSort | null>>`
    Both use `callModule`, like `getScanSettings`.
  - Create `src/renderer/src/modules/servers/ServerSortBar.tsx`:
    - Props: `{ sort: ServerListSort | undefined; onSort(column) }`.
    - Render one `Button` (`variant="neutral"`, default size) per column, with testid
      `servers-sort-<column>`, the i18n label `servers.sort.column.<column>`,
      `aria-pressed={sort?.column === column}`, and a lucide `ArrowUp`/`ArrowDown` icon on the
      active one.
    - Render a visible text line `servers-sort-current`: `servers.sort.current.default`
      ("Favourites first, then busiest") or `servers.sort.current.column` ("Sorted by {{column}},
      {{direction}}", with `servers.sort.direction.asc`/`.desc`). Semantic tokens only.
  - In `ServersView.tsx`:
    - Hold `sort` state (`ServerListSort | undefined`).
    - Load it once on mount via `getListSort()` (`null` → undefined).
    - Render `sortServerRows(entries, sort)` through the existing `ServerRow` mapping, keeping
      the testids.
    - `ServerSortBar.onSort` → `next = nextSort(sort, column)`; set it locally, then
      `setListSort(next ?? null)`, and re-sync from the returned value.
  - In `src/renderer/src/i18n/locales/en.json`, add the `servers.sort.*` keys.
  - Tests:
    - In `ServersView.test.tsx`, which mocks `client.ts` like the existing tests:
      - "renders rows in the engine's default order"
      - "clicking a column header sorts by it and persists via setListSort"
      - "restores the persisted sort on mount"
    - Flow `scripts/flows/servers-sort-order.mjs` (flow name `servers-sort-order`):
      - Fixture: every master source disabled and the scan autos off, as in
        `servers-row-markers.mjs`. Five loopback `dgram` responders are manual servers, one of
        them a favourite:
        - F: favourite, 0 players, map `q2dm8`.
        - E: `ctf 1`, 6 players, map `q2dm3`.
        - B: `deathmatch 1`, 3 players, map `q2dm1`.
        - C: `ctf 1`, 3 players, map `q2dm5`.
        - D: `deathmatch 1`, 1 player, map `q2dm2`.
      - After "Refresh servers", the DOM order of `servers-row-*` is F, E, B, C, D (AC1, AC2 —
        ctf/dm alternate, so there is no grouping). `servers-sort-current` shows the default text.
      - Click `servers-sort-map`: the order is F, B, D, E, C (favourite pinned, map A→Z). Click
        it again: F, C, E, D, B (AC3).
      - Navigate away and back: still map Z→A. `page.reload()`: still map Z→A. `state.json` on
        disk has `servers.listSort = { column: 'map', direction: 'desc' }` (AC4).
      - Click `servers-sort-map` a third time: back to the default order, and `state.json` has
        no `listSort`, which also reverts the fixture.
      - Take screenshots per phase.
  - Files: `client.ts`, `ServerSortBar.tsx`, `ServersView.tsx`, `ServersView.test.tsx` (under
    `src/renderer/src/modules/servers/`), `en.json`, `scripts/flows/servers-sort-order.mjs`, and
    the `CHANGELOG.md` entry.
  - Mirror:
    - `MasterSourceRow.tsx` for a small presentational component with i18n and testids.
    - `scripts/flows/servers-row-markers.mjs` (118 D3) and `servers-scoped-refresh.mjs` for the
      responders and the `waitForFinishedAtChange` pattern, copied, not imported.
    - `scripts/flows/servers-scan-settings.mjs` for reading `state.json` off disk.
  - Acceptance: `npx vitest run src/renderer/src/modules/servers` passes, and
    `npm run ui:flow -- servers-sort-order` passes with its screenshots.

## Model Hints

- D1, D2, D3 → default tier.
  - D1 is one pure comparator, and every rule is pinned by a named unit test.
  - D2 is one optional field and two handlers, on the `scanPatchSettings` pattern.
  - D3 is one small component plus one flow, on the 118 pattern.
- Review: → default. The plausible wrong implementations each fail a named test:
  - grouping by gamemode fails "gamemode only breaks occupancy ties and never groups" and the flow;
  - reading favourite from `origins` is structurally the same comparator input as 118's already
    tested live flag;
  - a non-persisted, renderer-only sort fails the flow's `state.json` check.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-sort-order.mjs` › flow "servers-sort-order" (the default DOM order
  is F, E, B, C, D, with the favourite on top). Also unit `src/shared/servers/list-sort.test.ts` ›
  "default order: favourites first, then occupancy descending" and › "unknown player count sorts
  below zero" (D1), and `src/renderer/src/modules/servers/ServersView.test.tsx` › "renders rows in
  the engine's default order" (D3).
- AC2 → unit `src/shared/servers/list-sort.test.ts` › "gamemode only breaks occupancy ties and never
  groups" (D1). Also e2e `scripts/flows/servers-sort-order.mjs` › flow "servers-sort-order" (ctf 6,
  dm 3, ctf 3, dm 1 order, D3).
- AC3 → e2e `scripts/flows/servers-sort-order.mjs` › flow "servers-sort-order" (clicking
  `servers-sort-map` reorders A→Z, then Z→A, then back to default). Also unit `list-sort.test.ts` ›
  "a column sort keeps favourites pinned and orders by the column in both directions", › "an unknown
  column value sorts last in both directions" and › "nextSort cycles natural, reversed, default"
  (D1), and `ServersView.test.tsx` › "clicking a column header sorts by it and persists via
  setListSort" (D3).
- AC4 → e2e `scripts/flows/servers-sort-order.mjs` › flow "servers-sort-order" (map Z→A survives
  navigate-away-and-back and `page.reload()`, and `state.json` carries `servers.listSort`). Also
  unit `src/main/lib/schemas.test.ts` › "parseServersState keeps a valid listSort and drops a
  malformed one without touching the rest" and › "a state file without listSort parses to the
  default order", `src/main/modules/servers/index.test.ts` › "list.setSort persists the sort and
  list.getSort returns it" and › "list.setSort null clears the persisted sort" (D2), and
  `ServersView.test.tsx` › "restores the persisted sort on mount" (D3).
- AC5 → unit `src/shared/servers/list-sort.test.ts` › every D1 test, including "the order is total:
  name then address break the remaining ties" and "does not mutate its input". The module imports
  nothing from React, IPC or the renderer, which typecheck enforces through `tsconfig.node.json`
  plus `tsconfig.web.json` for shared (D1).

No `manual residue`.

## Done

Implemented the pure sort engine (`list-sort.ts`: default comparator, column comparator, `nextSort`
cycle), its persistence (`ServersState.listSort`, `list.getSort`/`list.setSort` handlers with a
strict zod schema and field-forgiving parse), and the renderer surface (`ServerSortBar`,
`ServersView` wiring, i18n, e2e flow). All three deliverables landed as planned, no deviations from
the Decisions.

Commit message: `119: busy servers rise to the top`

Verification — narrow gate: `npm run build` green, `npm run typecheck` green,
`npx vitest run --changed HEAD` green (91 files / 1525 tests), `npm run ui:flow -- servers-sort-order`
green (all phases incl. default order, map asc/desc cycling, navigate-away/reload persistence,
`state.json` round-trip, and clearing back to default). AC → test mapping verified: AC1–AC5 each
confirmed via their named unit tests (`list-sort.test.ts`, `schemas.test.ts`, `index.test.ts`,
`ServersView.test.tsx`) and the e2e flow `servers-sort-order` — all present and passing, none
missing from the run. No `manual residue`. Review: default-tier clean agent, verdict PASS, two minor
non-blocking observations (a cosmetic import-path inconsistency in `ServerSortBar.tsx`; the
then-unfilled Done section) — no fix cycle needed.

tiers: D 3 / hard 0 · review default · cycles 0 · agents 5
