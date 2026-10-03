---
id: 217
title: list sort and search are shared
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want clicking a column header to cycle the same way in every list, and a quoted
search to mean "exactly this" in the demo list as it does in the server list. As the maintainer I
want one column-sort and one search-term implementation, so that a tweak is done and tested once
and the `null`-vs-`undefined` glue between persisted sort and view disappears.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F47):
`src/shared/servers/list-sort.ts` and `src/shared/replays/list-sort.ts` each define their own
`compareStrings`, `NATURAL_DIRECTION`, favourite-first comparator, unknown-last rule and a 9-line
`nextSort` identical except for the off-sentinel (`undefined` vs `null`); `player-sort.ts` and
config's `alias-rows.ts` add a third and fourth direction type. The servers persisted type is
`listSort?:` while handlers answer `?? null` and `ServersView` converts back. Servers' search
supports quoted exact match (story 195), replays' does not; each has its own
`matchesText`/`isFilterActive`.

## Acceptance Criteria

- [ ] **AC1** — `src/shared/list/sort.ts` exports `ListSort<C>`, `SortDirection`, a generic
      `nextSort`, `compareBy`/`createColumnSorter` with the favourite-first and unknown-last
      rules; `src/shared/list/search.ts` exports `matchesTerm` with plain and quoted modes; both
      are unit-tested.
- [ ] **AC2** — servers, replays, player-sort and alias-rows are re-expressed on top of them; the
      existing list-sort tests (118 + 219 lines) pass unchanged as the regression gate; no file
      outside `src/shared/list` declares its own `nextSort` or `compareStrings`.
- [ ] **AC3** — The "no sort" sentinel is `null` end to end (persisted type, handler, view); the
      `ServersView` mapping is deleted.
- [ ] **AC4** — The demo list accepts a quoted search term with the same semantics as the server
      list; the search placeholder says so (i18n key); a replays flow covers it.
- [ ] **AC5** — `servers-sort-order`, `replays-*` sort/filter flows pass.

## Open Questions

- none

## Decisions (Sprint)

- **AC2 vs AC3 on the servers test.** The only edits allowed in `src/shared/servers/list-sort.test.ts`
  are the sentinel ones (`undefined` → `null`, `toBeUndefined()` → `toBeNull()`); no ordering
  expectation changes — AC3 demands the null sentinel, and AC2's intent is the ordering gate.
  `src/shared/replays/list-sort.test.ts` stays byte-identical.
- **"Declares its own `nextSort`/`compareStrings`" means an implementation.** Servers and replays
  keep exporting `nextSort`/`NATURAL_DIRECTION`/`sort*Rows` as bindings produced by the shared
  `createColumnSorter`, so the regression tests keep their imports; a `function nextSort`/
  `compareStrings` body outside `src/shared/list` fails a new rule in `src/architecture.test.ts`.
- **Favourite pinning is an option, not a rule.** `createColumnSorter` takes `pinFavourites`:
  servers pin under a column sort, replays only in the default order — both are shipped, tested
  behaviour (stories 118/152) and the story is a refactor.
- **Null end to end covers both slices.** Servers and replays persisted types become
  `listSort: X | null` (default `null`, absent/malformed on disk parses to `null`, a cleared sort is
  written as `null`), and `src/main/lib/list-sort.ts`'s `setOrClearListSort` is deleted — both
  slices share that helper, and keeping one slice on `?:` would keep the glue the story removes.
- **The player roster cycles like every list.** `ServerPlayersPanel` uses the shared three-click
  `nextSort`; the third click returns to its default (score descending) — the requirement's first
  sentence asks for one cycle everywhere.
- **The Aliases tab keeps its single asc/desc toggle.** It is a toggle button, not a column header;
  it only adopts `SortDirection` and `compareStrings` (case-insensitive, now numeric-aware like
  every other list).
- **Quoted demo search = whole-value equality over the fields plain search reads.** Name, file name,
  map, description, each tag, each sidecar/header/name-fact player; same parse as story 195 (trimmed
  term ≥3 chars wrapped in `"`, inner text case-insensitive and not trimmed).
- **`matchesTerm(term, values)`** takes the candidate strings (`null`/`undefined` skipped), so each
  list only names its fields; the duplicated select-equality `matchesText` moves to
  `src/shared/list/search.ts` as `equalsIgnoreCase`. `isFilterActive`/`isDemoFilterActive` stay
  per list — their filter shapes differ.
- **AC4 placeholder** reuses the existing key `replays.filter.searchPlaceholder` with the servers'
  wording pattern ("Name, map or player — \"quotes\" for exact"); a new key would orphan the old one.
- **AC4 flow** is a new `scripts/flows/replays-quoted-search.mjs` on the existing
  `writeReplaysFilterFixture` (one flow per story; flows never import each other).
- **Changelog:** one `### Changed` line — quoted demo search plus the roster's third click.

## Plan

1. **D1** builds `src/shared/list/{sort,search}.ts` with unit tests — the generic API every list
   is re-expressed on.
2. **D2** moves the servers list sort onto it with `null` as the off-sentinel and deletes the
   `ServersView` `undefined` mapping.
3. **D3/D4** make `listSort` `X | null` in the servers and replays main slices (persisted + handler),
   then delete `setOrClearListSort`.
4. **D5** moves replays sort, player-sort (three-click cycle) and alias-rows onto the shared sort
   and adds the architecture rule that no other file implements `nextSort`/`compareStrings`.
5. **D6** moves both searches onto `matchesTerm`, gives demos the quoted mode, updates the
   placeholder, adds the replays flow and the changelog line.

Order: D1 → D2 → D3 → D4 → D5 → D6 (D3 before D4 because D4 deletes the helper D3 stops using).
No systems doc covers servers/replays sort (`docs/systems/` has none), so no doc D.

## Deliverables

- **D1 — shared sort and search primitives.** New `src/shared/list/sort.ts`: `SortDirection`
  (`'asc'|'desc'`), `ListSort<C extends string>` (`{ column: C; direction: SortDirection }`),
  `compareStrings(a, b)` (`localeCompare(b, 'en', { sensitivity: 'base', numeric: true })` — lift
  it verbatim from `src/shared/servers/list-sort.ts:51`), `compareFavouriteFirst(a, b)` over
  `{ favourite: boolean }`, generic `nextSort<C>(current: ListSort<C> | null, column: C, natural:
  Record<C, SortDirection>): ListSort<C> | null` (different column/none → natural; same column at
  natural → reversed; reversed → `null`), `compareBy(a, b, spec, direction)` where
  `spec = { isUnknown(x): boolean; compareKnownAscending(a, b): number }` — an unknown sorts after
  every known value in **both** directions, two unknowns return 0 so the caller's tie-break runs —
  and `createColumnSorter<T, C>({ columns: Record<C, spec>, natural, defaultCompare, tieBreak,
  pinFavourites: boolean })` returning `{ sortRows(rows, sort: ListSort<C> | null): T[] (copy, never
  mutates), nextSort(current, column) }`; `pinFavourites` applies `compareFavouriteFirst` before the
  column compare (the default order is `defaultCompare` alone). Shape it on the two existing
  engines: `src/shared/servers/list-sort.ts` (`compareColumn`, favourites pinned) and
  `src/shared/replays/list-sort.ts` (`COLUMN_SPECS`/`compareColumn`, no pinning) — it must express
  both without changing either order. New `src/shared/list/search.ts`: `matchesTerm(term, values:
  Iterable<string | null | undefined>): boolean` — trimmed empty term → `true`; quoted mode exactly
  as `src/shared/servers/list-filter.ts:60-70` (trimmed, ≥3 chars, starts and ends with `"`, inner
  lower-cased and not trimmed, equality with a whole value); otherwise case-insensitive substring;
  never throws; plus `equalsIgnoreCase(value: string | null | undefined, filter: string)`. Pure
  (`src/shared` rules: no node/DOM/electron). Tests in `src/shared/list/sort.test.ts` and
  `src/shared/list/search.test.ts` (names under Acceptance Tests).
- **D2 — servers list sort on the shared sorter, `null` sentinel.** `src/shared/servers/list-sort.ts`
  keeps exporting `SERVER_SORT_COLUMNS`, `NATURAL_DIRECTION`, `ServerSortColumn`, and
  `ServerListSort = ListSort<ServerSortColumn>`, `ServerSortDirection = SortDirection` (aliases, so
  `src/shared/modules/servers.ts:21`'s re-export keeps compiling), plus `sortServerRows`/`nextSort`
  as the bindings of a `createColumnSorter` with `pinFavourites: true` and its own `compareDefault`
  as both default and tie-break; its private `compareStrings`/`compareFavourite` go. The off value is
  `null`. In `src/shared/servers/list-sort.test.ts` change only `undefined` → `null` and
  `toBeUndefined()` → `toBeNull()` — no other edit. `src/renderer/src/modules/servers/ServersView.tsx`:
  `useState<ServerListSort | null>(null)`, the load/save callbacks take `result.value` as-is (delete
  the `!== null ? … : undefined` mapping at ~L307-325 and `next ?? null`), caption checks
  `sort === null`; `ServerListHeader.tsx`'s `sort` prop becomes `ServerListSort | null`. Proven by
  the unchanged-order servers list-sort tests and the `servers-sort-order` flow.
- **D3 — servers main slice stores `null`.** `src/shared/modules/servers.ts` `ServersState.listSort:
  ServerListSort | null`; `src/main/modules/servers/persisted.ts` (~L168-195) parses absent/malformed
  to `null` and always returns the key (default state carries `listSort: null`);
  `src/main/modules/servers/index.ts:287-289` returns `servers.get().listSort` and sets with
  `servers.update((live) => ({ ...live, listSort: payload.sort })).listSort` — no `?? null`, no
  `setOrClearListSort`. Update `src/main/modules/servers/persisted.test.ts` (~L322-357) and
  `index.test.ts` (~L605-625) from `toBeUndefined()` to `toBeNull()`, plus one new persisted test:
  a state written with a cleared sort reloads as `null`.
- **D4 — replays main slice stores `null`; helper deleted.** Same change as D3 for replays:
  `src/shared/modules/replays.ts` state type, `src/main/modules/replays/persisted.ts` (~L33, L130-150),
  `src/main/modules/replays/index.ts` (~L530-548, drop the `setOrClearListSort` import and the
  `?? null`s), tests `persisted.test.ts` (~L111-138) and `index.test.ts` (~L278-347; the raw-JSON
  check at ~L347 now expects `null`). Delete `src/main/lib/list-sort.ts` and
  `src/main/lib/list-sort.test.ts` (no other caller — grep `setOrClearListSort` to confirm zero hits).
- **D5 — replays sort, player sort and alias rows on the shared sort, plus the rule.**
  `src/shared/replays/list-sort.ts`: keep the exported names (`DEMO_SORT_COLUMNS`, `NATURAL_DIRECTION`,
  `DemoSortFields`, `sortDemoRows<T>(rows, sort, fields)`, `nextSort`, `DemoListSort =
  ListSort<DemoSortColumn>`, `DemoSortDirection = SortDirection`) but build them on
  `createColumnSorter` with `pinFavourites: false`; `COLUMN_SPECS` become shared specs; private
  `compareStrings`/`compareFavouriteFirst` go; `src/shared/replays/list-sort.test.ts` must pass
  byte-unchanged. `src/shared/servers/player-sort.ts`: `SortDir` → `SortDirection` (re-export is not
  needed — update `ServerPlayersPanel.tsx`), `sortPlayers(players, key, dir)` keeps its signature and
  stable index tie-break but compares through `compareBy` (malformed = unknown) and `compareStrings`;
  expose `PLAYER_NATURAL_DIRECTION: Record<PlayerSortKey, SortDirection>`.
  `src/renderer/src/modules/servers/ServerPlayersPanel.tsx`: the header click uses shared
  `nextSort(current, key, PLAYER_NATURAL_DIRECTION)` and maps `null` to `DEFAULT_PLAYER_SORT`
  (third click → score descending); add that case to `ServerPlayersPanel.test.tsx`.
  `src/renderer/src/modules/config/lib/alias-rows.ts`: `AliasSortDirection` → `SortDirection`
  (update `AliasesTab.tsx`'s import), name compare through `compareStrings`; the reverse-for-desc
  stays. Add to `src/architecture.test.ts` a test that scans `src/**/*.{ts,tsx}` outside
  `src/shared/list/` and fails on `function nextSort`, `function compareStrings` or
  `const compareStrings` (regex on source text, the same file-walking the existing layering tests use).
- **D6 — shared search, quoted demo search.** `src/shared/servers/list-filter.ts`: `matchesSearch`
  calls `matchesTerm(term, [row.name, row.address, ...(Array.isArray(row.players) ?
  row.players.map((p) => p.name) : [])])`; its `matchesText` → `equalsIgnoreCase`.
  `src/shared/replays/list-filter.ts`: `matchesDemoSearch` calls `matchesTerm` over name, fileName,
  map, sidecar description, each sidecar tag, each sidecar side player, each header player, each
  name-fact player (quoted = exact whole value of any of them); `matchesText` → `equalsIgnoreCase`;
  update its doc comment. Add quoted-mode cases to `src/shared/replays/list-filter.test.ts`; existing
  servers/replays filter tests stay green. `src/renderer/src/i18n/locales/en.json`
  `replays.filter.searchPlaceholder` → `Name, map or player — "quotes" for exact` (mirror the
  `servers.filter.searchPlaceholder` entry ~L1039). New flow `scripts/flows/replays-quoted-search.mjs`:
  setup/teardown and helpers copied from `scripts/flows/replays-filter-search.mjs` (flows never
  import each other; seed with `writeReplaysFilterFixture`, constants from `scripts/lib/fixture.mjs`
  ~L2543-2600); assert in `replays-filter-search`'s `replays-filter-search` box: the placeholder
  contains `"quotes"`; an unquoted term matches ≥2 demos; the same text quoted matches exactly the
  demo(s) whose whole field equals it; a quoted partial word matches none. Pick terms from the
  existing fixture constants (e.g. map `q2ctf5` vs `q2ctf`); add a constant to `fixture.mjs` only if
  none fits. `CHANGELOG.md` under `## Unreleased` `### Changed`: `- **Demos** — Put a search term in
  quotes to match it exactly; a third click on a player column resets its sort.`

## Model Hints

- D1 → deliverable-hard — the generic sorter has to reproduce two existing, subtly different engines
  (servers pin favourites under a column sort with a mixed string/number compare and a default-order
  tie-break; replays don't pin, use a composite favourite+rating "known" order and a date/id
  tie-break) without changing either order, and every later D builds on its API.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/shared/list/sort.test.ts` › "nextSort cycles natural, reversed, null",
  "compareBy puts unknowns last in both directions", "createColumnSorter pins favourites only when
  asked", "sortRows never mutates its input"; unit `src/shared/list/search.test.ts` › "an empty term
  matches everything", "a plain term is a case-insensitive substring", "a quoted term matches a whole
  value only", "an unclosed, empty or single-quoted term is plain text"
- AC2 → unit `src/shared/servers/list-sort.test.ts` (sentinel-only edit) and
  `src/shared/replays/list-sort.test.ts` (unchanged) as the regression gate; unit
  `src/shared/servers/player-sort.test.ts` (unchanged); unit
  `src/renderer/src/modules/config/lib/alias-rows.test.ts` (unchanged); component
  `src/renderer/src/modules/servers/ServerPlayersPanel.test.tsx` › "a third click on a column returns
  to score descending"; unit `src/architecture.test.ts` › "no file outside src/shared/list implements
  nextSort or compareStrings"
- AC3 → unit `src/main/modules/servers/persisted.test.ts` › "a cleared list sort reloads as null"
  and the existing listSort cases now expecting `null`; unit `src/main/modules/servers/index.test.ts`
  and `src/main/modules/replays/index.test.ts` listSort cases expecting `null`; e2e
  `npm run ui:flow -- servers-sort-order` (view loads and saves `null` without a mapping)
- AC4 → unit `src/shared/replays/list-filter.test.ts` › "a quoted search matches a whole field
  exactly"; e2e `npm run ui:flow -- replays-quoted-search`
- AC5 → e2e `npm run ui:flow -- servers-sort-order`, `npm run ui:flow -- replays-sort-order`,
  `npm run ui:flow -- replays-filter-search`, `npm run ui:flow -- servers-filter-search`,
  `npm run ui:flow -- servers-quoted-search`

Coverage: AC1 ← D1 · AC2 ← D2 + D5 · AC3 ← D2 (view) + D3 + D4 · AC4 ← D6 · AC5 ← D2, D5, D6.

## Done

<!-- Filled by /build 217. -->
