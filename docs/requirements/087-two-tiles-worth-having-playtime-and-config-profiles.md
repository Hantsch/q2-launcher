---
id: 087
title: Two tiles worth having — playtime and config profiles
status: ready # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — A "Playtime & statistics" tile shows installations by status and engine,
      favourites, total playtime and the last session, from the `library` module's existing stats
      handler.
- [ ] **AC2** — A "Config profiles" tile lists profiles with their sync and care state, and
      opening one jumps into the config editor for that profile.
- [ ] **AC3** — The dashboard offers exactly these two modules; Gamebrowser, Friendlist,
      Downloads, Mods and Assets appear neither in the grid nor in the catalog.
- [ ] **AC4** — Every tile renders one of four explicit states — loading, error with a working
      retry, empty with a sentence and an action, filled — through one shared tile frame.
- [ ] **AC5** — A tile whose data source fails does not break the dashboard: the other tile keeps
      working and arrange mode still functions.
- [ ] **AC6** — The default layout of a fresh profile is the two tiles at 6 × 5 cells each, side
      by side, directly under the 320px hero, matching
      `docs/prototypes/home/a-large-hero.html`.
- [ ] **AC7** — All tile labels are i18n keys; only data crosses IPC as prose.
- [ ] **AC8** — All four states of both tiles are in the `ui:verify` registry, fed from the
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
  exactly playtime and config profiles" + e2e `npm run ui:verify` screen `home-arrange` (086's
  catalog screen) showing two catalog entries and no planned module
- AC4 → unit `src/renderer/src/modules/home/components/DashboardTileFrame.test.tsx` › "the frame
  renders loading, error with retry, empty and filled" + `useTileData.test.ts` › "retry re-runs the
  source after a failure"
- AC5 → e2e `npm run ui:flow -- home-tile-states` › "a failing tile leaves the other tile and
  arrange mode working"
- AC6 → unit `src/renderer/src/modules/home/dashboard/registry.test.ts` › "a fresh profile starts
  with two 6 × 5 tiles side by side under the hero"
- AC7 → unit `src/renderer/src/modules/home/dashboard/i18n.test.tsx` › "no tile state renders a
  translation key" (renders both tiles in all four states against the real `en` bundle)
- AC8 → e2e `npm run ui:verify` screens `home-dashboard-filled` (`populated`) and
  `home-dashboard-empty` (`empty`) at zero axe violations + `npm run ui:flow -- home-tile-states`
  for the loading and error states, which axe-scan the same way
  <!-- Deviation, decided in Decisions (Sprint): two of the four states are driven by a flow script
       rather than a registry entry, because a registry entry only receives `page` and no fixture
       data can make an in-memory aggregate fail. Still fully automated — not a manual residue. -->
- No manual residue.

## Done

_Filled by `/build 087`._
