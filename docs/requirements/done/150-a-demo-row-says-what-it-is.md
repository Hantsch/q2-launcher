---
id: 150
title: a demo row says what it is
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user scrolling the Demos view recognises a demo from its row alone — which match it was, on which
map, who against whom, when, how long — and sees at a glance which demos they have already
annotated, which are favourites, which come from an archive and which have a problem (concept
`docs/concepts/demo-browser.md` §10, DEMO-13).

The row shows **effective values** ([[148]]). Order is [[152]]'s, narrowing is [[153]]/[[154]]'s,
list states are [[151]]'s. Demo-provided text (player names, map, level name) and sidecar text are
data, not i18n prose. The concept leaves the final column set to refine (§10).

## Acceptance Criteria

- [x] **AC1** — A row shows, when known: effective name, map, mod, gamemode, players or sides
      (`A vs B`, team names where the sidecar has them), date, duration, format and source
      (installation + game dir, extra folder, or archive).
- [x] **AC2** — A guessed gamemode is marked as guessed ([[149]]).
- [x] **AC3** — Favourite and rating are shown when the sidecar sets them.
- [x] **AC4** — Markers for "has sidecar", "sidecar error" ([[147]]), "archive entry" ([[143]]) and
      "unreadable" ([[145]]) appear exactly when they apply, and none relies on colour alone.
- [x] **AC5** — A value that is unknown shows a sane placeholder; a row never renders blank,
      malformed or throws.
- [x] **AC6** — Selecting a row opens its detail ([[155]]).
- [x] **AC7** — The list stays responsive with the demo count decided in Q2.
- [x] **AC8** — The row is a `ui:verify` screen with zero axe violations; any sub-44px density gets a
      CLAUDE.md deviation row with the desktop-only rationale.

## Open Questions

- [x] ~~**Q1 — Column set** (§10): which of the fields above are columns, which are secondary text,
      which only appear in the detail?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Scale** — how many demos must the list handle smoothly (1 000? 10 000?), and does that
      need virtualisation?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Column set: columns are map, mod, players/sides, date, duration, favourite/rating;
  everything else (name, gamemode, format, source, sidecar/archive/unreadable markers) is secondary
  text or icon badge on the row, full detail only in [[155]]'s detail view.
- **(User)** Scale: a few hundred to low thousands of demos — the user filters/searches rather than
  scrolling through hundreds. Design for smooth handling in that range; use row virtualisation from
  the start given "low thousands" is explicitly in scope.
- **Main composes the row, the renderer only displays it.** `index.read` answers an enriched
  `DemoRow` (index facts + sidecar summary + resolved `EffectiveValues`) — the renderer has neither
  the header facts nor batched sidecar access, and 152/153 need the same effective values for every
  row to sort and filter.
- **The index row gains `gameDir`, `pov`, `players`, `durationMs`** (cached with the other header
  facts, cache version bumped) — `resolveEffectiveValues` needs them for mod/sides/pov/gamemode, and
  S26's `readDemoDuration` was never wired into the scan.
- **Sidecars are re-read on every `index.read`, never cached** — the filesystem is the master
  (concept §3) and 155 AC7 needs a saved sidecar to show without a rescan; a missing-file read per
  demo is cheap at "low thousands".
- **The OpenTDM `matchedPatternId` rung of [[149]] stays unwired** — the name matcher works on
  template strings without ids; the `gameDir === 'opentdm'` rung still yields `tdm`, and threading
  pattern ids through the matcher is not needed for any AC here.
- **Row layout:** a leading identity cell (effective name as primary line; gamemode + guessed
  marker, format and source as secondary line; marker badges) followed by the six User-decided
  columns map, mod, players/sides, date, duration, favourite/rating — the name is row text, not a
  sortable column, which keeps the User column set intact while the row stays recognisable.
- **A static column header row** ships with the grid template — 152 turns its labels into sort
  controls, so the header belongs to the grid from day one.
- **Players/sides text:** sides join with " vs "; a side shows its team name when set, else its
  players; an unsided list of exactly two players reads "A vs B"; longer lists show three names plus
  "+n" — "who against whom" at a glance, the full list is 155's.
- **Unknown values** render a visible "–" with a screen-reader "unknown" label (one i18n key) — a
  stable placeholder never collapses the grid and is never an empty cell.
- **Markers:** has-sidecar, sidecar-error, archive-entry and unreadable are icon badges with distinct
  lucide shapes plus an accessible name; the two problem markers (sidecar error, unreadable) also
  show short visible text — shape and text, never colour alone (AC4).
- **Favourite/rating are read-only here** — the star-toggle/rating-edit on the row is [[155]] AC9.
- **Virtualisation is hand-rolled fixed-row-height windowing** (a pure `visibleRange` helper + one
  component), no new dependency — fixed-height rows make it ~50 lines, and headless virtualiser libs
  render nothing under jsdom, which would leave the unit tests blind.
- **Row height 56px, no interactive sub-44px control in this story** — so no new CLAUDE.md deviation
  row is needed; if the build ends up below 44px on any interactive element, it adds one (AC8).
- **AC6 is delivered as selection + a detail side-panel shell** (`replays-demo-detail`: effective
  name heading and a close button) that [[155]] fills — 155's User decision fixed the side-panel
  layout, and AC6 needs a real surface to prove "selecting opens its detail".
- **The e2e fixture is a dedicated variant with an extra folder under the variant's own userData** —
  the shared `gameRoot()` demos folder is not variant-scoped and leaking into it broke S26's gate
  (story 143 regression note in `scripts/lib/fixture.mjs`).
- **Scale target for AC7: 3 000 rows**, proven by a bounded rendered-row count and a reachable last
  row, not by a timing number — "low thousands" upper end, and a wall-clock budget would be flaky.

## Plan

Today `index.read` returns `DiscoveredDemo` (file name, map, source, readability, name facts) and
`ReplaysView.tsx` renders it as a plain `<ul>`. Effective values ([[148]]), gamemode ([[149]]),
duration (`readDemoDuration`), sidecar state and favourite/rating are built but not wired into it.

1. **Index facts (D1, main + shared contract).** Extend `discoveredDemoSchema` with `gameDir`,
   `pov`, `players`, `durationMs`; fill them in `readDemoFacts` (loose file: header + full-file
   duration) and `zip-demos.ts` (entry buffer: header + frame counter); carry them through
   `toRow` on the fresh *and* cache-hit path; bump `REPLAYS_INDEX_CACHE_VERSION`.
2. **Row composition (D2, main).** New `demoRowSchema` = `DiscoveredDemo` + `sidecar { state,
   values }` + `effective` (`EffectiveValues`). A pure `buildDemoRow(demo, sidecarRead)` calls
   `resolveEffectiveValues`; `index.read` maps the scan snapshot through it with bounded-concurrency
   `sidecarStore.read`.
3. **Row UI (D3, renderer).** `DemoRow` + `DemoListHeader` on a shared CSS grid template
   (mirror `servers/list-grid.ts` / `ServerRow.tsx`), pure formatting helpers, i18n keys.
4. **List (D4, renderer).** Hand-rolled windowing (`visibleRange` + `VirtualDemoList`), selection
   state in `ReplaysView`, the `replays-demo-detail` side-panel shell.
5. **Real surface (D5, scripts).** Fixture variants `replays-rows` (rich) and `replays-scale`
   (3 000 files), flows `replays-demo-rows` / `replays-list-scale`, `ui:verify` screen
   `replays-rows`.

Order D1 → D2 → D3 → D4 → D5. Existing test ids (`replays-demo-list`, `replays-demo-row`,
`replays-demo-name`, `replays-demo-source`, `replays-demo-map`, `data-demo-id`,
`data-archive-entry`) stay, because `replays-discovered-list`, `replays-extra-folders`,
`replays-incremental-scan`, `replays-zip-entries`, `replays-name-templates` and the `replays-list`
screen depend on them — every D that touches the list re-runs those flows.

## Deliverables

- [x] **D1 — the index row carries header facts and duration.** In `src/shared/modules/replays.ts`
  add to `discoveredDemoSchema`: `gameDir: z.string().nullable()`, `pov: z.string().nullable()`,
  `players: z.array(z.string())` (empty when unknown), `durationMs: z.number().int().nonnegative()
  .nullable()`. In `src/main/modules/replays/scan-service.ts` extend `DemoHeaderFacts` with the same
  four fields; `readDemoFacts` fills them from `readDemoHeader` (`gameDir`/`pov`/`players` of an ok
  header) and `readDemoDuration` (`src/main/lib/demo-bytes.ts`; `ok` → `durationMs`, else `null`;
  skip the duration read for an unreadable header); `toRow` picks all four from `facts` — note
  `runScan` calls `toRow(entry.file, entry.parsed)` for cache hits, so the pick must work on a cached
  row too. In `src/main/modules/replays/zip-demos.ts` fill the four from the entry's in-memory bytes:
  header fields from `parseDemoHeader`'s ok result, duration by pushing the same bytes through
  `createDm2FrameCounter`/`createMvd2FrameCounter` (`src/shared/demos/dm2-frames.ts`,
  `mvd2-frames.ts`, chosen by `header.format`) and `finish()`. Bump
  `REPLAYS_INDEX_CACHE_VERSION` to 2 in `src/main/modules/replays/index-cache.ts`. In
  `src/main/modules/replays/index.ts`'s `demos.list` mapping pass the new fields through (discovery's
  values, or `null`/`[]`). Tests: `scan-service.test.ts` — "a fresh parse carries gameDir, pov,
  players and durationMs" and "a cache hit keeps gameDir, pov, players and durationMs" (use
  `docs/fixtures/demos/test.dm2` → 41 000 ms); `zip-demos.test.ts` — "a zip entry carries its
  header facts and duration"; `index-cache.test.ts` — "a version-1 cache is discarded".
- [x] **D2 — `index.read` answers composed demo rows.** In `src/shared/modules/replays.ts` add
  `effectiveSchema(inner)` (`{ value, source: enum VALUE_SOURCES }` or `{ value: null, source: null
  }`), `effectiveValuesSchema` (name, map, mod, gamemode, sides, date, pov, host — mirror
  `EffectiveValues` in `src/shared/demos/effective-values.ts`, sides as `{ team?, result?, players
  }[]`), and `demoRowSchema = discoveredDemoSchema.extend({ sidecar: z.object({ state: z.enum(['none',
  'ok', 'error']), values: sidecarFieldsSchema.partial() }), effective: effectiveValuesSchema })`;
  point `replaysIndexReadResultSchema` at `z.array(demoRowSchema)` and export `type DemoRow`. New
  `src/main/modules/replays/demo-rows.ts`: pure `buildDemoRow(demo: DiscoveredDemo, sidecar: {
  state: SidecarState; values } | null): DemoRow` — builds the `ResolveEffectiveValuesInputs.header`
  as `{ ok: true, gameDir, map, pov, players }` from the row when `readable && gameDir !== null`,
  else `null`; `sidecar === null` (archive entry / unknown id / read failure) → `{ state: 'none',
  values: {} }`; an `error` sidecar still feeds its valid `values` into resolution; never throws.
  Plus `composeDemoRows(demos, readSidecar, concurrency = 16)`. In `src/main/modules/replays/index.ts`
  wire `indexRead` to `composeDemoRows(await scanService.read(), (id) => sidecarStore.read(id))`
  (unwrap the store's `Outcome`; a failed outcome → `null`). `src/renderer/src/modules/replays/client.ts`:
  `indexRead` resolves to `DemoRow[]`. Tests in `src/main/modules/replays/demo-rows.test.ts`: "a
  sidecar name, favourite and rating win over the file name", "a header-only row resolves map, mod,
  sides and a guessed gamemode from the demo", "an unreadable row with no sidecar resolves name and
  file-time date only", "an error sidecar keeps its valid values and reports state error", "an
  archive entry has sidecar state none", "3000 demos compose with at most 16 sidecar reads in
  flight".
- [x] **D3 — a demo row that says what it is.** Mirror `src/renderer/src/modules/servers/ServerRow.tsx`
  and `list-grid.ts`. New in `src/renderer/src/modules/replays/`: `list-grid.ts` (`DEMO_LIST_GRID`
  template: identity cell, then map, mod, players/sides, date, duration, favourite/rating; fixed row
  height constant `DEMO_ROW_HEIGHT = 56`); `row-format.ts` — pure `sidesText(sides)` (sides join " vs
  "; a side shows its team name when set, else its players; one unsided list of exactly two players
  → "A vs B"; more than three names → first three + a `+n` suffix from i18n), `formatDemoDate(ms,
  locale)` (`Intl.DateTimeFormat`, date + short time; non-finite → `null`), `formatLabel(format,
  gzip)`; `components/DemoRow.tsx` — props `{ row: DemoRow; selected; onSelect; }`, `role="button"`,
  `tabIndex=0`, Enter/Space select, `aria-pressed`, `data-testid="replays-demo-row"`,
  `data-demo-id`, `data-archive-entry` when an archive entry; identity cell: `replays-demo-name`
  (effective name), secondary line `replays-demo-gamemode` (via `describeGamemode` from
  `src/shared/demos/gamemode.ts`; guessed → visible `replays.gamemode.guessed` text),
  `replays-demo-format`, `replays-demo-source` (reuse the existing `replays.list.source` /
  `replays.list.archiveSource` / `replays.source.extraFolder` keys); markers
  `replays-marker-sidecar` (`sidecar.state !== 'none'`), `replays-marker-sidecar-error`
  (`state === 'error'`, visible text), `replays-marker-archive` (`archiveEntry !== null`),
  `replays-marker-unreadable` (`!readable`, visible text, existing `replays.unreadable.marker`) —
  lucide icons with distinct shapes, each with an accessible name, never colour alone; columns
  `replays-demo-map`, `replays-demo-mod`, `replays-demo-sides`, `replays-demo-date`,
  `replays-demo-duration` (`formatDemoDuration` from `src/shared/demos/duration-format.ts`),
  `replays-demo-favourite` (star icon + accessible name, only when `sidecar.values.favourite`) and
  `replays-demo-rating` (`n/10`, only when set). Every unknown value renders `UnknownValue` (visible
  "–" `aria-hidden`, sr-only `replays.row.unknown`). `components/DemoListHeader.tsx` — static column
  labels on the same grid. Keys under `replays.row.*`, `replays.column.*`, `replays.format.*`,
  `replays.marker.*` in `src/renderer/src/i18n/locales/en.json`; demo/sidecar text is data. Design
  tokens only, no raw palette classes. Tests in `components/DemoRow.test.tsx` (jsdom, mirror
  `servers/ServerRow.test.tsx`): "shows every known value", "a guessed gamemode is marked guessed",
  "favourite and rating show only when the sidecar sets them", "each marker appears exactly when it
  applies", "an all-unknown row renders placeholders and never throws", "Enter selects the row"; and
  `row-format.test.ts`: "team names read A vs B", "two unsided players read A vs B", "long player
  lists are capped with +n", "a non-finite date formats to null".
- [x] **D4 — a virtualised, selectable list with a detail shell.** New
  `src/renderer/src/modules/replays/visible-range.ts`: pure `visibleRange({ scrollTop,
  viewportHeight, rowHeight, count, overscan })` → `{ start, end }` (clamped, empty count → empty).
  New `components/VirtualDemoList.tsx`: one scroll container (`data-testid="replays-demo-scroll"`,
  focusable), an inner spacer of `count × DEMO_ROW_HEIGHT` (from `list-grid.ts`), only
  `rows[start..end)` rendered as `<li>` (with `aria-setsize`/`aria-posinset`) inside
  `<ul data-testid="replays-demo-list">`, `DemoListHeader` sticky above; viewport height from a
  `ResizeObserver` with an injectable initial height so jsdom tests render rows. In
  `src/renderer/src/modules/replays/ReplaysView.tsx`: state becomes `DemoRow[]`, replace the plain
  `<ul>` with `VirtualDemoList` (keep the loading/empty paragraphs and the refresh button as they
  are), add `selectedId`; when set, render a side panel `<aside data-testid="replays-demo-detail">`
  next to the list with the selected row's effective name as heading
  (`replays-demo-detail-title`) and a close button (`replays-demo-detail-close`, default size) — the
  shell [[155]] fills. A row that vanishes on a re-read clears the selection. Tests:
  `visible-range.test.ts` — "the first window starts at row 0", "the window follows scrollTop",
  "the window is clamped at the end", "an empty list has an empty window"; `ReplaysView.test.tsx`
  (extend) — "3000 rows render at most one window of row elements", "selecting a row opens its
  detail panel", "closing the detail panel clears the selection".
- [x] **D5 — the rows on the real surface.** In `scripts/lib/fixture.mjs` add two variants via
  `writePopulatedFixture({ variant, stateOverrides })` (mirror `writeServersListFixture`), each with
  one extra folder **under the variant's own userData dir** (`variantUserDataDir(variant)`, never
  `gameRoot()` — see the story-143 regression note on `writeReplaysDemosFixture()`), registered in
  `writeFixture`: `replays-rows` — a copy of `docs/fixtures/demos/test.dm2` with a valid sidecar
  (`name`, `gamemode: "tdm"`, `favourite: true`, `rating: 8`, two `sides` with team names), a second
  copy of `test.dm2` whose sidecar holds only two single-player `sides` and no gamemode (→ `duel`,
  guessed), a copy of the PFAU `.mvd2` without sidecar, a demo with a broken sidecar (`{"rating": 99}`), an unreadable placeholder file,
  and — only when `vendoredExtractorExists()` — a zip holding a copy of `test.dm2`; `replays-scale`
  — 3 000 placeholder `.dm2` files (`scale-0001.dm2` …). Export the file names for the flows. New
  flows (mirror `scripts/flows/replays-discovered-list.mjs`, `export const variant`):
  `scripts/flows/replays-demo-rows.mjs` and `scripts/flows/replays-list-scale.mjs`. Add a
  `replays-rows` screen to `scripts/lib/screens.mjs` (variant `replays-rows`, both viewports, mirror
  the `replays-list` entry). Re-run the existing `replays-*` flows and the `replays-list` screen. If
  any interactive element ended up below 44px, add a CLAUDE.md deviation row with the desktop-only
  rationale.

## Model Hints

- D1 → deliverable-hard: `runScan` rebuilds cache-hit rows through `toRow(entry.file,
  entry.parsed)` and zip entries never go through `readDemoFacts`, so a field wired on only one of
  the three paths (fresh file, cache hit, zip entry) passes a first-launch check and silently turns
  into `null` duration/mod on the second launch or for archives.
- D2, D3, D4, D5 → default.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-demo-rows.mjs` › "replays-demo-rows" (the sidecar'd `test.dm2`
  row shows effective name, map, mod, gamemode, team sides "A vs B", date, duration, format and the
  extra-folder source; the mvd2 row shows its demo-derived values); unit
  `src/renderer/src/modules/replays/components/DemoRow.test.tsx` › "shows every known value";
  unit `src/main/modules/replays/demo-rows.test.ts` › "a header-only row resolves map, mod, sides
  and a guessed gamemode from the demo"; unit `src/main/modules/replays/scan-service.test.ts` › "a
  fresh parse carries gameDir, pov, players and durationMs" and "a cache hit keeps gameDir, pov,
  players and durationMs"; unit `src/main/modules/replays/zip-demos.test.ts` › "a zip entry carries
  its header facts and duration".
- AC2 → unit `DemoRow.test.tsx` › "a guessed gamemode is marked guessed"; e2e
  `replays-demo-rows` (the two-single-player-sides row shows `duel` with the guessed marker text;
  the row whose sidecar sets `tdm` shows it without the marker).
- AC3 → unit `DemoRow.test.tsx` › "favourite and rating show only when the sidecar sets them";
  unit `demo-rows.test.ts` › "a sidecar name, favourite and rating win over the file name"; e2e
  `replays-demo-rows` (star + "8/10" on the sidecar'd row only).
- AC4 → unit `DemoRow.test.tsx` › "each marker appears exactly when it applies"; unit
  `demo-rows.test.ts` › "an error sidecar keeps its valid values and reports state error" and "an
  archive entry has sidecar state none"; e2e `replays-demo-rows` (each of the four fixture cases
  carries exactly its markers; skip only the archive assertion when the extractor is not vendored,
  as `replays-zip-entries.mjs` does).
- AC5 → unit `DemoRow.test.tsx` › "an all-unknown row renders placeholders and never throws";
  unit `row-format.test.ts` › "a non-finite date formats to null"; unit `demo-rows.test.ts` › "an
  unreadable row with no sidecar resolves name and file-time date only"; e2e `replays-demo-rows`
  (the unreadable placeholder row has no empty cell).
- AC6 → e2e `replays-demo-rows` (clicking a row opens `replays-demo-detail` titled with that row's
  effective name; close hides it); unit `ReplaysView.test.tsx` › "selecting a row opens its detail
  panel", "closing the detail panel clears the selection"; unit `DemoRow.test.tsx` › "Enter
  selects the row".
- AC7 → e2e `scripts/flows/replays-list-scale.mjs` › "replays-list-scale" (3 000 rows: fewer than
  100 `replays-demo-row` elements in the DOM, scrolling `replays-demo-scroll` to the end shows the
  last demo); unit `ReplaysView.test.tsx` › "3000 rows render at most one window of row
  elements"; unit `visible-range.test.ts` › all four cases; unit `demo-rows.test.ts` › "3000 demos
  compose with at most 16 sidecar reads in flight".
- AC8 → e2e `npm run ui:verify` screen `replays-rows` (both viewports, zero axe violations) plus
  the existing `replays-list` screen; the deviation half is checked in D5 (no sub-44px interactive
  element planned — see Decisions).

## Done

Demo rows now carry gameDir/pov/players/durationMs from all three index paths (fresh parse, cache
hit, zip entry; cache version bumped to 2), `index.read` composes them with sidecar state into
`DemoRow` via `resolveEffectiveValues`, a new `DemoRow`/`DemoListHeader` UI shows name, gamemode
(guessed marker), markers (sidecar/sidecar-error/archive/unreadable), map/mod/sides/date/duration
and favourite/rating, a hand-rolled virtualised `VirtualDemoList` keeps the DOM bounded at "low
thousands" scale, and `ReplaysView` gained a selectable row → `replays-demo-detail` side-panel
shell for [[155]] to fill. Real-surface coverage: fixtures `replays-rows`/`replays-scale`, flows
`replays-demo-rows`/`replays-list-scale`, `ui:verify` screen `replays-rows`.

Commit message: `150: demo rows show what they are`

Verification — narrow gate: `npm run build` green, `npm run typecheck` green,
`npx vitest run --changed HEAD` green (119 files / 1696 tests), e2e `npm run ui:flow -- replays-demo-rows`
and `-- replays-list-scale` green, `ui:verify` screens `replays-rows`/`replays-list` green (0 axe
violations, both viewports). AC1-AC8 all walked against their named tests: every test ran and
passed (see verify-agent report); no `manual residue`. Review: default-tier PASS, no fixes needed —
one non-blocking test-coverage note (`DemoRow.test.tsx`'s marker test only checks all-on/all-off
combinations, not every pairwise state) left as-is, not a criterion gap since `demo-rows.test.ts`
covers the state classification at the data layer.

Decisions made during implementation: none beyond what's already in `## Decisions (Sprint)` —
plan and Model Hints were followed as written; D1's three-path risk (fresh/cache-hit/zip) was
covered by dedicated tests per the hard-tier note.

Pre-existing, unrelated: `replays-extra-folders.mjs` e2e flow is red (story-142 bug, button-lookup
timeout on `replays-extra-folders-add`) — confirmed untouched by this story's diff, not fixed here.

Narrow gate only. The full regression gate (`npm test`, `npm run ui:verify`, `npm run ui:flows`)
has not run — it is the sprint's, after the last story.

tiers: D 5 / hard 1 · review default · cycles 0 · agents 7
