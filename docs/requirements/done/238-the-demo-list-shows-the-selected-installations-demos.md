---
id: 238
title: the demo list shows the selected installation's demos
status: done # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player with several installations, the Demos view shows the demos of the installation I have
selected in the rail, so the list matches what I am about to play with and is not a mix of every
folder on my PC.

User feedback 2026-10-04: "the demo browser should only show the demos of the selected installation".
Today the list is a union of every installation's `demos/` folders plus the extra folders from
Settings (`discovery.ts`); each row only says where it came from. Playback, on the other hand, is
already tied to the active installation — a demo from elsewhere plays from a temporary copy.

Concept: [replays-module.md](../../systems/replays-module.md).

## Acceptance Criteria

- [x] **AC1** — The list shows only demos found in the active installation's folders (all its game
      dirs, and on Linux its Q2PRO write dir).
- [x] **AC2** — Switching the active installation in the rail switches the list, without a manual
      rescan and without losing the filter.
- [x] **AC3** — The view says whose demos it shows (installation name in the list header).
- [x] **AC4** — With no installation selected or none registered, the list shows an empty state
      that says why, not demos from elsewhere.
- [x] **AC5** — An empty list for the selected installation says so and names its demo folders,
      rather than looking like a scan error.
- [x] **AC6** — Favourites, ratings, tags and other sidecar data are unaffected by the scoping — a
      demo shows the same data whichever way it is reached.

## Open Questions

- ~~**Q1** — Where do the extra folders from Settings go? They belong to no installation.
  Recommendation: show them under every installation, in their own labelled group, since they are
  explicitly the user's own collection.~~ answered → Decisions (Sprint)
- ~~**Q2** — Is an "All installations" option still wanted (e.g. a toggle in the list header)?
  Recommendation: yes, off by default — the old union view is useful for finding a demo.~~ answered → Decisions (Sprint)
- ~~**Q3** — Interaction with [[242]] (folders): does the folder tree root at the installation?
  Recommendation: yes — one tree per selected installation.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Extra folders: in their own labelled group under every installation.
- **(User)** "All installations" option: kept as a toggle in the list header, off by default.
- **(User)** Folder tree root: the installation, one tree per selected installation.
- Triage: clear and ready, not trivial — it touches discovery, the row schema, one new handler and the view.
- The scan stays global (the union index) and scoping is a pure view filter — it is what makes AC2's "no
  rescan" switch instant and the "All installations" toggle free.
- A row carries `reachedBy: string[]` (every installation id whose scan reached the file); scoping uses it,
  never `source.installationId` alone — the Linux `~/.q2pro` write dir is shared by every Q2PRO installation
  and today's dedup credits it to the first one only, so B would silently lose its write-dir demos (AC1).
- `reachedBy` is optional in the schema, absent meaning "only `source.installationId`" — this keeps the ~13
  inline row fixtures valid; discovery always sets it, the index cache version is bumped.
- An extra folder that is also an installation's own `demos/` folder keeps today's dedup: it shows under
  that installation, not in other installations' extra group — it is that installation's folder, and
  "All installations" still finds it.
- Extra-folder rows are in scope for every installation; the group is labelled "Extra folders", sits after
  the installation's own demo roots at the folder root, and only renders when at least one extra folder exists.
- The "All installations" toggle is view state, not persisted — off by default is the decision, and a
  persisted "on" would silently bring back the mixed list on next start.
- Filter options, tag suggestions and the shown/total count are computed over the scoped rows; the filter
  value itself is kept across a switch even when an option is absent (AC2 "without losing the filter").
- On an installation switch the folder view returns to the tree root — the previous folder belongs to
  another installation's tree; a selected demo that leaves scope is deselected (the existing effect).
- The source-error strip shows only errors of in-scope sources (active installation + extra folders) — an
  unreadable folder of another installation is not this list's problem and would make AC5 look like an error.
- The scan-progress readout stays global — the scan is global and splitting counts adds nothing the user acts on.
- AC5's folders come from main (`demoFoldersRead`), not composed in the renderer — the Linux write dir needs
  the home dir and must match `effectiveWriteDirs` exactly; it lists the expected `demos` path of every game
  dir (existing or not), since the user needs to know where to put demos.
- AC4 with no installation selected or none registered: the toggle stays usable (it is the way to still
  find demos); the empty state wins only while it is off.

## Plan

Build on 242's recursive discovery and folder tree (242 builds first); scoping sits on top of it.

1. **Reach (main + shared):** `discoverDemos` records `reachedBy` on every row — the dedup branch that today
   drops a file already seen appends the installation id to the existing entry instead (both the loose-file
   and zip paths, and the write-dir shadow branch). Schema field optional, cache version bumped.
2. **Demo folders handler:** `demoFoldersRead({ installationId })` in the replays contract — the expected
   `demos` folder of every game dir plus the effective write dirs' ones, from one pure helper next to
   `effectiveWriteDirs`.
3. **Scoped view (renderer):** pure `scopeDemoRows` in `src/shared/replays/list-scope.ts`; `ReplaysView`
   feeds sort/filter/options from the scoped rows, header subtitle names the installation (or "All
   installations"), toggle in the header, extra-folder group at the folder root, folder view resets on switch.
4. **Empty states:** `deriveReplaysListState` learns `noInstallation` / `noneSelected` / `emptyForInstallation`;
   `ReplaysListStatus` renders them (the last lists the folders from 2); source errors filtered to scope.
5. Flows: a new scope flow (switch in the rail, toggle, sidecar data), the empty-state flow, and
   `replays-discovered-list` updated (its install-two demo is no longer in the default view).

Order D1 → D2 → D3 → D4. Systems doc `docs/systems/replays-module.md` is updated by D2 (handler) and D3 (scope).

## Deliverables

- **D1 — every row knows which installations reach it.** In `src/main/modules/replays/discovery.ts`
  (`discoverDemos`, as left by story 242's recursive scan): every entry gets `reachedBy: string[]`, starting
  with its own installation id (extra-folder entries: `[]`). Where the scan finds a file whose key is
  already in `seenKeys` while scanning installation N, it appends N's id to that existing entry's
  `reachedBy` (no duplicates) instead of just skipping — for loose files, for zip entries
  (`expandZipsInto`), and for the write-dir shadow branch (the shadowing entry keeps the accumulated list).
  Extra folders never add to `reachedBy`. Schema: `src/shared/modules/replays.ts` `discoveredDemoSchema`
  gains `reachedBy: z.array(z.string()).optional()` with a doc comment "absent = reached only by
  `source.installationId`". Bump `REPLAYS_INDEX_CACHE_VERSION` in `src/main/modules/replays/index-cache.ts`.
  Check `scan-service.ts` / `incremental-scan.ts`: a row carried over from the cache keeps its fresh
  discovery `reachedBy` (discovery output wins, never the cached copy). `demo-rename.ts` spreads the row
  (line ~272) and so keeps it — leave it, but assert it in a test. Tests in
  `src/main/modules/replays/discovery.test.ts`: "a Q2PRO write dir shared by two installations is reached
  by both" (platform `linux`, two Q2PRO installations, one `~/.q2pro/baseq2/demos/x.dm2` → one row,
  `reachedBy` = both ids, in order), "a file reached once lists only its own installation", "an extra-folder
  row is reached by no installation"; in `src/main/modules/replays/demo-rename.test.ts`: "a renamed row
  keeps its reachedBy". Files: discovery.ts, replays.ts (shared), index-cache.ts, scan-service.ts (only if
  needed), discovery.test.ts, demo-rename.test.ts.

- **D2 — main answers an installation's demo folders.** New handler `demoFoldersRead: 'demoFolders.read'`
  in `REPLAYS_HANDLERS` (`src/shared/modules/replays.ts`), payload schema `{ installationId }` using the id
  primitive from `src/shared/schemas.ts` (mirror the existing `demoPlay` payload's installation id field),
  result `{ folders: string[] }` (absolute paths, display only). Main: a pure
  `demoFolderPaths(installation, ctx)` exported from `src/main/modules/replays/discovery.ts` beside
  `effectiveWriteDirs` — `join(rootPath, gameDir, 'demos')` for every `gameDirs` entry, then
  `join(writeDir, gameDir, 'demos')` for every effective write dir × game dir; handler in
  `src/main/modules/replays/index.ts` looks the installation up the same way `demoPlay` does and answers
  `notFound`-style error key (reuse the one `demoPlay` uses for an unknown installation). Register following
  the module's typed handler pattern (story 232). Tests: `src/main/modules/replays/discovery.test.ts` ›
  "demo folders list every game dir's demos folder and, on Linux Q2PRO, the write dir's"; the IPC coverage
  test picks up the channel automatically. Update `docs/systems/replays-module.md` `## Handlers` with one
  line for it.

- **D3 — the list is scoped to the rail's installation, with an "All installations" toggle.** New pure
  `src/shared/replays/list-scope.ts`: `type DemoListScope = { kind: 'installation'; installationId: string }
| { kind: 'all' } | { kind: 'none' }` and `scopeDemoRows(rows, scope)`: `all` → every row; `none` → `[]`;
  `installation` → rows with `source.kind === 'extraFolder'` or whose `reachedBy ?? [source.installationId]`
  contains the id; never copies or alters a row (same objects, so sidecar data is identical). Test
  `src/shared/replays/list-scope.test.ts` › "scoping keeps the active installation's and extra-folder rows",
  "a row reached by two installations is in both scopes", "scoping returns the same row objects".
  `src/renderer/src/modules/replays/ReplaysView.tsx`: scope from `useActiveInstallation()` (already
  imported) plus a `showAll` `useState(false)`; `scopedDemos = scopeDemoRows(demos, scope)` feeds
  `sortedDemos`, `filterOptions`, `otherDemosTags`, `rowCount` and the filter bar's total — the
  unscoped `demos` stays the patch target (`handleRowPatched`/`handleRenamed`). Header: under the `h1` a
  subtitle `data-testid="replays-scope-label"` — `replays.scope.installation` ("{{name}}'s demos") or
  `replays.scope.all` ("All installations"); beside Refresh a toggle `data-testid="replays-scope-all"`
  (use the existing checkbox/switch primitive in `src/renderer/src/components/ui/`, label
  `replays.scope.toggle` "All installations"). Folder view (242's root level): the active installation's
  demo roots labelled by game dir, then — only if an extra folder exists — a heading
  `replays.scope.extraGroup` ("Extra folders", `data-testid="replays-extra-group"`) over the extra-folder
  roots; with the toggle on, every installation's roots labelled `replays.list.source`. When
  `activeInstallationId` changes, the folder view returns to the root; the filter state is untouched.
  Keys in `src/renderer/src/modules/replays/locale/en.json`. Component tests in
  `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "switching the active installation swaps the
  list and keeps the filter", "the header names the active installation", "the toggle shows every
  installation's demos". E2E flow `scripts/flows/replays-installation-scope.mjs` (populated fixture,
  `INSTALL_ONE` active; select the installation in the rail like `scripts/lib/mods-install-flow.mjs`
  `openMods` does): default view lists exactly the four install-one demos plus extra-folder demos (from
  `REPLAYS_FIXTURE_DEMOS`), header names "Fixture Favorite Install"; set a search filter, click "Fixture
  WriteDir Install" in the rail → only `team_q2dm3.mvd2` (+ extra) is listed, filter text still in the
  search field, no scan started (`replays-refresh` stays enabled / no loading strip); favourite a demo,
  turn the toggle on and off, the same row shows the same favourite. Update
  `scripts/flows/replays-discovered-list.mjs`: it asserts all five demos, so it turns the toggle on first.
  Update `docs/systems/replays-module.md` (Purpose + a short "Scope" note: global scan, view-side scope by
  `reachedBy`) and one `CHANGELOG.md` line under `## Unreleased` ("The demo list shows the selected
  installation's demos; a toggle shows all").

- **D4 — empty states say why.** `src/renderer/src/modules/replays/list-state.ts`:
  `deriveReplaysListState` gains inputs `scope` (`DemoListScope` kind) and `installationCount`, and new
  states `noInstallation` (none registered, toggle off), `noneSelected` (registered but none active, toggle
  off), `emptyForInstallation` (scan finished, scope `installation`, zero scoped rows); `empty` remains for
  the `all` scope. Tests in `src/renderer/src/modules/replays/list-state.test.ts` › one per state.
  `src/renderer/src/modules/replays/ReplaysListStatus.tsx` renders them: `replays-list-no-installation`
  (`replays.scope.noInstallation` "No installation yet — add one to see its demos."),
  `replays-list-none-selected` (`replays.scope.noneSelected` "Select an installation in the rail to see
  its demos."), `replays-list-empty-installation` (`replays.scope.emptyFor` "No demos in {{name}} yet.
  It looks in:" + one `data-testid="replays-list-empty-folder"` line per folder, neutral `text-ink-muted`,
  no warning icon — it must not read as an error), keeping the existing "Add a demo folder in Settings"
  button. Folders come from `demoFoldersRead` via a new wrapper in
  `src/renderer/src/modules/replays/client.ts`, read with `useModuleQuery` keyed on the active id only while
  that state is shown. `sourceErrors` passed to the strip are filtered to in-scope sources (active
  installation's `installation` sources + `extraFolder`) unless the toggle is on. Component tests in
  `src/renderer/src/modules/replays/ReplaysListStatus.test.tsx` (create if missing) › "an empty installation
  names its demo folders and shows no warning", "another installation's source error is not shown in
  scope". E2E: update `scripts/flows/replays-list-empty.mjs` (variant `empty`, zero installations) to assert
  `replays-list-no-installation`; new `scripts/flows/replays-scope-empty.mjs` on the populated fixture:
  select an installation with no demos in the rail (if the populated fixture has none, add an
  installation without demos to `scripts/lib/fixture/populated.mjs` or a new variant) → `replays-list-empty-installation`
  with its `<root>/baseq2/demos` folder line; for "none selected" add a variant with
  `settings.activeInstallationId: null` (mirror `export const variant` in `replays-list-empty.mjs` and the
  variant registry it uses) and assert `replays-list-none-selected` in the same flow file's second run or a
  sibling flow `replays-scope-none-selected.mjs`.

## Model Hints

- D1 → deliverable-hard: the dedup in `discoverDemos` has three skip paths (loose file, zip entry,
  write-dir shadow that replaces an entry in place) and missing any one silently drops a shared Linux
  Q2PRO write-dir demo from the second installation's list, with a cache version bump that must not let a
  stale cached row win over fresh discovery.
- D2, D3, D4 → default.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-installation-scope.mjs` › "replays-installation-scope"; unit
  `src/main/modules/replays/discovery.test.ts` › "a Q2PRO write dir shared by two installations is reached
  by both" (Linux write dir); unit `src/shared/replays/list-scope.test.ts` › "scoping keeps the active
  installation's and extra-folder rows".
- AC2 → e2e `scripts/flows/replays-installation-scope.mjs` › "replays-installation-scope"; component
  `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "switching the active installation swaps the list
  and keeps the filter".
- AC3 → e2e `scripts/flows/replays-installation-scope.mjs` › "replays-installation-scope"; component
  `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "the header names the active installation".
- AC4 → e2e `scripts/flows/replays-list-empty.mjs` › "replays-list-empty" (none registered); e2e
  `scripts/flows/replays-scope-empty.mjs` › "replays-scope-empty" (none selected, or its sibling
  `replays-scope-none-selected`); unit `src/renderer/src/modules/replays/list-state.test.ts` (one test per state).
- AC5 → e2e `scripts/flows/replays-scope-empty.mjs` › "replays-scope-empty"; component
  `src/renderer/src/modules/replays/ReplaysListStatus.test.tsx` › "an empty installation names its demo
  folders and shows no warning"; unit `src/main/modules/replays/discovery.test.ts` › "demo folders list every
  game dir's demos folder and, on Linux Q2PRO, the write dir's".
- AC6 → e2e `scripts/flows/replays-installation-scope.mjs` › "replays-installation-scope" (favourite survives
  toggle); unit `src/shared/replays/list-scope.test.ts` › "scoping returns the same row objects"; unit
  `src/main/modules/replays/demo-rename.test.ts` › "a renamed row keeps its reachedBy".

Coverage: AC1 → D1+D3 · AC2 → D3 · AC3 → D3 · AC4 → D4 · AC5 → D2+D4 · AC6 → D1+D3.

## Done

**Summary.** The scan stays global; rows carry `reachedBy` (every installation whose scan reached the file, shared Linux write dir included) and the Demos view scopes by it to the rail's installation plus the extra-folder group, with a header label, an "All installations" toggle (view state, off by default) and empty states that say why (no installation, none selected, empty installation listing its demo folders via `demoFoldersRead`).

**Commit message:** `238: demo list scoped to the selected installation — reachedBy, All-installations toggle, empty states, demoFolders.read`

**Verification** (narrow gate; `test-story` = `npx vitest run --changed HEAD`, green 175 files/1512 tests; comments + architecture green; build/typecheck/lint green).

- e2e: `--affected` selected 132 flows (too many for one call, `scripts/lib` touched), so the 3 new flows plus every `replays-*` flow (56) ran in batches: all green on a freshly seeded fixture (two fix rounds). Non-replays flows selected by `--affected` were not run; the sprint's full gate covers them.
- AC1: flow replays-installation-scope + discovery.test "a Q2PRO write dir shared by two installations is reached by both" + list-scope.test; AC2/AC3: flow + ReplaysView.test; AC4: flows replays-list-empty, replays-scope-empty, replays-scope-none-selected + list-state.test; AC5: flow replays-scope-empty + ReplaysListStatus.test + discovery.test (demo folders); AC6: flow + list-scope.test + demo-rename.test. All passed. No manual residue.
- Flows share the `populated` fixture; run in a loop without reseed, `replays-rename`/`demo-file-actions` leave a persisted search that reds later flows (pre-existing hygiene issue; `ui:flows` reseeds per flow).

**Decisions.**

- D1 also reuses the first walk of a root already scanned (`scannedRoots`): story 242's visited-set made the second installation sharing `~/.q2pro` see only top-level files.
- `scan-service.toRow` takes `reachedBy` from fresh discovery on cache hits; index cache version bumped.
- Flows needing the union list use `openAllDemos` / `showAllInstallations` (shared helper in `replays-copy-in.mjs`); with the toggle on, roots read "<installation> · <gameDir>".
- Toggling "All installations" also returns the folder view to the root (review finding).
- `demoFoldersRead` answers an unknown installation with `WRONG_INSTALLATION`, the key `demoPlay` uses.
- `docs/systems/replays-module.md` condensed to stay within its 150-line cap.
- Known, not fixed (predates story): on Linux, installation B with a root demo at the same relative path as a shared write-dir demo A already listed yields two rows with one id, visible only with the toggle on.

tiers: D 4 / hard 1 · review default · cycles 1 · agents 10
