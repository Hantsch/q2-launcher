---
id: 086
title: The dashboard is a grid I arrange myself
status: done # draft -> ready -> in-progress -> done
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

- [x] **AC1** — The grid is 12 columns wide with 40px rows; a tile stores `x`, `y`, `w`, `h` in
      cells, and gaps are kept — the layout is never compacted by the launcher.
- [x] **AC2** — Columns shrink proportionally with the window; below the narrow threshold the grid
      renders as a single column in layout order, and the stored layout is unchanged by that
      (widening restores the arrangement exactly).
- [x] **AC3** — Outside arrange mode no drag or resize can start, and tiles behave as ordinary
      clickable content.
- [x] **AC4** — Entering arrange mode moves no tile: the catalog bar and the status line are
      docked over the dashboard, not pushed into its flow.
- [x] **AC5** — A move or resize that would overlap another tile, leave the grid, or go below the
      tile's minimum size is refused, and is shown as invalid while dragging rather than silently
      snapping back.
- [x] **AC6** — The catalog lists exactly the modules that are not currently placed; an entry can
      be dragged into the grid or placed with Enter at the first free spot that fits it.
- [x] **AC7** — A placed tile can be returned to the catalog from arrange mode.
- [x] **AC8** — Keyboard parity: Space/Enter on a handle lifts, arrows move one cell,
      Shift+arrows resize by one cell, Enter drops, and Esc, blur or Tab cancels and restores the
      placement the tile had before the lift.
- [x] **AC9** — Every lift, move, resize, drop and cancel is announced in a live region and
      mirrored in a visible status line.
- [x] **AC10** — Each change is persisted as it happens, in its own `state.json` key with its own
      schema and defensive parse; `LauncherSettings` gains no field.
- [x] **AC11** — A stored record for an unknown module id is dropped on load, and a module that is
      missing from the layout is not auto-inserted.
- [x] **AC12** — "Reset to default" restores the shipped default layout after a confirmation.
- [x] **AC13** — The layout engine (place, move, resize, collide, stack, first free spot) is a
      pure, unit-tested module.
- [x] **AC14** — Arrange mode, the catalog and the narrow single-column state are in the
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

- [x] **D1 — `homeLayout` persists, unknown ids do not.** `src/shared/modules/home.ts` (new: constants,
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
- [x] **D2 — the layout engine.** `src/renderer/src/modules/home/dashboard/layout.ts` +
  `layout.test.ts`. Pure: `place`, `move`, `resize`, `collides`, `stack`, `firstFreeSpot`, min-size
  floor, 12-column and row bounds, refusal reasons. Acceptance: a refused operation returns the
  input layout untouched and a reason; nothing is ever compacted; `firstFreeSpot` scans row-major.
- [x] **D3 — the dashboard renders, and shrinks.** `src/renderer/src/modules/home/dashboard/`
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
- [x] **D4 — arrange mode, catalog, reset.** `ArrangeBar.tsx` (catalog + status line, docked),
  `HomeHeader.tsx` (arrange toggle, disabled while single-column), `ResetLayoutDialog.tsx` (mirror
  `src/renderer/src/components/installations/RemoveInstallationDialog.tsx`), tile grip/remove
  affordances in `DashboardTile.tsx`, `en.json`, one `scripts/lib/screens.mjs` entry
  (`home-dashboard-arrange`) and further steps in `scripts/flows/home-dashboard-arrange.mjs` (mode
  entry moves no tile, catalog lists exactly the unplaced modules, Enter places, remove returns, reset confirms).
  Acceptance: tile rects are byte-identical before and after entering arrange mode.
- [x] **D5 — pointer move and resize.** `DashboardGrid.tsx` (`DndContext`, `PointerSensor`,
  drag-from-catalog), `DashboardTile.tsx` (resize grip), `layout.ts` untouched, plus the drag steps
  in `scripts/flows/home-dashboard-arrange.mjs`. Mirror the sensor/overlay wiring in
  `src/renderer/src/components/dnd/SortableList.tsx`. Acceptance: an overlapping or out-of-grid drop
  shows the ghost invalid and leaves the tile where it was; an accepted drop writes `state.json`
  immediately.
- [x] **D6 — keyboard parity and announcements.** `useTileLift.ts` (lift state machine),
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
  (tile rects captured before/after entering arrange mode are byte-identical; the bar's slot is
  reserved permanently, so nothing shifts on entry)
- AC5 → unit `layout.test.ts` › "an overlapping, out-of-bounds or sub-minimum change is refused
  with a reason" + e2e `home-dashboard-arrange` › step "an invalid drop is shown invalid and not
  applied" (the `dashboard-drag-ghost`'s `data-invalid` flips mid-drag, the tile's rect and
  `state.json` are unchanged after release)
- AC6 → unit `layout.test.ts` › "firstFreeSpot scans row-major for a fitting hole" + e2e
  `home-dashboard-arrange` › steps "the catalog lists exactly the unplaced modules and Enter places
  one" (keyboard half) and "a catalog entry can be dragged onto the grid" (pointer half, added by
  D5)
- AC7 → e2e `home-dashboard-arrange` › folded into "the catalog lists exactly the unplaced modules
  and Enter places one" (removing `configProfiles` and asserting it left the grid before it is
  placed back)
- AC8 → e2e `npm run ui:flow home-dashboard-keyboard` › steps "lift, move, resize, drop" and
  "Esc, blur and Tab each restore the pre-lift placement" (three independent sub-cases, each
  committing a real move first) + unit
  `src/renderer/src/modules/home/dashboard/useTileLift.test.tsx` › "cancel restores the pre-lift
  placement" and `Dashboard.test.tsx` › the cancel-mid-write race added in the review-fix cycle
- AC9 → e2e `home-dashboard-keyboard` › step "every step is announced and mirrored in the status
  line" (the visible status line and the `aria-live="polite"`/`aria-atomic="true"` region are the
  same DOM node; asserts the text changes after each key)
- AC10 → unit `src/main/services/state.test.ts` › "homeLayout round-trips and touches no setting" +
  e2e `home-dashboard-arrange` › steps "a pointer drag moves/resizes a tile, and the accepted change
  is on disk immediately" and `home-dashboard-keyboard`'s own per-keystroke `state.json` reads (all
  read `state.json` from the variant userData dir right after the change, before any restart)
- AC11 → unit `src/main/lib/schemas.test.ts` › "a record for an unknown module id is dropped" and
  "a module missing from the layout is not inserted", plus the review-fix cycle's additions (a
  non-integer or negative coordinate, and a duplicate `moduleId`, are each dropped the same way)
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

### Summary

Built D2–D6 on top of the already-landed D1 (persistence): the pure layout engine
(`layout.ts`), the read-only dashboard render with the narrow single-column fallback,
arrange mode with a docked catalog/status bar and a reset-to-default confirm, pointer
drag-and-resize via `@dnd-kit` (including drag-from-catalog and a live invalid-drop
ghost), and full keyboard parity (lift/move/resize/drop/cancel) sharing one reducer
with the pointer path, announced through a single visible-and-`aria-live` status line.
A clean-agent review (hard tier) passed with 11 findings; the two confirmed/plausible
correctness ones were fixed in one review-fix cycle (see Decisions below); the rest are
documented as deliberately unfixed with reasons.

### Commit message

```
086: the dashboard is a grid I arrange myself
```

### Decisions

- **D3 kept the pre-existing `HomeView.tsx` placeholder Panel (`home.title`/`home.lead`) in place**
  and mounted `<Dashboard/>` as an additional full-width sibling below it, rather than replacing it.
  Removing it would have required also reworking `HomeView.test.tsx`, `home-route-roundtrip.mjs` and
  `engine-not-client.mjs` (the last of which scrapes the Home screen's visible text for a "Quake II"
  sentinel that only `home.lead` currently provides — the seeded news fixture slides carry no such
  text) — none of which this story's Plan/Deliverables named. No AC requires the placeholder gone.
- **D5 moved `DndContext`/`PointerSensor` from `DashboardGrid.tsx` (as the Plan literally named) up
  to `Dashboard.tsx`.** A drag that starts on an `ArrangeBar` catalog chip and ends over the grid
  needs a common ancestor, and `ArrangeBar`/`DashboardGrid` are siblings — `Dashboard.tsx` is the only
  place that is both their common ancestor and already holds `layout`/`setHomeLayout`. Reviewed and
  confirmed sound (does not weaken AC3: both `useDraggable`s also carry `disabled: !arrangeMode`).
- **D5/D6 share one reducer entry point** (`Dashboard.tsx`'s `applyToLayout`, wrapping `layout.ts`'s
  `move`/`resize`/`place`) for both the pointer ghost's live validity and the keyboard path's
  per-keystroke validity — there is no second "is this legal?" implementation anywhere.
- **D6: every accepted keyboard keystroke commits immediately** (`setHomeLayout` per arrow-move or
  Shift+arrow-resize), rather than accumulating one uncommitted candidate until Enter — `layout.ts`'s
  `move()`/`resize()` each derive the tile's "other" dimension from `layout.tiles` itself, so a lift
  session mixing an in-session move and an in-session resize would validate against stale data if
  nothing were committed in between, and `layout.ts` was frozen for this story. Enter/"drop" is
  therefore a pure interaction-state exit with nothing left to persist; Esc/blur/Tab explicitly
  revert whatever the session already committed back to the pre-lift snapshot.
- **`GRID_GAP_PX = 12`** was added to D1's `src/shared/modules/home.ts` (additive only) so the
  pointer path's pixel-to-cell math and `dashboard.css`'s real `gap: 12px` agree; the flow scripts'
  own drag-distance math uses the same simple `width / GRID_COLUMNS` convention rather than a more
  analytically exact pitch, deliberately, so the component and its own e2e proof can never disagree
  even if neither is pixel-perfect against CSS Grid's true rendered geometry.
- **Review-fix cycle (1 of 3 allowed) — fixed:**
  - `tilePlacementSchema` (`src/main/lib/schemas.ts`) tightened from "any finite number" to
    non-negative integers for `x`/`y`/`w`/`h`, and `parseHomeLayout` now drops a later tile that
    repeats an already-seen `moduleId` — a hand-edited/foreign `state.json` could otherwise persist
    an off-grid or fractional tile that the (correctly strict) pure engine would then refuse to ever
    fix, or a duplicate `moduleId` that collides with React's own keying.
  - `DEFAULT_HOME_LAYOUT.tiles`' aliasing into persisted state (`state.ts`'s `defaults()` and
    `resetLayout`'s handler both used to pass the module-level constant's array through by reference)
    fixed with a one-level clone at both sites — inert today, but a latent foot-gun otherwise.
  - The keyboard cancel race the Model Hints explicitly flagged as D6's hard part: `Dashboard.tsx`'s
    `handleKeyboardCancel` could read a stale `layout` closure if Esc/blur/Tab fired before an
    in-flight keystroke's `setHomeLayout` round trip resolved, silently leaving the move applied.
    Fixed with a `layoutRef` (updated synchronously at every commit) plus a promise-chain ref that
    serializes keyboard writes and that cancel now awaits before deciding whether to revert. A new
    regression test (`Dashboard.test.tsx`) reproduces the exact race and was verified to fail against
    the pre-fix code and pass against the fix.
- **Review-fix cycle — deliberately left unfixed, with reasons:**
  - *"The only axe-audited arrange screen has an empty catalog"* (the seeded fixture places both
    known modules, so `screens.mjs`'s `home-dashboard-arrange` entry never shows a catalog chip, the
    drag ghost, or the reset dialog under axe). Making that screen mutate the shared `populated`
    fixture's on-disk layout to force a populated catalog would leave later screens in the same
    batched `ui:verify` session running against an altered dashboard state — a real destabilization
    risk for marginal coverage gain, especially since the catalog chip, ghost and reset dialog are
    all already screenshotted (just not axe-audited) by the two `ui:flow` scripts. Left as a known
    gap rather than risking the harness's session-ordering guarantees for it.
  - *`useTileLift.test.tsx`'s "cancel restores the pre-lift placement" unit test only proves the hook
    hands `origin` to a mocked `onCancel`, not that `Dashboard.tsx`'s real revert logic works* — true,
    but the real revert is now proven twice over: end-to-end by `home-dashboard-keyboard.mjs`'s three
    Esc/blur/Tab sub-cases (each committing a real move first), and at the unit level by the new
    `Dashboard.test.tsx` added in the fix cycle for the race itself. No gap in what's actually proven.
  - Two minor findings (a `setStatus` call inside a `setArrangeMode` updater that's idempotent under
    StrictMode's double-invoke; the Decisions' "extends to the lowest occupied row plus 2 spare rows"
    rendering nicety, which nothing implements — CSS Grid's own implicit rows make a tile draggable
    past the last occupied row regardless, so no AC is affected) — cosmetic, no user-visible defect.

### Verification

- `npm run build` — clean.
- `npm run typecheck` — clean (both `tsconfig.node.json` and `tsconfig.web.json`), including after
  the review-fix cycle.
- `npm test` (`npx vitest run`) — 3538/3538 passed across 186 files (full repo suite, run once after
  the fix cycle; the two D3/D5 agents' own earlier reports of isolated timeouts under the default 5s
  timeout were confirmed to be harness flakiness, not real failures — the full run here is green with
  no special timeout needed).
- `npm run ui:verify` — 42/42 screens, 81/81 shots, 0 axe violations (critical/serious/moderate/minor)
  across the whole app, including the three new `home-dashboard`/`home-dashboard-arrange`/
  `home-dashboard-narrow` screens.
- `npm run ui:flow home-dashboard-arrange` — all 8 steps green (no-drag-outside-arrange-mode,
  narrow-stacks-and-widening-restores, entering-arrange-mode-moves-no-tile, catalog-Enter-place
  incl. AC7's return-to-catalog, reset-to-default, pointer-move, pointer-resize, invalid-drop,
  pointer-place-from-catalog).
- `npm run ui:flow home-dashboard-keyboard` — all 4 steps green (lift/move/resize/drop,
  Esc/blur/Tab-each-restore, announcements-mirror-the-status-line).
- Clean-agent review (`story-review-hard`): **PASS**, 11 findings, none AC-fatal; 3 fixed in one
  review-fix cycle (of 3 allowed), the rest documented above with reasons.
- AC → test mapping, as verified: all 14 criteria PASS per the review and the verification runs
  above; see `## Acceptance Tests` for the exact test names/paths, updated to match what was actually
  written (a few steps were folded or renamed from the original plan during implementation).
- No manual residue.
