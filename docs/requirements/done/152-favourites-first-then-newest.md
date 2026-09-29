---
id: 152
title: favourites first, then newest
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user opening the Demos view wants their favourite demos at hand and, below them, whatever was
recorded last. That is the default order: **favourites on top, then newest by effective date** — the
same pinning the server favourites have (concept `docs/concepts/demo-browser.md` §3, §10, DEMO-16).
Every column can be sorted instead, and the launcher remembers the user's choice.

## Acceptance Criteria

- [x] **AC1** — With no remembered choice, favourites come first, then all demos newest first by
      effective date ([[148]]); within the favourites, newest first too.
- [x] **AC2** — Every column of the row ([[150]]) can be sorted ascending and descending.
- [x] **AC3** — The sort choice is stored in the module's state key ([[142]]) and restored on the
      next start.
- [x] **AC4** — Demos with an unknown value in the sorted column sort after all known values in
      both directions.
- [x] **AC5** — Favourites are not pinned under a user-chosen column sort (Decisions (Sprint)).
- [x] **AC6** — The sort is pure shared code with unit tests.

## Open Questions

- [x] ~~**Q1 — Pinning under a user sort** — do favourites stay on top when sorting by map or rating,
      or is pinning part of the default order only?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Pinning applies only to the default order. Any explicit column sort chosen by the user
  is a plain sort with no favourites pinning — the user's chosen order is unambiguous and pinning
  would fight with it.
- **Sort columns are `map`, `mod`, `players`, `date`, `duration`, `rating`** — the last being 150's
  combined favourite/rating column. Reason: AC2 says "every column of the row", and [[150]]'s (User)
  decision fixes exactly these six columns; secondary text and badges are not columns.
- **The sort reads a 152-owned flat shape `DemoSortFields`** (`id`, `favourite`, `rating`, `map`,
  `mod`, `players`, `date`, `durationMs`), which the renderer maps from 150's row model. Reason: 150
  is refined and built just before this story, so the pure sort must not depend on its view-model's
  field names, and a flat shape makes the unit tests trivial to write.
- **The favourite/rating column's value is the pair (favourite, rating):** favourite before
  non-favourite, then by rating; a demo with neither favourite nor rating is unknown. Reason: it is one
  column in 150, and ordering by that pair is what the cell shows; this is the column's own value, not
  the default-order pinning that AC5 excludes.
- **The players column sorts by the text the cell shows** (150's players/sides label); no sides =
  unknown. Reason: sorting by what the user reads is the only order that looks right in the list.
- **Text compare = `localeCompare(…, 'en', { sensitivity: 'base', numeric: true })`.** Reason:
  servers precedent (`src/shared/servers/list-sort.ts`), so `q2dm2` sorts before `q2dm10`.
- **Unknown = `null`/`undefined`, a blank string after trim, or a non-finite number**, always after
  every known value in both directions. Reason: AC4; mirrors 148's "has a value" rule.
- **Ties under a column sort fall back to date descending (unknown last), then `id` ascending — never
  to favourite.** Reason: a deterministic, total order that does not reintroduce the pinning AC5 rules
  out.
- **The default order breaks its final ties by `id` ascending.** Reason: a total order, so the list
  never reshuffles between renders.
- **Clicking a column header cycles natural direction → reverse → default order**, natural being
  ascending for `map`/`mod`/`players` and descending for `date`/`duration`/`rating`. Reason: servers
  precedent (`nextSort`), and the third click is the only way back to the default order.
- **Persisted as an optional `replays.listSort: { column, direction }` in `state.json`; absent means
  the default order; a malformed stored value parses to absent.** Reason: the concept's decision table ("Persistence") says module
  settings incl. remembered sort live in the module's key ([[142]]); servers' `listSort` is the
  additive, field-level-forgiving precedent, so no state-version bump.
- **IPC: `REPLAYS_HANDLERS.listGetSort = 'list.getSort'` and `listSetSort = 'list.setSort'`**
  (`{ sort: DemoListSort | null }`, `null` clears). Reason: servers precedent, contract-first.
- **"Restored on the next start" is proven by a page reload plus reading `state.json` off disk in the
  flow, and by a unit test of the forgiving parse.** Reason: that is the accepted proof of story 119's
  `servers-sort-order.mjs`; the renderer only ever gets the sort from main, which reads `state.json`
  at startup.
- **The header shows the active column with an arrow icon plus `aria-pressed`, and a visible
  "sort-current" text** ("Favourites first, then newest" in the default order). Reason: the servers
  header precedent; state never by colour alone.
- **Sorting happens in the renderer over the loaded rows (memoised), before virtualisation.**
  Reason: the full row set is already in the renderer for 150's virtualised list; low thousands sort
  in well under a frame.
- **CHANGELOG entry under `### Added`.** Reason: the order and the remembered column sort are
  user-visible.

## Plan

Triage: clear and ready — a pure sort module, a persisted setting on the servers pattern, and header
wiring into 150's list.

1. **D1 — pure sort** `src/shared/replays/list-sort.ts` (mirror `src/shared/servers/list-sort.ts`,
   but no favourite pinning under a column sort) + unit tests. Proves AC1, AC4, AC5, AC6 and the
   AC2 logic.
2. **D2 — persisted choice**: zod schema + two handlers in `src/shared/modules/replays.ts`,
   forgiving parse in `src/main/lib/schemas.ts`, handlers in `src/main/modules/replays/index.ts`
   + tests. Proves AC3 at unit level.
3. **D3 — renderer**: client calls, a sortable header over 150's list, load on mount / persist on
   click, i18n, CHANGELOG, and the e2e flow `replays-sort-order`. Proves AC1–AC3 on the real surface.

Order: D1 → D2 → D3 (D2 imports D1's column list; D3 imports both).

## Deliverables

- [x] **D1 — demo list sort (pure) + its tests.**
  Files: new `src/shared/replays/list-sort.ts`, new `src/shared/replays/list-sort.test.ts`. Mirror
  the shape and naming of `src/shared/servers/list-sort.ts` (pure: no `node:*`, no DOM, no electron).
  Exports:
  - `DEMO_SORT_COLUMNS = ['map', 'mod', 'players', 'date', 'duration', 'rating'] as const`,
    `type DemoSortColumn`, `type DemoSortDirection = 'asc' | 'desc'`,
    `interface DemoListSort { column: DemoSortColumn; direction: DemoSortDirection }`.
  - `NATURAL_DIRECTION`: `map`/`mod`/`players` → `asc`; `date`/`duration`/`rating` → `desc`.
  - `interface DemoSortFields { id: string; favourite: boolean; rating: number | null; map: string |
    null; mod: string | null; players: string | null; date: number | null; durationMs: number | null }`
    (`date` = effective date in epoch ms, `players` = the players/sides text the row shows).
  - `sortDemoRows<T>(rows: readonly T[], sort: DemoListSort | null, fields: (row: T) =>
    DemoSortFields): T[]` — returns a sorted copy, never mutates the input.
  - `nextSort(current: DemoListSort | null, column): DemoListSort | null` — other column / none →
    that column at its natural direction; same column at natural → reversed; same column reversed →
    `null`.
  Rules:
  - "Unknown" = `null`/`undefined`, string blank after trim, non-finite number.
  - **Default (`sort === null`):** favourites before non-favourites; within each group date
    descending, unknown date last; then `id` ascending.
  - **Column sort:** NO favourite pinning. Compare the column value in `direction`; an unknown value
    sorts after every known value in **both** directions (do not just negate a comparator that puts
    nulls last); two unknowns tie. Ties → date descending (unknown last) → `id` ascending.
  - Strings: `a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })`. Numbers: numeric.
  - `rating` column value = pair (favourite, rating): favourite ranks above non-favourite, then
    rating; within the same favourite flag an unrated demo ranks below a rated one; a demo with
    `favourite: false` and `rating: null` is unknown (last in both directions). "Ascending" is the
    exact reverse of descending among the known values.
  Tests (names under Acceptance Tests): default order incl. newest-first inside the favourites and
  unknown date last; every column × both directions over a fixture with known + unknown values
  (`it.each`); unknowns last in both directions per column; a favourite with an older date is NOT
  first under a `date`/`map` sort; tie-break chain; input array not mutated; `nextSort` cycle.
  Acceptance: those tests pass; `npm run typecheck` clean.

- [x] **D2 — persisted sort choice (shared contract + main) + its tests.**
  Files: edit `src/shared/modules/replays.ts` (add `demoListSortSchema = z.object({ column:
  z.enum(DEMO_SORT_COLUMNS), direction: z.enum(['asc','desc']) }).strict()`, `listGetSort:
  'list.getSort'` / `listSetSort: 'list.setSort'` in `REPLAYS_HANDLERS`, input schemas
  `listGetSortInputSchema` (the module's no-input schema) and `listSetSortInputSchema = z.object({
  sort: demoListSortSchema.nullable() }).strict()`, registered in the module's input-schema map);
  edit `src/main/lib/schemas.ts` (`ReplaysState.listSort?: DemoListSort`; in `parseReplaysState`
  `safeParse` the raw `listSort` and spread it only when valid — mirror `parseServersState`'s
  `listSort` at `src/main/lib/schemas.ts:1389-1412`); edit `src/main/modules/replays/index.ts` (two
  handlers mirroring `src/main/modules/servers/index.ts:326-336`: get → `listSort ?? null`; set with
  `null` removes the key, otherwise writes it, both via `{ ...current, … }` so other replays fields
  are untouched; return the stored value). `src/main/services/state.ts` defaults need no change (the
  key is optional). Update `src/shared/modules/replays.test.ts` if it pins the handler map.
  Tests: in `src/main/lib/schemas.test.ts` (mirror its `parseServersState … listSort` cases at
  ~line 1272) and `src/main/modules/replays/index.test.ts` (mirror
  `src/main/modules/servers/index.test.ts:641-676`).
  Acceptance: those tests pass; `npm run typecheck` clean.

- [x] **D3 — sortable header in the Demos list + persistence wiring + e2e flow.**
  Files: edit `src/renderer/src/modules/replays/client.ts` (`getListSort()` / `setListSort(sort)`,
  mirror `src/renderer/src/modules/servers/client.ts:165-172`); new
  `src/renderer/src/modules/replays/DemoListHeader.tsx` (mirror
  `src/renderer/src/modules/servers/ServerListHeader.tsx`: one button per `DEMO_SORT_COLUMNS` entry,
  `data-testid="replays-sort-{column}"`, `aria-pressed`, `ArrowUp`/`ArrowDown` icon on the active
  column, plus `data-testid="replays-sort-current"` visible text — if 150's list already renders a
  column header row, make those header cells these buttons instead of adding a second header); edit
  the Demos list view built by [[150]] (`ReplaysView.tsx` or the list component 150 created): load
  the sort on mount, apply `sortDemoRows(rows, sort, toSortFields)` in a `useMemo` before the
  virtualised list, on click `nextSort` → update optimistically → `setListSort`. `toSortFields` maps
  150's row model: effective map/mod/date value (148), sidecar favourite (absent → false) and rating,
  duration, and the exact players/sides label string the row renders (reuse 150's formatter).
  i18n in `src/renderer/src/i18n/locales/en.json` under `replays`: `sort.column.<column>` labels
  and `sort.current.default` = "Favourites first, then newest", `sort.current.column` (e.g.
  "Sorted by {{column}}, {{direction}}") — mirror the servers `sort` keys. Add a `### Added` line to
  `CHANGELOG.md`. New flow `scripts/flows/replays-sort-order.mjs` (mirror
  `scripts/flows/servers-sort-order.mjs`; seed its own variant via `writePopulatedFixture` with
  demo files whose sidecars set `favourite`, `rating` and a `date` override so dates are
  deterministic — at least two favourites with different dates and two non-favourites, one of the
  non-favourites newer than both favourites; extend `scripts/lib/fixture.mjs` minimally if it cannot
  yet seed per-variant sidecars). Flow steps: default order = favourites newest-first, then the rest
  newest-first, `replays-sort-current` shows the default text; click `replays-sort-map` → ascending
  order, the newest non-favourite is not held under the favourites; click again → descending, poll
  `state.json` for `replays.listSort = { column: 'map', direction: 'desc' }`; click `date` twice to
  prove both directions of a second column; set map/desc again, `page.reload()`, re-open Demos → same
  order and `replays-sort-{column}` still `aria-pressed="true"`; third click → default order and
  `listSort` key gone from `state.json`.
  Acceptance: `npm run ui:flow -- replays-sort-order` passes; `npm run typecheck` clean; zero new axe
  violations on the Demos screen in `npm run ui:verify`.

## Model Hints

- D1 → default — a comparator table fully pinned by the story's rules and an `it.each` over every
  column × direction including unknowns.
- D2 → default — a direct mirror of servers' `listSort` persistence (story 119).
- D3 → default — a mirror of `ServerListHeader` + `servers-sort-order.mjs`; the only new part is the
  field mapping from 150's row.
- Review: → default — the plausible wrong implementation (copying servers' `compareColumn` with its
  favourite pinning, or negating a nulls-last comparator so unknowns rise to the top in one direction)
  is caught by D1's named AC4/AC5 tests, so a default review against those tests suffices.

## Acceptance Tests

- AC1 → unit `src/shared/replays/list-sort.test.ts` › "sortDemoRows — default order > favourites
  first, each group newest first, unknown date last, id tie-break makes it total" (D1) and e2e
  `scripts/flows/replays-sort-order.mjs` (`npm run ui:flow -- replays-sort-order`), step "the default
  order groups favourites first (newest of the two first), then newest-first" (D3)
- AC2 → unit `src/shared/replays/list-sort.test.ts` › "column sort, every column, both directions >
  '<col>' sorts ascending and descending" (`it.each` over all 6 columns) and › "nextSort cycles
  natural -> reversed -> default, and jumps to natural on a different column" (D1) and e2e
  `replays-sort-order`, steps for map ascending/descending and date both directions (D3)
- AC3 → unit `src/main/lib/schemas.test.ts` › "parseReplaysState keeps a valid listSort and drops a
  malformed one" and `src/main/modules/replays/index.test.ts` › "list.setSort persists the sort and
  list.getSort returns it; null clears it" (D2) and e2e `replays-sort-order`, the reload-persistence
  step (D3)
- AC4 → unit `src/shared/replays/list-sort.test.ts` › "unknown values sort after known values, both
  directions > '<col>': unknown is last in both directions" (`it.each` over all 6 columns) (D1)
- AC5 → unit `src/shared/replays/list-sort.test.ts` › "a column sort does not pin favourites" (D1)
  and e2e `replays-sort-order`, step "clicking the map column sorts ascending across all rows -
  favourites are not re-pinned" (D3)
- AC6 → unit `src/shared/replays/list-sort.test.ts` (the whole file; D1 — the module is in
  `src/shared` and imports nothing from node/DOM/electron, which `npm run typecheck`'s node/web
  project split enforces)

## Done

Implemented the demos list's default order (favourites first, then newest by effective date) plus
a fully sortable header (all 6 columns, both directions, unknowns last, no favourite-pinning under
a column sort), persisted in `state.json`'s `replays.listSort` and restored on next start. Pure
sort engine in `src/shared/replays/list-sort.ts`; contract-first IPC (`list.getSort`/`list.setSort`)
in `src/shared/modules/replays.ts` + main handlers; renderer header/wiring + new e2e flow
`replays-sort-order`.

Commit message: `152: favourites first, then newest`

Verification — narrow gate: `npm run build` green, `npm run typecheck` green (node+web),
`npx vitest run --changed HEAD` green (115 files/1681 tests), `npm run ui:flow --
replays-sort-order` green (all steps). AC1-AC6 all verified PASS against the named tests in
`## Acceptance Tests` (updated above to the tests' real names) — see the clean-agent review below.
Full regression gate not run (sprint's job per deviation).

Review (clean agent, default tier per Model Hints): verdict **PASS**. All 6 ACs confirmed with
file:line evidence; the story's own flagged risk (a negated nulls-last comparator putting unknowns
first on direction flip) was checked by inspection and correctly avoided. One non-blocking finding:
the rating column's "favourite + null rating is a known value, not unknown" rule (per Decisions) is
implemented correctly but has no dedicated unit test row — left undocumented-but-untested rather
than fixed, since the code is correct by inspection, AC4/AC5 are otherwise fully covered, and adding
it is a coverage nicety, not a criterion gap. Also confirmed: the `findPathLeak` regex narrowing in
`src/shared/modules/replays.test.ts` (avoiding a false positive on the new `direction` field) is
in-scope and consistent with that file's existing `gameDir` precedent.

**Sprint gate regression fix (S27):** `scripts/flows/replays-list-scale.mjs` ([[150]]'s own scale
flow) broke starting at this story's commit. [[150]]'s `replays-scale` fixture has no sidecars, so
every row's effective date always fell back to real file-system mtime
(`effectiveFileTime`/`src/shared/demos/effective-values.ts`); before this story the list rendered in
raw scan order, so the highest-numbered, most-recently-written file (`scale-3000.dm2`) landed at the
bottom, reachable by scrolling to the end. This story's default order (favourites first, then newest
by effective date) sorts that same most-recently-written file to the *top* instead, so the flow's
scroll-to-end assertion timed out waiting for a row that had moved out of view at the other end of
the list — the flow's expectation of *which* file sits at the bottom was simply stale, not a defect
in the sort itself. Fixed in `scripts/lib/fixture.mjs`'s `writeReplaysScaleFixture()`: each seeded
file now gets a deterministic, strictly increasing mtime (`fs.utimesSync`, one second apart) instead
of its incidental real write-time mtime — the tight write loop otherwise clusters many files into
the same FS-timestamp bucket, which made "which single file is oldest" a timing accident rather than
a fact the fixture could stand on. `REPLAYS_SCALE_LAST_FILE_NAME` now points at `scale-0001.dm2` (the
deterministically oldest file, which sorts to the bottom under this story's default order) instead of
`scale-3000.dm2`. No product code changed. `npm run ui:flow -- replays-list-scale` green ×3 after the
fix; `replays-sort-order` and `replays-demo-rows` (the other two flows sharing this fixture module)
re-verified green.

tiers: D 3 / hard 0 · review default · cycles 0 · agents 5
