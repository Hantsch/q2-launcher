---
id: 120
title: i filter and search the list
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user looking at the server list ([[118]], ordered per [[119]]) wants to narrow it down: only my
mod, only deathmatch, only servers with room, only servers with no password, only the ones waiting
for an opponent, only this map — or find a specific server or a specific player by typing a name.
None of that should ever mean a server disappears from the list *by default*: the browser's whole
premise is that nothing is hidden until the user asks for it, because an empty server is still a
fact worth seeing, not noise to be swept away.

This story is the filtering and search layer over the rows [[118]] defines and the order [[119]]
produces; it does not change what a row shows or how the unfiltered list is ordered — it changes
which subset of that ordered list is currently visible. It lives in the same module as [[106]], over
data the scan engine ([[114]]) supplies.

## Acceptance Criteria

- [ ] **AC1** — Each of the listed filters — mod, gamemode, non-empty, not full, no password,
      waiting-for-opponent, map — can be applied on its own (GB-L5).
- [ ] **AC2** — Multiple filters can be active at the same time, and the visible list reflects their
      intersection (a server must satisfy every active filter to remain visible).
- [ ] **AC3** — With no filter active, every discovered server is listed, including servers with zero
      players (GB-L4).
- [ ] **AC4** — A search term matches against server name for every server in the list, regardless of
      how much data has been fetched for it.
- [ ] **AC5** — A search term additionally matches player names, but only for servers whose stage-2
      detail has actually been fetched; a server with no fetched player data is not falsely excluded
      from a player-name search by virtue of having no player data, nor falsely included as a name
      match it never made.
- [ ] **AC6** — Filters and search compose with the sort order from [[119]]: the visible subset changes
      as filters/search are applied, but the relative order of the servers that remain visible follows
      the active sort without the two fighting each other (e.g. filtering never silently changes the
      sort column, and sorting never re-includes a filtered-out server).

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Decisions (Sprint)

- **The filter engine is pure and shared.** `src/shared/servers/list-filter.ts` sits next to 118's
  `row-markers.ts` and reuses its `knownPlayerCount`/`isWaitingForOpponent`, because GB-A6 names the
  sort/filter engine a pure unit-tested module and the waiting filter must give the same answer as
  the waiting marker.
- **Filtering never reorders.** `filterServers(rows, filter)` is an order-preserving subset of its
  input, and the view applies it to [[119]]'s already-sorted rows. Filter state and sort state are
  separate values that never write to each other (AC6).
- **Filters and search are not persisted.** They are local view state and reset when the view
  remounts. The concept only asks for the *sort* to be remembered (§8), and a remembered filter would
  hide servers on open, against GB-L4 ("no filter by default").
- **An active filter needs the data to be known.** A server whose relevant field is unknown fails
  that filter: an unknown count fails non-empty/not-full/waiting, unknown `maxclients` fails not-full,
  unknown `needpass` fails no-password, and an unknown mod/map/gamemode fails that select. A filter is
  a claim the user relies on, and "no password" must never show a server that turns out to be locked.
- **Stale rows filter on their last-known values**, the same values the row shows (118: stale keeps
  its fields). A pending placeholder has no fields, so it fails every field filter but stays
  searchable.
- **Search is a trimmed, case-insensitive substring match.** It checks the server name and the
  address, so a server with no name yet (the row shows its address) is still findable (AC4: "every
  server"). It also checks player names only when `players` is a roster array, i.e. stage 2 has run.
  A numeric count or `undefined` adds no match and removes none (AC5). A term that is empty after
  trimming means "no search".
- **Match on the string the row displays.** Search works on the stored string, lowercased, with no
  colour/high-bit stripping, because the user types what they see and 118 renders the string as-is.
- **Mod and map are selects built from the current list.** Their options are the distinct known
  values across all rows (not only the filtered ones), deduped case-insensitively and sorted, plus
  "Any". Matching is case-insensitive equality. A currently selected value stays in the options after
  a rescan drops it, so the control never shows a value it cannot display.
- **Gamemode is a select over 118's `ServerGamemode` values**, labelled with 118's
  `servers.gamemode.*` keys, so the filter and the marker say the same word.
- **The four boolean filters are checkboxes** (existing `Checkbox` primitive, `min-h-11` label), so
  there is no new design-token deviation row.
- **A filtered-to-nothing list gets its own line.** "No server matches the current filters" plus a
  clear action (`servers-filter-no-match`). This is distinct from [[121]]'s "no source returned a
  server" empty state, because the data exists and only the view is narrowed.
- **A visible count while filtering.** "Showing {shown} of {total}" (`servers-filter-count`) appears
  whenever a filter or search is active, so a narrowed list never looks like a short scan.
- **Filtering out the selected row clears the selection.** 117's "Refresh selected" must not act on
  a row the user can no longer see.
- **No debounce on search.** The list is a few hundred rows and the filter is a linear pass, so
  filtering on every keystroke is cheap and simpler.
- **No `ui:verify` registry entry here.** The list's registry screens are [[121]]'s AC4, and the
  flow below proves this story on the real surface.

## Plan

Builds on [[118]] (`ServerListRow`, `row-markers.ts`, `ServerRow.tsx`, `ServerGamemode`) and
[[119]] (the sorted row list and its sort control in `ServersView.tsx`). Order: shared → renderer.

1. **Shared (D1):** `list-filter.ts` (pure) holds the `ServerListFilter` shape, `EMPTY_SERVER_LIST_FILTER`,
   `isFilterActive`, `matchesFilter`, `matchesSearch`, `filterServers` (order-preserving) and
   `filterOptions` (distinct mods/maps). Unit tests prove every filter alone, their intersection,
   no-filter = everything, both search halves, and order preservation.
2. **Renderer (D2):** `ServerListFilterBar.tsx` holds the search input, mod/gamemode/map selects, four
   checkboxes, clear button and count. `ServersView.tsx` keeps `filter` in `useState` and renders
   `filterServers(sortedRows, filter)` plus the no-match line, and clears a selection that is filtered
   out. Add the `en.json` keys and a CHANGELOG entry. Component tests plus one e2e flow against
   loopback responders prove it on the real surface.

**Plan assumptions (118/119 are refined in parallel):**
- 118 lands `src/shared/servers/row-markers.ts` with `knownPlayerCount`/`isWaitingForOpponent`,
  `ServerListEntry.gamemode?: ServerGamemode`, and `ServerListRow`.
- 119 lands a sort function whose output the view renders, plus a sort control with a stable testid.
  D2 reads 119's `## Deliverables` / `## Done` for that function name and testid. If 119 names them
  differently than expected, adapt the call site, not the contract.

Out of scope: row content (118), order (119), loading/empty/error states (121), persisting filters.

## Deliverables

- **D1 — the filter engine (shared, pure).**
  - Create `src/shared/servers/list-filter.ts` with a colocated `list-filter.test.ts`.
    - `export interface ServerListFilter { search: string; mod: string | null; gamemode: ServerGamemode | null; map: string | null; nonEmpty: boolean; notFull: boolean; noPassword: boolean; waitingForOpponent: boolean }`
      and `export const EMPTY_SERVER_LIST_FILTER`, with every select `null`, every boolean `false`
      and `search: ''`.
    - `isFilterActive(f)`: true when any select is non-null, any boolean is true, or
      `f.search.trim() !== ''`.
    - `matchesSearch(row, term)`: take `t = term.trim().toLowerCase()`, where an empty `t` means
      true. Otherwise it is true when `row.name`, `row.address`, or (only if `Array.isArray(row.players)`)
      any `player.name`, lowercased, `includes(t)`. A numeric or `undefined` `players` adds no match.
    - `matchesFilter(row, f)`: `matchesSearch(row, f.search)` AND every active filter. With
      `n = knownPlayerCount(row)` (from `./row-markers`):
      - `mod`/`map`: the row's value is defined and equals the filter, case-insensitive.
      - `gamemode`: `row.gamemode === f.gamemode`.
      - `nonEmpty`: `n !== undefined && n > 0`.
      - `notFull`: `n !== undefined && row.maxclients !== undefined && n < row.maxclients`.
      - `noPassword`: `row.needpass === false`.
      - `waitingForOpponent`: `isWaitingForOpponent(row)`.
      - An unknown field fails its active filter.
    - `filterServers<T extends ServerListEntry>(rows: readonly T[], f): T[]` is `rows.filter(...)`.
      It never sorts, and returns every row unchanged when `!isFilterActive(f)`.
    - `filterOptions(rows): { mods: string[]; maps: string[] }` returns the distinct defined values,
      deduped case-insensitively (first spelling wins), sorted with `localeCompare`.
  - Files: `src/shared/servers/list-filter.ts`, `src/shared/servers/list-filter.test.ts`.
  - Mirror: `src/shared/servers/row-markers.ts` (from 118) / `infostring.ts` for the
    pure-helper-plus-colocated-test shape. Types come from `src/shared/modules/servers.ts`.
  - Tests (`list-filter.test.ts`), with a fixture of rows covering mods, maps, modes, counts,
    full/not-full, password/no password, a stale row, a pending placeholder, and one roster row:
    - "each filter applied alone keeps exactly the rows that satisfy it" is one `it.each` case per
      filter (mod, gamemode, nonEmpty, notFull, noPassword, waitingForOpponent, map). It includes
      unknown-field rows failing, a stale row filtering on its last-known values, and
      case-insensitive mod/map.
    - "active filters intersect" checks that two and three combined filters give the intersection,
      and that a combination can give an empty result.
    - "no active filter lists every row, empty servers included" checks that
      `EMPTY_SERVER_LIST_FILTER` returns the same rows in the same order, including 0-player and
      pending rows. It also covers a whitespace-only search.
    - "search matches server name or address for every row" covers a named row, a pending row found
      by address, a numeric-players row found by name, and case-insensitivity.
    - "search matches player names only where a roster was fetched" covers a roster row found by a
      player name, a numeric-count row not found by that name and not excluded from a name match,
      and an `undefined`-players row the same way.
    - "filtering preserves the input order" checks that for a shuffled input,
      `filterServers(rows, f)` is a subsequence of `rows` in the same order.
    - "filter options are distinct, case-insensitive and sorted".
  - Acceptance: `npx vitest run src/shared/servers/list-filter.test.ts` passes and
    `npm run typecheck` is clean.

- **D2 — the filter bar, on the real surface.**
  - Create `src/renderer/src/modules/servers/ServerListFilterBar.tsx`. It is controlled and takes
    `{ filter, onChange, options: { mods, maps }, shown, total }`. Use the existing primitives from
    `components/ui/controls.tsx` (`Input`, `Select`, `Checkbox`) and `components/ui/Button.tsx`, with
    semantic tokens only and every label an i18n key under `servers.filter.*`. Testids:
    - `servers-filter-search` (input, `type="search"`, with a visible label)
    - `servers-filter-mod`, `servers-filter-gamemode`, `servers-filter-map` (selects; the first option
      is `servers.filter.any` with an empty value mapped to `null`). Gamemode options are the five
      `ServerGamemode` values, labelled `servers.gamemode.<mode>` (118's keys). Mod/map options are
      `options.mods`/`options.maps`, plus the currently selected value if it is missing.
    - `servers-filter-non-empty`, `servers-filter-not-full`, `servers-filter-no-password`,
      `servers-filter-waiting` (checkboxes, label wrapper `min-h-11`)
    - `servers-filter-clear` (Button, disabled while `!isFilterActive`), which sets
      `EMPTY_SERVER_LIST_FILTER`
    - `servers-filter-count`, which renders `servers.filter.count` ("Showing {{shown}} of {{total}}")
      only while a filter is active
  - In `ServersView.tsx`:
    - Add `const [filter, setFilter] = useState(EMPTY_SERVER_LIST_FILTER)`. It is not persisted.
    - `visible = filterServers(sortedRows, filter)`, where `sortedRows` is whatever 119's view already
      renders. Filter after sorting, and never touch the sort state.
    - Render `<ServerListFilterBar>` above the row panel with `options = filterOptions(allRows)`.
    - Map `visible` through 118's `ServerRow`.
    - When `visible` is empty but the rows are not, render `servers-filter-no-match`
      (`servers.filter.noMatch` plus a clear button).
    - A `useEffect` clears `selectedAddress` when it is no longer in `visible`.
    - The status line's total count stays the full row count.
  - In `src/renderer/src/i18n/locales/en.json`, add `servers.filter.*` (search label/placeholder,
    any, mod, gamemode, map, nonEmpty, notFull, noPassword, waiting, clear, count, noMatch).
  - In `CHANGELOG.md`, add one `### Added` entry (Keep-a-Changelog headings, see the profile notes).
  - Tests:
    - `ServerListFilterBar.test.tsx` › "each control writes its own field into the filter" and ›
      "clear resets every field and the count shows only while filtering".
    - `ServersView.test.tsx` (update the existing mocked-client tests) › "filtering narrows the
      rendered rows without changing the sort control", › "a filtered-out selected row is
      deselected", and › "a filter that matches nothing shows the no-match line, not the empty
      state".
    - `scripts/flows/servers-filter-search.mjs` (flow name `servers-filter-search`):
      - Fixture: master sources disabled (`SERVERS_DISABLED_SOURCES`) and the scan autos off. Four
        loopback `dgram` responders run as manual servers, answering both `info` and `status` (with
        player lines):
        - A: `opentdm`, `q2dm1`, `deathmatch 1`, maxclients 2, 1 player "Alpha", no password.
        - B: `baseq2`, `q2dm1`, `deathmatch 1`, maxclients 2, players "Bravo" and "Zulu" (full),
          no password.
        - C: `baseq2`, `q2dm8`, `deathmatch 1`, maxclients 16, 0 players, `needpass 1`,
          hostname "Empty Cellar".
        - D: `ctf`, `q2ctf1`, `ctf 1`, maxclients 16, players "Zulu", "Yankee" and "Xray", no password.
      - Click "Refresh servers" and wait for the round to finish (`waitForFinishedAtChange`).
      - AC3: with no filter, all four rows are visible, including C.
      - AC1: apply each filter alone and assert the visible set, then clear:
        - mod baseq2 → B, C
        - gamemode ctf → D
        - non-empty → A, B, D
        - not full → A (1/2), C, D
        - no password → A, B, D
        - waiting → A
        - map q2dm1 → A, B
      - AC2: mod baseq2 + no password → B. Adding not full → no row, and the no-match line shows.
      - AC4: search "cellar" → C (0 players, never stage-2 queried).
      - AC5: search "zulu" → B and D, not A or C.
      - AC6: with mod baseq2 active, B is above C under the default sort (occupancy). Change the sort
        through 119's sort control: the visible set is still B and C, in the new order, and the
        filter controls keep their values. Clear the filter: the sort control's value is unchanged.
      - Take screenshots per phase.
  - Files: `ServerListFilterBar.tsx`, `ServerListFilterBar.test.tsx`, `ServersView.tsx`,
    `ServersView.test.tsx`, `en.json`, `CHANGELOG.md`, `scripts/flows/servers-filter-search.mjs`.
  - Mirror: `src/renderer/src/modules/servers/ServersSettingsSection.tsx` (controls, i18n, testids)
    and `scripts/flows/servers-row-markers.mjs` from 118 (loopback responders answering info plus
    status, fixture seeding, `waitForFinishedAtChange`). If that flow is not there yet,
    `scripts/flows/servers-scoped-refresh.mjs`. Copy it, do not import it.
  - Acceptance: `npx vitest run src/renderer/src/modules/servers` passes and
    `npm run ui:flow -- servers-filter-search` passes with its screenshots.

## Model Hints

- D1, D2 → default tier. D1 is a pure predicate module pinned by named unit tests per filter. D2 is
  one controlled component plus view wiring and one flow on the 117/118 flow pattern.
- Review: → default. The plausible wrong implementations are treating an unknown field as passing a
  filter, and matching player names against a numeric count. D1's named per-filter and roster-only
  tests catch both, so a second hard pass buys nothing.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-filter-search.mjs` › flow "servers-filter-search" (each of the
  seven filters applied alone gives its expected visible set). Also unit
  `src/shared/servers/list-filter.test.ts` › "each filter applied alone keeps exactly the rows that
  satisfy it" (D1), and `src/renderer/src/modules/servers/ServerListFilterBar.test.tsx` › "each
  control writes its own field into the filter" (D2).
- AC2 → e2e `scripts/flows/servers-filter-search.mjs` › flow "servers-filter-search" (mod baseq2 + no
  password → B only, and adding not full → the no-match line). Also unit `list-filter.test.ts` ›
  "active filters intersect" (D1), and `ServersView.test.tsx` › "a filter that matches nothing shows
  the no-match line, not the empty state" (D2).
- AC3 → e2e `scripts/flows/servers-filter-search.mjs` › flow "servers-filter-search" (with no filter,
  all four rows including the 0-player C are listed). Also unit `list-filter.test.ts` › "no active
  filter lists every row, empty servers included" (D1).
- AC4 → e2e `scripts/flows/servers-filter-search.mjs` › flow "servers-filter-search" (search "cellar"
  finds the 0-player, stage-1-only C). Also unit `list-filter.test.ts` › "search matches server name
  or address for every row" (D1).
- AC5 → e2e `scripts/flows/servers-filter-search.mjs` › flow "servers-filter-search" (search "zulu" →
  B and D only). Also unit `list-filter.test.ts` › "search matches player names only where a roster
  was fetched" (D1), which covers the numeric-count and undefined cases the loopback fixture cannot
  produce.
- AC6 → e2e `scripts/flows/servers-filter-search.mjs` › flow "servers-filter-search" (the filtered
  subset follows the default order and then 119's changed sort, filter values survive a sort change,
  and the sort value survives clearing the filter). Also unit `list-filter.test.ts` › "filtering
  preserves the input order" (D1), and `ServersView.test.tsx` › "filtering narrows the rendered rows
  without changing the sort control" (D2).

No `manual residue`.

## Done

<!-- Filled by `/build 120`. -->
