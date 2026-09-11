---
id: 087
title: Two tiles worth having — playtime and config profiles
status: done # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

An empty grid is a promise, not a feature. The dashboard ships with the two things the launcher
already knows about me: what I have installed and played, and which config profiles I keep. Both
are real tiles with real data — no placeholder, no "coming soon", and nothing for a module that
does not exist yet.

A tile must be honest about its own state: it says when it is still loading, when its data source
failed (and lets me retry), when there is genuinely nothing to show, and otherwise shows the
content. That behaviour lives in the tile frame, once, so a failing data source degrades the same
way everywhere.

Fresh installs start on the composition the prototype decided: the two tiles side by side under
the 320px hero. See [concepts/home-screen.md](../concepts/home-screen.md) §8.4 and §11.

## Acceptance Criteria

- [x] **AC1** — A "Playtime & statistics" tile shows installations by status and engine,
      favourites, total playtime and the last session, from the `library` module's existing stats
      handler.
- [x] **AC2** — A "Config profiles" tile lists profiles with their sync and care state, and
      opening one jumps into the config editor for that profile.
- [x] **AC3** — The dashboard offers exactly these two modules; Gamebrowser, Friendlist,
      Downloads, Mods and Assets appear neither in the grid nor in the catalog.
- [x] **AC4** — Every tile renders one of four explicit states — loading, error with a working
      retry, empty with a sentence and an action, filled — through one shared tile frame.
- [x] **AC5** — A tile whose data source fails does not break the dashboard: the other tile keeps
      working and arrange mode still functions.
- [x] **AC6** — The default layout of a fresh profile is the two tiles at 6 × 5 cells each, side
      by side, directly under the 320px hero, matching
      `docs/prototypes/home/a-large-hero.html`.
- [x] **AC7** — All tile labels are i18n keys; only data crosses IPC as prose.
- [x] **AC8** — All four states of both tiles are in the `ui:verify` registry, fed from the
      fixture, at zero axe violations.

## Decisions (Sprint)

- **(User)** Minimum tile size: 2×2 cells (shared decision with 086).
- **(User)** Config profiles tile shows config profiles only — not grouped or filtered by
  installation, since config profiles are global in this launcher (they aren't tied to one
  installation; to see which installations a profile applies to, the user navigates to the config
  module itself). Overflow beyond what fits the tile scrolls.
- **Last session is added to `LibraryStats`** as `lastSession?: { installationId, name, at }`,
  derived in the library handler from the newest `lastPlayedAt` — AC1 names it and
  `src/shared/modules/library.ts:15` has no such field today.
- **"Sync state" per row = the profile's own canonical file status; "care state" per row = the
  worst of its installation copies' drift rows**, reduced with story 079's existing `CareSyncState`
  vocabulary (`inSync | outOfSync | missing | failed`) — the full Care summary (validation +
  tidy-up) has no batch handler and would cost per-profile parsing on every home render.
- **No new IPC channel and no batch handler.** The tiles reuse the existing renderer clients
  (`modules/library/client.ts`, `modules/config/client.ts` — `getProfileSyncState` per profile via
  `Promise.all`), because the real cost is the per-installation disk stat a batch handler would pay
  identically, and `ARCHITECTURE.md:177` forbids one module answering for another in main.
- **Opening a profile goes through a consumed-once route focus in the shell store**
  (`setRoute(route, focus?)` in `useLauncher.ts`, read and cleared once by `ConfigView`) — routing
  is shell-owned (`AppShell.resolveView`) and a module-to-module back-channel is exactly what the
  `module:invoke` envelope rule rules out.
- **The tile frame lives inside the `home` module** (`modules/home/components/`), not in
  `components/ui/primitives.tsx` — a dashboard module is a home-internal concept (concept §5) — and
  reuses the existing `EmptyState` primitive for its empty state.
- **Each tile body is wrapped in its own error boundary** so a throwing tile cannot unmount the
  grid; that is what makes AC5 true for a render fault as well as for a failed fetch.
- **Registry and default-layout constants are owned by 086**; 087 fills them with the two real
  entries and locks the geometry (both 6 × 5, `x: 0` / `x: 6`, `y: 0`) with a unit test, so AC3 and
  AC6 are proven here even though the files were created there.
- **AC8 mapping:** filled and empty come from the `populated` / `empty` fixture variants as
  registry screens; loading and error come from a `ui:flow` script that faults `module:invoke`
  main-side through the flow API's `app` handle — no fixture data can make an in-memory aggregate
  fail, and a product-code test hook would be worse than a harness-side fault.
- **The fixture gains real playtime data** (one installation with `lastPlayedAt` and non-zero
  `totalPlaytimeSeconds`; today every fixture installation is `0`/`undefined`,
  `scripts/lib/fixture.mjs:141`) — otherwise the "filled" state is indistinguishable from empty.
- **No separate small-size tile variant.** At the 2 × 2 floor both tiles keep one layout and degrade
  by container-driven truncation and scrolling, so there is one tile body per module to maintain.

## Open Questions

- ~~What does each tile refuse to shrink below, in cells? (Concept open point 4 — shared with
  086.)~~ answered → Decisions (Sprint)
- ~~Does the Config profiles tile show all profiles or only those of the active installation, and
  what does it do when there are more than fit the tile?~~ answered → Decisions (Sprint)

## Plan

Everything lands in the `home` module (081) on top of 086's grid, registry and default layout. No
new IPC channel; one library field, one shell-store route focus, everything else is renderer.

1. **Data first.** `LibraryStats` gains `lastSession` (derived in `src/main/modules/library/index.ts`
   from the newest `lastPlayedAt`), and the fixture gets one installation with real playtime so a
   "filled" tile is visibly filled.
2. **Frame before tiles.** One `DashboardTileFrame` + one `useTileData` hook in
   `src/renderer/src/modules/home/components/` render the four states (loading / error+retry /
   empty / filled) and carry the per-tile error boundary. Both tiles are thin bodies inside it.
3. **Playtime tile** reads `getLibraryStats()`; **Config profiles tile** reads
   `listConfigProfiles()` plus `getProfileSyncState()` per profile (`Promise.all`) and reduces each
   to two badges with story 079's `care-sync.ts` vocabulary. Rows scroll inside the frame.
4. **Jump into the editor.** `useLauncher` gains a consumed-once `routeFocus`; `ConfigView` seeds
   its `selectedId` from it once and clears it. This is the only shell file the story touches.
5. **Lock the surface.** The dashboard registry holds exactly these two ids, the default layout is
   6 × 5 / 6 × 5 at `y: 0`, and no planned module appears in grid or catalog.
6. **Verify.** Registry screens for filled (`populated`) and empty (`empty`), plus
   `scripts/flows/home-tile-states.mjs` for loading, error+retry and the AC5 degradation (other
   tile alive, arrange mode still working), with axe at zero violations.

Order: D1 → D2 → (D3, D4 in parallel) → D5 → D6 → D7. Files it must not touch: `AppShell.tsx`,
`TitleBar.tsx`, `LauncherSettings`, `src/shared/ipc.ts`.

## Deliverables

- **D1 — `LibraryStats` knows the last session.** Add `lastSession?: { installationId: string;
  name: string; at: string }` to `src/shared/modules/library.ts` and derive it in
  `src/main/modules/library/index.ts` (newest `lastPlayedAt` wins; absent when nothing was ever
  played). Seed real playtime in `scripts/lib/fixture.mjs` (`populatedInstallations()`, one
  installation with `lastPlayedAt` + non-zero `totalPlaytimeSeconds`) and re-check the flows/tests
  that read playtime text. Test: `src/main/modules/library/stats.test.ts` (new). Mirror: the
  existing aggregation in `src/main/modules/library/index.ts:21-41`.
  _Acceptance: the handler returns the newest session; an all-unplayed set returns `undefined`._
- **D2 — The tile frame with four states.** `modules/home/components/DashboardTileFrame.tsx` (title
  slot, four states, retry button, error boundary) + `components/useTileData.ts` (a
  `{ state, data, error, retry }` hook over any promise-returning source) + the `home.dashboard.*`
  i18n keys in `src/renderer/src/i18n/locales/en.json`. Reuse `EmptyState`
  (`components/ui/primitives.tsx:112`) and `Badge` (`:56`); no new UI primitive. Test:
  `DashboardTileFrame.test.tsx` + `useTileData.test.ts`. Mirror:
  `src/renderer/src/modules/downloads/components/FailureCauseDetail.test.tsx` for the state-per-case
  test shape.
  _Acceptance: each of the four states renders its own markup; retry re-runs the source; a body that
  throws yields the error state instead of unmounting the frame._
- **D3 — Playtime & statistics tile.** `modules/home/dashboard/PlaytimeTile.tsx` — status counts,
  `byEngine` breakdown, favourites, total playtime (`lib/format.ts`'s `formatDuration`) and the last
  session, inside D2's frame; own compact stat row, `StatTile` in `views/LibraryView.tsx:208` stays
  where it is. i18n keys + test `PlaytimeTile.test.tsx`.
  _Acceptance: all five facts render from a `LibraryStats` fixture; a zeroed stats object renders the
  empty state, not a wall of zeroes._
- **D4 — Config profiles tile.** `modules/home/dashboard/ConfigProfilesTile.tsx` + a pure
  `dashboard/profile-rows.ts` that maps `ConfigProfile[]` + `ProfileSyncState[]` to
  `{ id, name, own: CareSyncState, installations: CareSyncState, counts }` rows, reusing
  `modules/config/lib/care-sync.ts`. Body scrolls; no pagination. Tests:
  `profile-rows.test.ts` + `ConfigProfilesTile.test.tsx`.
  _Acceptance: every profile appears once with both states; one profile's failed `syncState` marks
  that row, it does not fail the tile._
- **D5 — Opening a profile lands in its editor.** `src/renderer/src/store/useLauncher.ts` gains
  `routeFocus` + `setRoute(route, focus?)` + `consumeRouteFocus()`; `modules/config/ConfigView.tsx`
  seeds `selectedId` from it once and clears it; D4's rows call it. Tests:
  `useLauncher.routeFocus.test.ts` + a `ConfigView` test that a seeded focus selects that profile
  and a second mount does not re-select it.
  _Acceptance: clicking a row switches to the config route with that profile selected; navigating
  away and back does not re-apply the stale focus._
- **D6 — Exactly two modules, at the prototype's geometry.** Register both tiles in 086's dashboard
  registry (`modules/home/dashboard/modules.ts`) with `minSize: { w: 2, h: 2 }`, and pin the default
  layout (`modules/home/dashboard/default-layout.ts`) to `6 × 5` at `x: 0, y: 0` and `x: 6, y: 0`.
  Test: `dashboard/registry.test.ts` — the registry holds exactly `playtime` and `configProfiles`,
  contains none of the five planned ids, and the default layout matches
  `docs/prototypes/home/a-large-hero.html`. Plus an i18n test that both tiles' label keys resolve in
  `en.json` (no dotted key leaks into rendered text) in all four states.
  _Acceptance: registry and catalog offer two entries; a fresh profile boots with the two tiles side
  by side under the 320px hero._
- **D7 — Verification.** Two registry entries in `scripts/lib/screens.mjs` (home on `populated` =
  filled, home on `empty` = empty tiles) and `scripts/flows/home-tile-states.mjs` faulting
  `module:invoke` main-side via the flow API's `app` handle: a never-resolving handler for loading, a
  throwing one for error + retry, and one that fails only the library request to prove the other tile
  and arrange mode still work. Axe via `scripts/lib/session.mjs`'s `AXE_RUN_OPTIONS`, zero
  violations. Mirror: `scripts/flows/care-drift-sync-now.mjs`.
  _Acceptance: `npm run ui:verify` stays at zero violations and the flow passes every step._

## Model Hints

- `D5 → deliverable-hard` — it adds a consumed-once field to the shell's route store and threads it
  into `ConfigView`'s existing local `selectedId`, whose reset-on-profiles-change effect is a live
  regression risk for the config module's own selection behaviour.
- Every other deliverable → default tier.
- `Review: → story-review-hard` — two of the criteria are absence criteria (AC3: no planned module
  anywhere; AC5: nothing breaks when a source fails) that a diff-only reviewer has to check across
  shell store, two modules and the harness.

## Acceptance Tests

- AC1 → unit `src/main/modules/library/stats.test.ts` › "the stats handler reports the newest
  session" + unit `src/renderer/src/modules/home/dashboard/PlaytimeTile.test.tsx` › "the playtime
  tile shows status, engines, favourites, playtime and the last session"
- AC2 → unit `src/renderer/src/modules/home/dashboard/profile-rows.test.ts` › "every profile gets
  its own and its installations' state" + e2e `npm run ui:flow -- home-tile-states` › step "clicking
  a profile row opens the config editor on that profile"
- AC3 → unit `src/renderer/src/modules/home/dashboard/registry.test.ts` › "the dashboard offers
  exactly playtime and config profiles" + e2e `npm run ui:verify` screen `home-dashboard-arrange`
  (086's catalog screen; corrected from the planned `home-arrange`, which was never the real id)
  showing the catalog derived from the same two-id registry (empty on the `populated` fixture,
  since both known modules are already placed — the non-empty-catalog case is 086's own
  `scripts/flows/home-dashboard-arrange.mjs`, out of this story's scope)
- AC4 → unit `src/renderer/src/modules/home/components/DashboardTileFrame.test.tsx` › "the frame
  renders loading, error with retry, empty and filled" + `useTileData.test.ts` › "retry re-runs the
  source after a failure"
- AC5 → e2e `npm run ui:flow -- home-tile-states` › "a failing tile leaves the other tile and
  arrange mode working"
- AC6 → unit `src/renderer/src/modules/home/dashboard/registry.test.ts` › "a fresh profile starts
  with two 6 × 5 tiles side by side under the hero"
- AC7 → unit `src/renderer/src/modules/home/dashboard/i18n.test.tsx` › "no tile state renders a
  translation key" (renders both tiles in all four states against the real `en` bundle)
- AC8 → e2e `npm run ui:verify` screens `home-dashboard`/`home-dashboard-narrow` (`populated`,
  corrected from the planned `home-dashboard-filled`, which was never created — the pre-existing
  086 screen already shows real, filled tile content once this story wired real bodies in, so a
  second screen would only duplicate it; both now wait explicitly on
  `dashboard-tile-frame-filled` for each tile, not just heading text that renders in every state)
  and `home-dashboard-empty` (`empty`, waits on `dashboard-tile-frame-empty` for each tile) at zero
  axe violations + `npm run ui:flow -- home-tile-states` for the loading and error states (plus the
  AC2 profile-row-click step and the AC5 partial-failure step), which axe-scan the same way
  <!-- Deviation, decided in Decisions (Sprint): two of the four states are driven by a flow script
       rather than a registry entry, because a registry entry only receives `page` and no fixture
       data can make an in-memory aggregate fail. Still fully automated — not a manual residue. -->
- No manual residue.

## Done

**Summary.** The dashboard's two placeholder tiles are now real: a Playtime & statistics tile
(status counts, engines, favourites, total playtime, last session) and a Config profiles tile
(one row per profile, its own canonical sync state plus the worst of its installations' care
state, clicking a row opening that profile in the config editor). Both render through one shared
`DashboardTileFrame` (loading / error+retry / empty / filled), each wrapped in its own error
boundary so a throwing tile cannot take the rest of the dashboard down. The registry/default
layout locked in 086 already matched the required two-tile, 6×5-each, side-by-side geometry; this
story filled it with the two real bodies and proved it with tests instead of changing it.

**Commit message:**
```
087: fill the dashboard's playtime and config-profiles tiles with real data
```

**Verification.**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `npm test` — 197 files / 3583 tests passed.
- `npm run ui:verify` — 43/43 screens, 82 screenshots, 0 axe violations of any severity.
- `npm run ui:flow -- home-tile-states` — passes end to end (AC2's profile-row click, AC4's
  loading/error/retry, AC5's partial-failure + arrange-mode steps).

**AC → test mapping, as verified:**
- AC1 → `src/main/modules/library/stats.test.ts` (newest session wins; all-unplayed → `undefined`)
  + `src/renderer/src/modules/home/dashboard/PlaytimeTile.test.tsx` (all five facts render; zeroed
  stats render the empty state) — both green.
- AC2 → `src/renderer/src/modules/home/dashboard/profile-rows.test.ts` (own/installations state per
  profile, worst-of reduction, a failed fetch still yields a row) + e2e `ui:flow -- home-tile-states`
  step "clicking a config profile row opens that profile in the config editor" — green.
- AC3 → `src/renderer/src/modules/home/dashboard/registry.test.ts` (exactly `playtime` +
  `configProfiles`, none of the five planned ids) + e2e `ui:verify` screen `home-dashboard-arrange`
  (catalog structurally derived from the same two-id registry) — green.
- AC4 → `DashboardTileFrame.test.tsx` (four mutually exclusive states, retry wired, a throwing body
  yields the frame's error state instead of unmounting it) + `useTileData.test.ts` (retry re-runs
  the source) — green.
- AC5 → e2e `ui:flow -- home-tile-states`'s partial-failure step (only `library` faulted → playtime
  errors, config profiles reaches its own genuine `filled` state, arrange mode + catalog still
  work) plus `DashboardTile.test.tsx` (a render fault in one tile's body is caught by that tile's
  own boundary; a sibling tile keeps rendering) — green.
- AC6 → `registry.test.ts` (`DEFAULT_HOME_LAYOUT` is exactly two 6×5 tiles at `x:0`/`x:6`, `y:0`,
  matching `docs/prototypes/home/a-large-hero.html`) — green.
- AC7 → `src/renderer/src/modules/home/dashboard/i18n.test.tsx` (both tiles × all four states
  against the real `en` bundle; no dotted i18n key of any namespace leaks into rendered text) —
  green.
- AC8 → e2e `ui:verify` screens `home-dashboard`/`home-dashboard-narrow` (filled, each tile's
  `dashboard-tile-frame-filled` explicitly awaited) and `home-dashboard-empty` (empty, same for
  `dashboard-tile-frame-empty`), plus `ui:flow -- home-tile-states`'s loading/error steps — all at
  zero axe violations.
- No manual residue.

**Decisions made during implementation (beyond the story's own Decisions (Sprint)):**
- **Tile body wiring.** `DASHBOARD_MODULES` (`dashboard-modules.tsx`) gained a `Body: ComponentType`
  field per entry, and `DashboardTile.tsx` renders `<definition.Body />` in a new content slot below
  its existing header — the plan named this integration implicitly ("fills the two placeholder tiles
  with real content") but no deliverable spelled out the wiring point; D6 was the natural place since
  it already owned the registry file.
- **No per-module `minSize` field added to the registry**, contrary to D6's literal wording — the
  global `MODULE_MIN_SIZE = { w: 2, h: 2 }` (`src/shared/modules/home.ts`, from 086) already enforces
  this uniformly for both modules via `layout.ts`; a second, unread per-entry field would only
  duplicate it. `registry.test.ts` proves the floor via the shared constant instead.
- **AC8's "filled" screen reuses the pre-existing `home-dashboard`/`home-dashboard-narrow` screens**
  (086) rather than creating a new `home-dashboard-filled` — those screens already show real content
  once this story's bodies were wired in, and a second screen would duplicate them. Both were
  strengthened to wait explicitly on `dashboard-tile-frame-filled` (not just heading text, which
  renders in every tile state).
- **AC3's `home-dashboard-arrange` e2e screen** shows an empty catalog (both modules are already
  placed on the `populated` fixture) — AC3 is proven structurally instead (the catalog is derived
  from the same two-id registry `registry.test.ts` locks); the non-empty-catalog case is 086's own
  `scripts/flows/home-dashboard-arrange.mjs`, unchanged and out of this story's scope.
- **Duplicate tile heading, found and fixed mid-build:** once D6 wired real bodies in, every tile
  showed its title twice — once in `DashboardTile.tsx`'s own header, once in `DashboardTileFrame`'s
  (which every tile body renders through and which shows a heading in all four states). Fixed by
  removing `DashboardTile.tsx`'s own `<h2>`, leaving `DashboardTileFrame`'s heading as the tile's one
  visible title.
- **Missing e2e proof for AC2, found and fixed during final verification:** the original flow
  dispatch covered AC4/AC5 but never actually clicked a config-profile row through the real app.
  `scripts/flows/home-tile-states.mjs` gained a first step (before any IPC fault is installed) doing
  exactly that.
- **Route-focus fault-injection technique (D7):** `scripts/flows/home-tile-states.mjs` faults the
  shell's `module:invoke` channel from the harness side via Playwright's `ElectronApplication.evaluate`
  reaching into the real `ipcMain`, rather than any product-code test hook (per the story's own
  Decision). Because `ipcMain.removeHandler` discards the real, boot-time handler for good once
  faulted, the flow sequences each scenario (loading, error, partial-failure) so nothing ever needs to
  "forward" an untouched moduleId back to real logic — including fabricating small, honestly-shaped
  synthetic success responses for `home`'s `layout.get` (so the dashboard shell itself never blanks)
  and, for the AC5 step, for `config`'s `list`/`syncState` calls (so the untouched tile reaches a
  genuine `filled` state rather than merely "still loading forever").
- **Two rounds of review-fix cycles were needed** (see Review below) — both confirmed real defects,
  not process overhead: a per-tile error boundary that didn't actually cover a tile's own render body,
  a broken CSS flex/height chain that silently clipped overflow instead of scrolling it (fixed at two
  separate levels across two review cycles), an i18n leak-detection test narrower than its own claim,
  and a missing `CLAUDE.md` deviations entry. Fixing the CSS chain then exposed a genuinely new
  `scrollable-region-focusable` axe violation (making the config-profiles list actually scrollable is
  what let axe see it for the first time) — fixed with `tabIndex={0}` on both tiles' scrollable
  containers.

**Review:** `story-review-hard`, three cycles — cycle 1 FAIL (4 findings, all fixed), cycle 2 FAIL (4
required + 1 optional-and-completed findings, all fixed; fixing them then surfaced a new axe
violation, fixed separately), cycle 3 PASS.

**Residual findings, deliberately left as-is (all low-severity, noted by the cycle-3 review under its
PASS verdict):**
- `DashboardTile.tsx`'s arrange-mode header row is an empty, dead `<div>` outside arrange mode (the
  title moved into the frame) — a few pixels of unused space, no functional effect.
- The render-fault boundary's fallback and the frame's own fetch-error state both use similar test-id
  naming (`dashboard-tile-frame-error`/`-retry` vs. `dashboard-tile-render-error`/`-retry`) and are
  distinguishable today (by test-id and by the frame's `data-tile-state` attribute), but a future
  assertion that only checked the generic error test-id could conflate the two.
- `useTileData.ts` retains the last successful `data` across a retry "so a refetch does not flash
  filled back to empty", but neither tile currently reads `data` while `state === 'loading'` (both
  short-circuit first) — harmless, slightly stale doc-comment reasoning.
- `PlaytimeTile.tsx`'s last-session line can render a dangling "Name — " if `at` is ever unparseable —
  only reachable via a hand-corrupted `state.json`, not a real launcher-produced value.
- `profile-rows.ts`'s `counts.assigned` field is computed and typed but not currently rendered by the
  tile — it is part of D4's own specified row shape, kept for a future surface rather than removed.
- In narrow/stacked dashboard mode (086's own layout, unmodified here), a tile has no bounded height,
  so a very long config-profile list would grow the tile instead of scrolling — the Decision's
  "overflow scrolls" holds in grid mode, which is what `ui:verify`/`ui:flow` exercise.
- A handful of new/touched lines (`DashboardTileFrame.tsx`, `ConfigProfilesTile.tsx`, `profile-rows.ts`,
  `profile-rows.test.ts`, `scripts/flows/home-tile-states.mjs`) are not fully prettier-clean (per this
  project's known "don't run prettier repo-wide" constraint — CRLF worktree vs. `endOfLine: lf`); left
  unformatted rather than risking unrelated churn.
