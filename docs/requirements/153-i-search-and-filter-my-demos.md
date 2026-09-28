---
id: 153
title: I search and filter my demos
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

"Every CTF demo on q2ctf5 where I played against Tom" — a user narrows the library down the way the
server browser narrows servers ([[120]]): dropdowns for mod, gamemode and map, a favourites toggle,
a minimum rating, tags, and one search field that finds a player name wherever it was recorded
(concept `docs/concepts/demo-browser.md` §10, DEMO-17, DEMO-18). The date filter is its own story,
[[154]].

The filter engine mirrors or generalises `src/shared/servers/list-filter.ts` (§14) and runs on
effective values ([[148]]). Nothing is hidden until the user asks for it.

## Acceptance Criteria

- [ ] **AC1** — Full-text search matches, case-insensitively, the sidecar name, description and
      tags, player names **from every source** (sidecar sides, parsed configstrings, name facts), the
      map and the file name.
- [ ] **AC2** — Mod, gamemode and map filters are dropdowns filled from the values present in the
      current list (like the servers `filterOptions`).
- [ ] **AC3** — A favourites-only toggle shows only favourite demos.
- [ ] **AC4** — A "rating ≥ n" filter shows only demos rated n or higher; unrated demos are excluded
      while it is set.
- [ ] **AC5** — A tag filter shows only demos carrying at least one of the chosen tags (OR).
- [ ] **AC6** — Filters and search combine with AND; a "Showing X of Y" count, a clear-all action
      and a no-match state are shown.
- [ ] **AC7** — Filtering applies after the sort ([[152]]) and does not change it.
- [ ] **AC8** — The filter engine is pure shared code with unit tests; the decision to generalise
      `list-filter.ts` or mirror it is recorded in the plan.

## Open Questions

- [x] ~~**Q1 — Several tags** — any of them (OR) or all of them (AND)?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Remembered filters** — do filters survive leaving the view / restarting, or reset?~~
      answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Several tags match with OR — a demo matches if it carries at least one of the chosen
  tags.
- **(User)** Filters (search text, dropdowns, favourites/rating/tags) persist across leaving the view
  and across app restarts, stored alongside the sort choice in the module's state key ([[142]]).
- **Mirror, not generalise (AC8).** A new `src/shared/replays/list-filter.ts` mirrors
  `src/shared/servers/list-filter.ts`'s shape and leaves the servers file untouched — the two
  criteria sets share only a dedupe helper and a case-insensitive compare, so generalising would put
  a finished module at risk for no shared logic.
- **The engine takes its own narrow input** (`DemoFilterSubject`), built from [[150]]'s row by one
  pure adaptor — this keeps the engine independent of the exact row field names 150 picks.
- **"Players from every source" means every rung, not the effective one** — sidecar side players,
  header players and name-fact players are all searched, because the effective `sides` keeps only
  the winning rung and would hide the header's names once a sidecar has sides.
- **The row must carry the raw sources.** If the row after [[150]]/[[152]] does not expose header
  players and the sidecar's description/tags, D1 adds them. A cache entry written without header
  players counts as a miss — otherwise unchanged files would never gain them.
- **The other searched fields are the effective name, map and mod plus the file name.** Team names
  and host are not searched, because AC1 lists its fields exhaustively and [[148]] makes effective
  values the basis.
- **Search is one trimmed, case-insensitive substring term** with no tokenising, matching servers'
  `matchesSearch` so both browsers behave the same.
- **Dropdown options come from the whole indexed list, not the filtered subset.** They are deduped
  case-insensitively, and a persisted value that is no longer present stays selectable. This is
  servers parity, and choosing one filter does not collapse the others' options.
- **Gamemode reuses [[149]]'s `gamemodeFilterMatches` / `gamemodeFilterOptions`** with
  `excludeGuessed: false`, labelled via `describeGamemode`. The code already exists, and a
  "hide guessed" control is not in this story's criteria.
- **Rating is a select** ("Any", 1–10). While it is set, a demo without a sidecar rating is excluded
  (AC4). Favourites-only means sidecar `favourite === true`.
- **The tag filter is a checkbox list** of every distinct tag in the list, matched
  case-insensitively, built from the existing `Checkbox` primitive with a `min-h-11` wrapper. The
  primitive meets the 44px floor, so no new component and no CLAUDE.md deviation is needed.
- **Count, clear-all and no-match follow servers' behaviour.** "Showing X of Y" shows and clear-all
  is enabled only while a filter is active. The no-match state (with a clear button) shows when the
  library has demos but none match, and the empty-library state stays [[151]]'s.
- **Persistence writes are debounced.** The renderer writes the filter debounced by 300 ms and
  flushes it on unmount, and the view renders rows only after the persisted filter has been read.
  This avoids a disk write per keystroke and a flash of rows the user had filtered out.
- **The persisted filter is parsed forgivingly.** On read from `state.json` it degrades to the
  empty filter; the IPC payload is validated strictly with zod. This is the same split
  `parseReplaysState` already uses for its other keys.
- **The filter shape leaves room for [[154]].** 154 adds its date field to the same
  `DemoListFilter`, `EMPTY_DEMO_LIST_FILTER` and `isDemoFilterActive`, so the clear-all and AND
  rules cover it for free.
- **Restart persistence is proven below the UI.** A main-side round-trip unit test covers the
  restart itself, and the e2e flow leaves the view, comes back, and checks `state.json`. The
  `ui:flow` harness has no app relaunch.

## Plan

1. **D1 — row data (shared + main, verify-or-add).** Make sure every list row carries what the
   search needs: header players (raw), plus the sidecar's description, tags, favourite and rating.
   Treat a cache entry without header players as a miss.
2. **D2 — engine (shared, pure).** Add `src/shared/replays/list-filter.ts` with `DemoListFilter`,
   `EMPTY_DEMO_LIST_FILTER`, `isDemoFilterActive`, `matchesDemoSearch`, `matchesDemoFilter`,
   `filterDemos` (order-preserving), `demoFilterOptions` and a zod `demoListFilterSchema`. Add unit
   tests.
3. **D3 — persistence (shared + main).** Store the filter in `ReplaysState` next to [[152]]'s sort,
   with a forgiving parse and an IPC read/write on 152's list-view channel (or its own if 152's is
   sort-specific). Add unit tests.
4. **D4 — filter rail (renderer component).** Add `DemoListFilterBar.tsx`, controlled, mirroring
   `ServerListFilterBar.tsx`, plus i18n keys and a component test.
5. **D5 — wiring + e2e.** In `ReplaysView`, apply `filterDemos(sorted, filter)` after the sort, load
   and persist the filter, and show the count, clear-all and no-match state. Add the flow
   `replays-filter-search` with a flow-owned demo folder (real headers plus sidecars) and a
   CHANGELOG entry.

Order D1 → D5. D2 needs only D1's field names; D4 needs only D2.

## Deliverables

- [ ] **D1 — every searchable source is on the row (verify-or-add).**
  - First read `src/shared/modules/replays.ts` (`discoveredDemoSchema`, and whatever row type
    stories 150/152 added). Check that the row the Demos view renders has all of these:
    - (a) the demo header's raw player list, separate from any effective/merged `sides`
    - (b) the demo's validated sidecar fields, or at least `description`, `tags`, `favourite`,
      `rating` and `sides`, where a sidecar exists
    - (c) `nameFacts` (already present)
  - If all of them are present, this D is only writing down the field names (in the Done section)
    and needs no code.
  - Otherwise, add what is missing:
    - Header players: add a `headerPlayers: z.array(z.string())` field (empty for an unreadable
      row or a zip entry without a parse). Fill it from the parsed header in
      `src/main/modules/replays/scan-service.ts` (the facts it caches next to `map`), in
      `zip-demos.ts` (entry parse) and in `discovery.ts` (neutral `[]`), and map it through in
      `index.ts`.
    - Cache staleness: `index-cache.ts` / `scan-service.ts` must treat a cached fact without
      `headerPlayers` as a cache miss, so it is re-parsed once. Otherwise an unchanged file would
      never gain players.
    - Sidecar fields: attach the validated fields the same way 150 attaches favourite/rating. If
      150 attached nothing, add `sidecar: sidecarFieldsSchema.partial().nullable()` to the row,
      filled from `sidecar-read.ts` during index read.
  - Tests: `src/main/modules/replays/scan-service.test.ts` › "a row carries the header's player
    names" and › "a cached fact without header players is re-parsed". Only if the sidecar field was
    added here: `index.test.ts` › "a row carries its sidecar's description and tags".
  - Files (at most): `src/shared/modules/replays.ts`, `src/main/modules/replays/{scan-service,
    index-cache,zip-demos,discovery,index}.ts` and their tests.
  - Mirror: how `map`/`unparsableReason` flow from header parse to row today.
  - Acceptance: `npx vitest run src/main/modules/replays src/shared/modules` passes;
    `npm run typecheck` is clean.

- [ ] **D2 — the pure filter engine plus its unit tests.**
  - Create `src/shared/replays/list-filter.ts`. It is pure: no `node:*`, no DOM, no IPC. Mirror the
    shape and doc style of `src/shared/servers/list-filter.ts`, and do not edit that file.
  - Input type:
    `DemoFilterSubject { fileName: string; name: string | null; map: string | null; mod: string |
    null; gamemode: EffectiveGamemode; sidecar: { description?: string; tags?: string[];
    favourite?: boolean; rating?: number; sides?: { players: string[] }[] } | null; headerPlayers:
    readonly string[]; namePlayers: readonly string[] }`
    - `name`, `map` and `mod` are the **effective** values (`src/shared/demos/effective-values.ts`).
    - `EffectiveGamemode` comes from `src/shared/demos/gamemode.ts`.
  - Filter shape:
    `DemoListFilter { search: string; mod: string | null; gamemode: string | null; map: string |
    null; favouritesOnly: boolean; minRating: number | null; tags: string[] }`
    - `EMPTY_DEMO_LIST_FILTER` is the all-inactive filter.
    - `isDemoFilterActive(f)` does not count a whitespace-only search.
    - `demoListFilterSchema` (zod) caps: search ≤ 200 chars; mod/map/gamemode ≤ 64; minRating an
      int 1–10 or null; tags ≤ 50 entries of 1–40 chars.
  - `matchesDemoSearch(s, term)`:
    - The term is trimmed and lower-cased; an empty term matches everything.
    - It is a substring match against `name`, `fileName`, `map`, `sidecar.description`, every
      `sidecar.tags` entry, every player of every `sidecar.sides`, every `headerPlayers` entry and
      every `namePlayers` entry.
    - Never throws on missing parts.
  - `matchesDemoFilter(s, f)`, AND of:
    - search
    - mod and map: case-insensitive equality; an unknown value never matches a set filter
    - gamemode: via `gamemodeFilterMatches(s.gamemode, { gamemode: f.gamemode, excludeGuessed:
      false })`
    - `favouritesOnly`: `sidecar?.favourite === true`
    - `minRating`: `sidecar?.rating !== undefined && rating >= minRating`, so unrated demos are
      excluded
    - `tags`: when non-empty, the demo carries at least one of them, case-insensitively (OR)
  - `filterDemos<T>(rows, f, toSubject: (row: T) => DemoFilterSubject): T[]` preserves input order
    and never sorts.
  - `demoFilterOptions(subjects)` returns `{ mods, maps, gamemodes, tags }`:
    - distinct, case-insensitive dedupe (first spelling wins), sorted with `localeCompare`
    - gamemodes come via `gamemodeFilterOptions`
  - Also export a pure adaptor `demoFilterSubject(row)` from the row type D1 established.
    - It resolves effective values with `resolveEffectiveValues` (or reuses the row's
      already-resolved values if 150 put them there).
    - Put it in the same file if the row type is importable from `src/shared`.
  - Tests in `src/shared/replays/list-filter.test.ts`:
    - "search matches every field case-insensitively" — name, file name, map, description, tag
    - "search finds a player from every source" — a subject whose sidecar sides name "Tom" while
      the header names "Rex" and the name facts "Zed": each of the three is found
    - "each filter applied alone keeps exactly the rows that satisfy it" — mod, gamemode incl. a
      guessed value, map, favouritesOnly, minRating
    - "a rating filter excludes unrated demos"
    - "several tags match with OR"
    - "active filters intersect" — incl. a combination giving an empty result
    - "no active filter lists every row" — incl. a whitespace-only search
    - "filtering preserves the input order"
    - "filter options are distinct, case-insensitive and sorted"
    - "the filter schema accepts the empty filter and rejects out-of-range values"
  - Acceptance: `npx vitest run src/shared/replays/list-filter.test.ts` passes; typecheck is clean.

- [ ] **D3 — the filter is persisted next to the sort choice.**
  - Read how story 152 persisted its sort choice: a field on `ReplaysState` in
    `src/main/lib/schemas.ts`, plus a `REPLAYS_HANDLERS` entry in `src/shared/modules/replays.ts`
    handled in `src/main/modules/replays/index.ts`. Mirror it exactly.
  - Add `listFilter: DemoListFilter` to `ReplaysState`, beside the sort.
    - `parseReplaysState` parses it forgivingly with `demoListFilterSchema.safeParse`.
    - A missing or invalid value degrades to `EMPTY_DEMO_LIST_FILTER`, and the sibling keys
      survive.
  - IPC:
    - If 152's channel carries a whole list-view object (e.g. `{ sort }`), add `filter` to that
      object and its schema.
    - Otherwise, add `listFilter.read` (`z.void()`) and `listFilter.write`
      (`z.object({ filter: demoListFilterSchema }).strict()`) to `REPLAYS_HANDLERS` and
      `REPLAYS_HANDLER_SCHEMAS`.
    - The handler persists via `app.state.setReplaysState({ ...current, listFilter })` and returns
      what was stored.
  - Tests:
    - `src/main/lib/schemas.test.ts` (or the file testing `parseReplaysState`) › "the demo list
      filter round-trips through state.json" and › "an invalid stored filter degrades to the empty
      filter".
    - `src/shared/modules/replays.test.ts` stays green (every handler has a schema).
  - Files: `src/main/lib/schemas.ts` (+ test), `src/shared/modules/replays.ts`,
    `src/main/modules/replays/index.ts` (+ `index.test.ts` if 152 tested its handler there).
  - Acceptance: `npx vitest run src/main src/shared/modules` passes; typecheck is clean.

- [ ] **D4 — the demo filter rail (controlled component).**
  - Create `src/renderer/src/modules/replays/DemoListFilterBar.tsx` with props
    `{ filter: DemoListFilter, onChange, options: { mods, maps, gamemodes, tags }, shown, total }`.
    Mirror `src/renderer/src/modules/servers/ServerListFilterBar.tsx`: layout, the
    `nullableOptions` helper (copy it; keep the stale current value), `Input`/`Select`/`Field` from
    `components/ui/controls.tsx`, `Button`. Use semantic tokens only; no hex, no raw palette
    classes.
  - Controls and testids:
    - `replays-filter-search`: `type="search"` with an aria-label.
    - `replays-filter-mod`, `replays-filter-gamemode`, `replays-filter-map`: selects whose first
      option is "Any" → `null`.
      - Gamemode option labels: `describeGamemode({ value, source: 'sidecar' })` label key, or the
        free text verbatim.
    - `replays-filter-favourites`: `Checkbox` with `className="min-h-11"`.
    - `replays-filter-rating`: Select, "Any" → `null`, then 1–10 labelled `replays.filter.ratingAtLeast`.
    - `replays-filter-tags`: a group (`role="group"`, labelled) of `Checkbox`es, `min-h-11`, one
      per `options.tags`, each `data-testid="replays-filter-tag"` with `data-tag`, plus the stale
      selected tags.
      - Toggling a tag adds or removes it from `filter.tags`.
      - With no tags in the list, a muted `replays.filter.noTags` line shows instead.
    - `replays-filter-clear`: disabled while `!isDemoFilterActive`; sets `EMPTY_DEMO_LIST_FILTER`.
    - `replays-filter-count`: `replays.filter.count` ("Showing {{shown}} of {{total}}"), only while
      a filter is active.
  - Add `replays.filter.*` keys to `src/renderer/src/i18n/locales/en.json`: title, search,
    searchPlaceholder, any, mod, gamemode, map, favourites, rating, ratingAtLeast, tags, noTags,
    clear, count, noMatch. Demo data (map, mod, tag, player text) is never translated.
  - Tests in `DemoListFilterBar.test.tsx`:
    - "each control writes its own field into the filter"
    - "tags toggle in and out of the chosen set"
    - "clear resets every field and the count shows only while filtering"
  - Acceptance: `npx vitest run src/renderer/src/modules/replays` passes; typecheck is clean.

- [ ] **D5 — the Demos view filters its list, proven on the real surface.**
  - Client: in `src/renderer/src/modules/replays/client.ts`, add typed wrappers for D3's
    read/write (or extend 152's).
  - `ReplaysView.tsx` (on top of whatever 150/151/152 render):
    - Hold `filter` state. Read the persisted filter on mount together with the index; rows render
      only once both have resolved, and until then the view is in its loading state.
    - Persist every change through D3's write, debounced by 300 ms, and flush a pending write on
      unmount.
    - `visible = filterDemos(sortedRows, filter, demoFilterSubject)`: after 152's sort, never
      touching the sort state (AC7).
    - `options = demoFilterOptions(allRows.map(demoFilterSubject))`, taken from the whole list.
    - Render `<DemoListFilterBar>` in an `aside` rail left of the list, like `ServersView`'s.
    - Pass `shown = visible.length` and `total = allRows.length`.
    - When `allRows` is non-empty but `visible` is empty, render `replays-filter-no-match`
      (`replays.filter.noMatch` + a `replays-filter-no-match-clear` button).
    - 151's empty/loading/error states are unchanged.
    - If 150's row selection exists, a selected row that is filtered out gets deselected.
  - Tests in `ReplaysView.test.tsx` (mocked client):
    - "filtering narrows the rows without changing the sort"
    - "a filter matching nothing shows the no-match state, not the empty state"
    - "the persisted filter is applied before the first rows render"
  - Fixture, in `scripts/lib/fixture.mjs`:
    - Export `replaysFilterFixturePath()` (`<gameRoot>/filter-demos`) and
      `writeReplaysFilterFixture()` / `removeReplaysFilterFixture()`, called only from the flow's
      own `setup()`/`teardown()`. Mirror `writeReplaysZipPackArchive`'s regression note: never
      write it into a shared folder.
    - Copy the real `docs/fixtures/demos/test.dm2` / `PFAU_20221127-053327_q2dm1.mvd2` under a few
      names, plus `.json` sidecars, so the set covers:
      - one favourite rated 9, mod/gamemode `ctf`, map `q2ctf5`, tags `final`,`lan`, sidecar side
        player "Tom"
      - one non-favourite rated 5, tag `fun`, description containing a unique word
      - one unrated demo without a sidecar whose only match for a unique term is a **header**
        player of the real file (take the name from the rendered row or the header tests)
      - one demo whose name-template facts give a player
    - Seed the variant with that folder as an extra folder via `writePopulatedFixture({ variant,
      stateOverrides })`. Check how `stateOverrides` merges `replays`.
  - Flow `scripts/flows/replays-filter-search.mjs` (flow name `replays-filter-search`), mirroring
    `scripts/flows/replays-zip-entries.mjs` (setup/teardown hooks, scan wait) — copy, do not import.
    Each step asserts the visible row set:
    - AC1: search by the sidecar name, the description word, a tag, the sidecar player "tom"
      (lower-case), the header player, the name-fact player, the map and a file-name fragment.
    - AC2: the mod/gamemode/map dropdown options equal the values present.
    - AC3: favourites-only.
    - AC4: rating ≥ 6 → only the 9, and the unrated demo is gone.
    - AC5: two tags → the union.
    - AC6: combine map + tag → the intersection; the count reads "Showing X of Y"; a no-match
      combination shows the no-match state; clear-all restores every row.
    - AC7: under a filter, the visible rows keep 152's order (a subsequence of the unfiltered
      order), and the sort control's value is unchanged.
    - Persistence: set a filter, navigate to another view and back → the filter controls and rows
      are restored. The variant's `state.json` holds the filter under the `replays` key.
    - Screenshots per phase.
  - `CHANGELOG.md`: one `### Added` entry.
  - Files: `client.ts`, `ReplaysView.tsx`, `ReplaysView.test.tsx`, `scripts/lib/fixture.mjs`,
    `scripts/flows/replays-filter-search.mjs`, `CHANGELOG.md`.
  - Acceptance: `npx vitest run src/renderer/src/modules/replays` passes and
    `npm run ui:flow -- replays-filter-search` passes with its screenshots.

## Model Hints

- D1–D5 → default tier.
  - D2 is a pure predicate module pinned by named per-filter tests.
  - D1's one subtlety (a stale cache entry without players) is spelled out and has its own test.
  - D3 mirrors 152's persistence exactly.
  - D4/D5 follow story 120's filter-bar/flow pattern.
- Review: → default. The plausible wrong implementation is searching only the effective `sides`
  (first rung) instead of every player source. That is caught by D2's "search finds a player from
  every source" test and by the flow's header-player step, so a second hard pass buys nothing.

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-filter-search.mjs` › flow "replays-filter-search" (each searched
  field incl. sidecar, header and name-fact players finds its demo, case-insensitively). Also unit
  `src/shared/replays/list-filter.test.ts` › "search matches every field case-insensitively" and ›
  "search finds a player from every source" (D2), and
  `src/main/modules/replays/scan-service.test.ts` › "a row carries the header's player names" (D1).
- AC2 → e2e `scripts/flows/replays-filter-search.mjs` › flow "replays-filter-search" (dropdown options
  equal the values present; each dropdown alone narrows). Also unit `list-filter.test.ts` › "filter
  options are distinct, case-insensitive and sorted" (D2), and `DemoListFilterBar.test.tsx` › "each
  control writes its own field into the filter" (D4).
- AC3 → e2e `scripts/flows/replays-filter-search.mjs` › flow "replays-filter-search" (favourites-only
  step). Also unit `list-filter.test.ts` › "each filter applied alone keeps exactly the rows that
  satisfy it" (D2).
- AC4 → e2e `scripts/flows/replays-filter-search.mjs` › flow "replays-filter-search" (rating ≥ 6 step,
  unrated demo gone). Also unit `list-filter.test.ts` › "a rating filter excludes unrated demos" (D2).
- AC5 → e2e `scripts/flows/replays-filter-search.mjs` › flow "replays-filter-search" (two tags → union).
  Also unit `list-filter.test.ts` › "several tags match with OR" (D2), and `DemoListFilterBar.test.tsx`
  › "tags toggle in and out of the chosen set" (D4).
- AC6 → e2e `scripts/flows/replays-filter-search.mjs` › flow "replays-filter-search" (intersection,
  "Showing X of Y", no-match state, clear-all). Also unit `list-filter.test.ts` › "active filters
  intersect" and › "no active filter lists every row" (D2), `DemoListFilterBar.test.tsx` › "clear
  resets every field and the count shows only while filtering" (D4), and `ReplaysView.test.tsx` › "a
  filter matching nothing shows the no-match state, not the empty state" (D5).
- AC7 → e2e `scripts/flows/replays-filter-search.mjs` › flow "replays-filter-search" (filtered rows
  keep the sort order; sort control unchanged). Also unit `list-filter.test.ts` › "filtering preserves
  the input order" (D2), and `ReplaysView.test.tsx` › "filtering narrows the rows without changing the
  sort" (D5).
- AC8 → unit `src/shared/replays/list-filter.test.ts` (the whole file, D2); the mirror-vs-generalise
  decision is recorded under Decisions (Sprint) and in the Plan.
- (User) persistence decision → unit `src/main/lib/schemas.test.ts` › "the demo list filter
  round-trips through state.json" and › "an invalid stored filter degrades to the empty filter" (D3).
  Also `ReplaysView.test.tsx` › "the persisted filter is applied before the first rows render" (D5),
  and the flow's leave-and-return + `state.json` step (D5).

No `manual residue`.

## Done

<!-- Filled by /build 153. -->
