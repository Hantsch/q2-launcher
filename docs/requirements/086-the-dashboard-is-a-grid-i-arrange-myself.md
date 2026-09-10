---
id: 086
title: The dashboard is a grid I arrange myself
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

Below the news hero is my half of the screen. I decide what sits there, where it sits and how big
it is — and the launcher never rearranges it behind my back. Whoever only cares about config
profiles builds a screen of config; whoever plays a lot builds a screen of playtime.

Editing is deliberate: normally the tiles are just content and nothing can be dragged by
accident. I switch on arrange mode, and only then handles, resize grips and a catalog of the
tiles I have not placed appear. Everything I can do with the mouse I can do with the keyboard,
and the app tells me what happened while I do it. What I arrange is saved as it happens, survives
a restart, and can be put back to the default in one step.

This story is the grid, the mode and the persistence — the tiles that go in it are story 087. See
[concepts/home-screen.md](../concepts/home-screen.md) §8.

## Acceptance Criteria

- [ ] **AC1** — The grid is 12 columns wide with 40px rows; a tile stores `x`, `y`, `w`, `h` in
      cells, and gaps are kept — the layout is never compacted by the launcher.
- [ ] **AC2** — Columns shrink proportionally with the window; below the narrow threshold the grid
      renders as a single column in layout order, and the stored layout is unchanged by that
      (widening restores the arrangement exactly).
- [ ] **AC3** — Outside arrange mode no drag or resize can start, and tiles behave as ordinary
      clickable content.
- [ ] **AC4** — Entering arrange mode moves no tile: the catalog bar and the status line are
      docked over the dashboard, not pushed into its flow.
- [ ] **AC5** — A move or resize that would overlap another tile, leave the grid, or go below the
      tile's minimum size is refused, and is shown as invalid while dragging rather than silently
      snapping back.
- [ ] **AC6** — The catalog lists exactly the modules that are not currently placed; an entry can
      be dragged into the grid or placed with Enter at the first free spot that fits it.
- [ ] **AC7** — A placed tile can be returned to the catalog from arrange mode.
- [ ] **AC8** — Keyboard parity: Space/Enter on a handle lifts, arrows move one cell,
      Shift+arrows resize by one cell, Enter drops, and Esc, blur or Tab cancels and restores the
      placement the tile had before the lift.
- [ ] **AC9** — Every lift, move, resize, drop and cancel is announced in a live region and
      mirrored in a visible status line.
- [ ] **AC10** — Each change is persisted as it happens, in its own `state.json` key with its own
      schema and defensive parse; `LauncherSettings` gains no field.
- [ ] **AC11** — A stored record for an unknown module id is dropped on load, and a module that is
      missing from the layout is not auto-inserted.
- [ ] **AC12** — "Reset to default" restores the shipped default layout after a confirmation.
- [ ] **AC13** — The layout engine (place, move, resize, collide, stack, first free spot) is a
      pure, unit-tested module.
- [ ] **AC14** — Arrange mode, the catalog and the narrow single-column state are in the
      `ui:verify` registry with a `ui:flow` script for the arrange interaction, at zero axe
      violations.

## Decisions (Sprint)

- **(User)** Arrange control sits in the home screen header — with the content it edits, not the
  titlebar utility row (which already carries a recorded design-token deviation).
- **(User)** Module minimum size floor: 2×2 cells (shared decision with 087, applies generally).
- Narrow-window threshold: kept at the concept's placeholder, 900px — a pure balancing value, not
  escalated to the user.
- The 900px threshold is measured on the **dashboard container's** width, not the window's — the
  window minimum is 940px (`src/shared/constants.ts`), so a window-based threshold would be
  unreachable and AC2/AC14's single-column state untestable; at the container it falls out of the
  two existing `ui:verify` viewports (1280 → grid, 940 → single column).
- Persistence goes through the `home` module's own handlers over `module:invoke`
  (`home.getLayout` / `home.setLayout` / `home.resetLayout`), not new top-level `ipc.ts` channels —
  ARCHITECTURE.md's module seam is the path for module traffic, mirroring `downloads.getSettings`.
- The persisted key is a new top-level `homeLayout` in `state.json` with a defensive `parseHomeLayout`
  in `src/main/lib/schemas.ts`, mirroring the `configProfiles` precedent exactly — additive key, no
  `STATE_SCHEMA_VERSION` bump, no migration (the precedent's own doc comment says so).
- A write sends the **whole** layout, not a per-tile patch — one code path for move, resize, place,
  remove and reset keeps "saved as it happens" a single call instead of five.
- Grid geometry, the dashboard-module id list, the per-module min size and `DEFAULT_HOME_LAYOUT`
  live in `src/shared/modules/home.ts` (zod-free); that is what lets main drop a record for an
  unknown id (AC11) without knowing a single renderer component.
- 086 ships the dashboard-module registry with both v1 ids and **placeholder tile bodies** (frame +
  title only); 087 fills them with real content — without two placeable tiles the grid, the catalog
  and the min-size floor have nothing to be tested against.
- Pointer drag/resize uses `@dnd-kit`'s `DndContext` + `PointerSensor`; the keyboard path is our
  own lift state machine over the same reducer, **not** `KeyboardSensor` — its coordinate getters
  are list-shaped and cannot express 2D movement plus Shift+arrow resize.
- Arrange mode is unavailable while the dashboard is single-column (control disabled with an i18n
  hint): a stack has no cell geometry to arrange, and it keeps AC2's promise that narrow rendering
  never writes the layout.
- Vertical bound: the grid is hard-bounded at 12 columns, and in arrange mode extends to the lowest
  occupied row plus 2 spare rows — otherwise a tile at the bottom edge could never move down.
- Refusal is silent state-wise: an invalid move/resize marks the drag ghost invalid (data attribute
  + status line text) and the tile itself never leaves its stored placement, so "shown as invalid"
  and "not applied" are the same code path (AC5).
- Reset uses the existing `Modal` primitive with a `danger` confirm, mirroring
  `RemoveInstallationDialog.tsx` — no new dialog primitive.
- Container width comes from a new `useElementWidth` ResizeObserver hook kept **inside** the home
  module; it is promoted to `components/` only when a second consumer appears.
- Tile placement is applied through React's `style` prop / CSS custom properties, never a parsed
  style attribute — the production CSP rule in ARCHITECTURE.md.

## Open Questions

- ~~Where is the narrow-window threshold, measured from where a 1 × 2 tile stops being readable?
  (Concept open point 2, placeholder 900px.)~~ resolved — placeholder value kept, see Decisions
  (Sprint).
- ~~What is each module's minimum size in cells? (Concept open point 4 — the default layout is
  fixed at two tiles of 6 × 5, the floor is not.)~~ answered → Decisions (Sprint)
- ~~Where does the arrange control sit — home screen header, titlebar utility row, or both?
  (Concept open point 10, interacts with the recorded titlebar token deviation.)~~ answered →
  Decisions (Sprint)

## Plan

Builds on 081's `home` module (main half `src/main/modules/home/`, renderer half
`src/renderer/src/modules/home/` with the home route's `View`). Nothing in the shell is touched.

1. **Contract + persistence (main).** `src/shared/modules/home.ts` gets the grid constants
   (`GRID_COLUMNS = 12`, `GRID_ROW_HEIGHT = 40`, `NARROW_THRESHOLD_PX = 900`, min floor `2 × 2`),
   the `DashboardModuleId` union (`playtime`, `configProfiles`), `TilePlacement`/`HomeLayout` types,
   `DEFAULT_HOME_LAYOUT` (the two tiles at `6 × 5`, per concept §11) and `HOME_HANDLERS`
   (`getLayout`, `setLayout`, `resetLayout`). `state.ts` gains the `homeLayout` key + getter/setter,
   `lib/schemas.ts` gains `parseHomeLayout` (drops unknown ids, never inserts a missing module),
   `modules/home/index.ts` registers the three handlers with zod payload schemas.
2. **Pure engine.** `modules/home/dashboard/layout.ts`: `place`, `move`, `resize`, `collides`,
   `stack` (row-major single-column order) and `firstFreeSpot`. Every operation returns either a new
   layout or a refusal reason; it never mutates and never compacts.
3. **Read-only dashboard.** `Dashboard.tsx` + `DashboardGrid.tsx` + `DashboardTile.tsx`, the
   dashboard-module registry with placeholder bodies, `useElementWidth`, `dashboard.css`, the layout
   loaded through the typed client. Below 900px container width it renders `stack()`'s order as one
   column and writes nothing. Outside arrange mode there are no handles and no sensors mounted.
4. **Arrange chrome.** The home header's arrange toggle (User decision), the catalog bar + status
   line **docked absolutely over** the dashboard's own relative container, per-tile grip / resize
   grip / return-to-catalog action, and reset-to-default behind a `Modal` confirm.
5. **Pointer interaction.** `DndContext` + `PointerSensor` over the reducer from step 2, invalid-drag
   feedback, and a `setLayout` call per accepted change.
6. **Keyboard interaction.** Own lift state machine on the tile grip driving the same reducer, plus
   the `aria-live` region the visible status line mirrors.
7. **Verification.** Three `ui:verify` screens (dashboard, arrange mode with catalog, narrow single
   column at `VIEWPORT_MIN`), a seeded `homeLayout` in the populated fixture, and two `ui:flow`
   scripts for the arrange and keyboard interactions.

Order matters: 1 → 2 are independent of the renderer surface, 3 unblocks 4, and 5/6 share 4's chrome.

## Deliverables

- **D1 — `homeLayout` persists, unknown ids do not.** `src/shared/modules/home.ts` (new: constants,
  ids, types, `DEFAULT_HOME_LAYOUT`, `HOME_HANDLERS`), `src/main/lib/schemas.ts` (`parseHomeLayout`),
  `src/main/services/state.ts` (key, `defaults()`, parse block, getter/setter),
  `src/main/modules/home/index.ts` + `schemas.ts` (three handlers),
  `src/renderer/src/modules/home/client.ts` (typed client). Mirror: `configProfiles` in
  `state.ts` / `schemas.ts` and `downloads.getSettings`/`patchSettings` in
  `src/main/modules/downloads/index.ts`. Plus its tests in `src/main/lib/schemas.test.ts`
  (unknown id dropped, missing module not inserted, garbage → default) and
  `src/main/services/state.test.ts` (default + round-trip).
  Acceptance: `home.setLayout` round-trips through `state.json`; a record for `"nope"` is gone after
  reload; `LauncherSettings` is untouched.
- **D2 — the layout engine.** `src/renderer/src/modules/home/dashboard/layout.ts` +
  `layout.test.ts`. Pure: `place`, `move`, `resize`, `collides`, `stack`, `firstFreeSpot`, min-size
  floor, 12-column and row bounds, refusal reasons. Acceptance: a refused operation returns the
  input layout untouched and a reason; nothing is ever compacted; `firstFreeSpot` scans row-major.
- **D3 — the dashboard renders, and shrinks.** `src/renderer/src/modules/home/dashboard/`
  (`Dashboard.tsx`, `DashboardGrid.tsx`, `DashboardTile.tsx`, `dashboard-modules.tsx` registry with
  placeholder bodies, `useElementWidth.ts`), `src/renderer/src/modules/home/HomeView.tsx` (mount it
  below the hero), `src/renderer/src/styles/dashboard.css` (imported into the `components` layer like
  `controls-grid.css`), `src/renderer/src/i18n/locales/en.json`. Plus `scripts/lib/fixture.mjs`
  (seed a gapped, non-default `homeLayout`) and two `scripts/lib/screens.mjs` entries
  (`home-dashboard`, `home-dashboard-narrow` at `VIEWPORT_MIN`) plus `scripts/flows/home-dashboard-arrange.mjs`
  with its first two steps ("no drag outside arrange mode", "narrow stacks and widening restores"),
  which D4/D5 then extend. Acceptance: the seeded layout
  renders at its stored cells with its gap intact; at a 940px window it is one column in row-major
  order; no drag can start.
- **D4 — arrange mode, catalog, reset.** `ArrangeBar.tsx` (catalog + status line, docked),
  `HomeHeader.tsx` (arrange toggle, disabled while single-column), `ResetLayoutDialog.tsx` (mirror
  `src/renderer/src/components/installations/RemoveInstallationDialog.tsx`), tile grip/remove
  affordances in `DashboardTile.tsx`, `en.json`, one `scripts/lib/screens.mjs` entry
  (`home-dashboard-arrange`) and further steps in `scripts/flows/home-dashboard-arrange.mjs` (mode
  entry moves no tile, catalog lists exactly the unplaced modules, Enter places, remove returns, reset confirms).
  Acceptance: tile rects are byte-identical before and after entering arrange mode.
- **D5 — pointer move and resize.** `DashboardGrid.tsx` (`DndContext`, `PointerSensor`,
  drag-from-catalog), `DashboardTile.tsx` (resize grip), `layout.ts` untouched, plus the drag steps
  in `scripts/flows/home-dashboard-arrange.mjs`. Mirror the sensor/overlay wiring in
  `src/renderer/src/components/dnd/SortableList.tsx`. Acceptance: an overlapping or out-of-grid drop
  shows the ghost invalid and leaves the tile where it was; an accepted drop writes `state.json`
  immediately.
- **D6 — keyboard parity and announcements.** `useTileLift.ts` (lift state machine),
  `DashboardTile.tsx` (grip key handling), `ArrangeBar.tsx` (`aria-live="polite"` region the visible
  status line mirrors), `en.json`, plus `scripts/flows/home-dashboard-keyboard.mjs` and
  `useTileLift.test.tsx` (`// @vitest-environment jsdom`). Acceptance: Space lifts, arrows move one
  cell, Shift+arrows resize one cell, Enter drops, Esc / blur / Tab restore the pre-lift placement,
  and every one of those emits an announcement.

## Model Hints

- `D5 → deliverable-hard` — the only place @dnd-kit's pointer/overlay lifecycle, the refusal
  semantics of the pure reducer and an immediate `state.json` write meet; getting the "invalid but
  not applied" path wrong silently corrupts a saved layout, and `SortableList`'s list-shaped wiring
  is a misleading template for a 2D grid.
- `D6 → deliverable-hard` — a hand-written lift state machine that has to cancel correctly on three
  different exits (Esc, blur, Tab) while sharing one reducer with the pointer path, with the
  announcement text as the observable contract; a subtle miss here leaves the keyboard path a
  half-working promise that no screenshot catches.
- D1, D2, D3, D4 → default.
- `Review: → story-review-hard` — 14 criteria spanning main persistence, a pure engine, two input
  modalities and the verification harness; the expensive failure mode of this story is an
  uncovered criterion (a11y or the narrow state) that a cheap review reads past.

## Acceptance Tests

- AC1 → unit `src/renderer/src/modules/home/dashboard/layout.test.ts` › "a move never compacts the
  other tiles" + e2e `npm run ui:verify` screen `home-dashboard` (seeded gapped layout renders at
  its stored cells)
- AC2 → e2e `npm run ui:flow home-dashboard-arrange` › step "narrow stacks and widening restores"
  (resize to 940 → one column in row-major order, resize back → original rects, `state.json`
  unchanged), plus screen `home-dashboard-narrow`
- AC3 → e2e `npm run ui:flow home-dashboard-arrange` › step "no drag outside arrange mode" (drag a
  tile 3 cells, rect unchanged; no grip in the accessibility tree)
- AC4 → e2e `npm run ui:flow home-dashboard-arrange` › step "entering arrange mode moves no tile"
  (tile rects captured before/after are identical; the catalog bar overlaps the dashboard box)
- AC5 → unit `layout.test.ts` › "an overlapping, out-of-bounds or sub-minimum change is refused
  with a reason" + e2e `home-dashboard-arrange` › step "an invalid drop is shown invalid and not
  applied"
- AC6 → unit `layout.test.ts` › "firstFreeSpot scans row-major for a fitting hole" + e2e
  `home-dashboard-arrange` › step "the catalog lists exactly the unplaced modules and Enter places
  one"
- AC7 → e2e `home-dashboard-arrange` › step "a tile can be returned to the catalog"
- AC8 → e2e `npm run ui:flow home-dashboard-keyboard` › steps "lift, move, resize, drop" and
  "Esc, blur and Tab each restore the pre-lift placement" + unit
  `src/renderer/src/modules/home/dashboard/useTileLift.test.tsx` › "cancel restores the pre-lift
  placement"
- AC9 → e2e `home-dashboard-keyboard` › step "every step is announced and mirrored in the status
  line" (live-region text and the visible status line assert equal after each key)
- AC10 → unit `src/main/services/state.test.ts` › "homeLayout round-trips and touches no setting" +
  e2e `home-dashboard-arrange` › step "an accepted change is on disk immediately" (reads
  `state.json` from the variant userData dir after the drop, before any restart)
- AC11 → unit `src/main/lib/schemas.test.ts` › "a record for an unknown module id is dropped" and
  "a module missing from the layout is not inserted"
- AC12 → e2e `home-dashboard-arrange` › step "reset to default asks, then restores the two 6×5
  tiles"
- AC13 → unit `layout.test.ts` — the file covers all six operations (place, move, resize, collide,
  stack, firstFreeSpot) with no import from React, Electron or `@dnd-kit`; `npm run typecheck`
  keeps it in the pure project
- AC14 → e2e `npm run ui:verify` — screens `home-dashboard`, `home-dashboard-arrange` (catalog
  visible) and `home-dashboard-narrow` present in `scripts/lib/screens.mjs`, run exits 0 (no
  serious/critical axe violation), plus `npm run ui:flow home-dashboard-arrange`

No manual residue.

## Done

_Filled by `/build 086`._
