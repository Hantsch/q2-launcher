---
id: 242
title: I browse my demos in their folders
status: done # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player with hundreds of demos sorted into subfolders, the Demos view finds demos in those
subfolders and lets me browse them folder by folder, like Google Drive: open a folder, see its
subfolders and demos, go back up via a breadcrumb.

User feedback 2026-10-04: most users have many demos and structure them in subfolders; the demo
browser should allow that too, "Google Drive style".

Today discovery reads each `demos/` folder one level deep only ("never recursive", `discovery.ts`),
so demos in subfolders are not found at all, and the list is flat.

Concept: [replays-module.md](../../systems/replays-module.md), [demo-browser.md](../../concepts/demo-browser.md).

## Acceptance Criteria

- [x] **AC1** — Demos in subfolders of a scanned demo folder are found, at any depth.
- [x] **AC2** — The list shows the current folder's subfolders first, then its demos; a folder row
      shows its name and how many demos it contains.
- [x] **AC3** — Opening a folder (double-click or Enter) shows its content; a breadcrumb shows the
      path from the root and each crumb goes back to that level.
- [x] **AC4** — Search and filters apply across all folders below the current one, and each match
      shows the folder it is in; clearing them returns to the folder view.
- [x] **AC5** — The user can create a new folder in the current folder and rename an empty or
      non-empty folder; a rename moves sidecars along with their demos.
- [x] **AC6** — Demos can be moved into another folder by drag and drop (single demo here; several
      at once is [[244]]).
- [x] **AC7** — Scanning a large tree (e.g. 5 000 demos in 200 folders) keeps the view responsive, and
      a folder loop (junction/symlink) does not hang the scan.
- [x] **AC8** — Zip archives keep behaving as today — read-only; whether a zip shows as a folder is
      decided in refine.

## Open Questions

- ~~**Q1** — Should zips appear as browsable folders (read-only)? Recommendation: yes — it is the same
  mental model, and their entries are already expanded today.~~ answered → Decisions (Sprint)
- ~~**Q2** — Delete folder: in scope, or only with [[244]]'s delete? Recommendation: with 244, behind
  the same confirmation.~~ answered → Decisions (Sprint)
- ~~**Q3** — Root of the tree: per installation (with [[238]]) — and how do extra folders appear?
  Recommendation: one top-level folder per demo root (each game dir's `demos/`, each extra folder).~~ answered → Decisions (Sprint)
- ~~**Q4** — Is a maximum scan depth needed? Recommendation: no hard depth, but loop detection by real
  path.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Zips: appear as browsable read-only folders.
- **(User)** Folder delete: comes with 244 behind the same confirmation.
- **(User)** Tree root: one top-level folder per demo root (each game dir's demos/, each extra folder).
- **(User)** Max scan depth: no hard depth, loop detection by real path.
- Top level: the first crumb "All demos" lists only the root folders, never demos — the direct
  reading of the User root decision.
- Root folder label = the existing source label (`installation · gameDir`, or the extra folder's
  path) — users already know these strings from the row's source cell.
- Folder row count = every demo at any depth below it — in a deep tree it shows where the demos are.
- Empty folders are listed (count 0) — otherwise a just-created folder would be invisible.
- Folders sort by name (case-insensitive, numeric-aware) before demos and ignore the column sort;
  demos keep the current sort — the Drive model, and the column sort has no meaning for folders.
- Single click on a folder row only focuses it; double-click or Enter opens it; the demo detail
  panel is untouched — matches AC3 without a new selection type.
- The current folder lives in a module store: it survives a route switch, not a restart; if it
  vanishes after a scan, the view falls back to its nearest existing ancestor — same lifetime as the
  demo selection in `useDemoEditorStore`.
- Search mode = `isDemoFilterActive(filter)`: a flat list of matches below the current folder (all
  roots at top level), each row's source cell showing the root label plus folder path; the
  breadcrumb stays and still navigates; clearing returns to the folder view of the same folder —
  AC4 read literally, with the existing filter predicate as the switch.
- Recursion: no depth cap; one visited set of real-path keys (`pathKey(canonicalizePath(dir))`),
  pre-seeded with every root's real path, so a loop is never followed and a root nested in another
  root is walked only as its own root — one mechanism covers loops and overlapping roots.
- Symlinks/junctions are followed for reading, but create/rename/move only write where the target's
  real path is inside the root's real path — writes stay contained, as `isInside` requires.
- `_launcher` (`LAUNCHER_DIR_NAME`) directly under an installation's `demos/` is skipped — it holds
  playback's temporary copies and was only invisible because the scan was flat.
- A demo in a subfolder plays from the temporary copy (`demo-play.ts` keeps its "same dir as
  `demos/`" in-place rule) — no playback change needed, a test pins it.
- Zips: a zip shows as a folder row with the archive marker; its entries (and inner directories)
  are inside; create, rename and drop are visible but disabled there with the visible reason text
  "Archive — read-only" — the concept's read-only rule (§2) applied to folders.
- Root folders carry no rename action — they are an installation's `demos/` or a Settings extra
  folder, managed elsewhere.
- Folder payloads are `{ sourceKey, path: string[] }` (relative segments, never an absolute path);
  each segment passes a shared folder-name validator built on the same invalid-character/reserved-name
  rules as demo rename (extracted, not copied) — paths from the renderer are never trusted.
- Create, rename and move are refused while a scan runs; rename/move are refused while a demo inside
  is playing; a name clash is refused and never overwrites; a case-only folder rename is allowed —
  mirrors `demo-rename.ts`.
- After a folder op main remaps its scan snapshot and parse cache in place (no rescan, no re-parse);
  the renderer re-reads `indexRead` + `foldersRead`; folder rename returns an old→new id map so the
  selected demo stays selected — renaming a 500-demo folder must not trigger 500 re-parses.
- Move = demo plus sidecar with rollback, cross-device via `moveFile`'s EXDEV fallback; returns the
  new row; the moved demo leaves the current folder and its selection clears — keeps the helper
  ready for 244's cross-root Move.
- Drop targets: non-archive folder rows in the view and breadcrumb crumbs below "All demos";
  built on `@dnd-kit/core` (already a dependency) with its keyboard sensor — no second DnD stack.
- "New folder" sits in the breadcrumb bar; rename is an icon button on the folder row; both use the
  UI kit's `NameDialog` — the kit rule forbids a second dialog.
- Index cache stores each demo's folder path and the folder list; its version is bumped — the cache is
  disposable by design.
- Scan progress stays per root; subfolders share the root's source key — the readout stays as is.
- Existing replays flows and `ui:verify` screens that assumed a flat list are migrated through one
  shared flow helper that opens a root folder — the flat list is gone by design.

## Plan

1. **Shared pure pieces first** (D1): folder-name validator (rules extracted from
   `demo-rename.ts`), the folder-view builder (crumbs, folder rows with recursive counts, demos of
   the current folder, rows below a folder for search mode).
2. **Main: recursive discovery** (D2): `scanDemosDir` walks the tree with the real-path visited set;
   rows carry `folder: string[]`; zips become folder nodes; a `foldersRead` handler serves the
   folder list; cache version bump.
3. **Renderer: folder view** (D3): one virtual list of folder rows + demo rows, breadcrumb, folder
   store, open by double-click/Enter; migrate flows/screens (D4) right after, so the gate stays green.
4. **Search across folders** (D5): filter active → flat rows below the current folder with their
   path.
5. **Main: move a demo** (D6): file+sidecar move helper with rollback (extracted from rename),
   `demoMove`, snapshot remap of one file.
6. **Main: create / rename folder** (D7, hard): `folderCreate`, `folderRename`, snapshot + cache
   remap of a whole subtree, id map.
7. **Renderer: manage + drag** (D8 create/rename UI, D9 drag-and-drop move).
8. **Scale** (D10): 5 000 demos / 200 folders fixture + flow.

Affected: `src/shared/replays/` (new `demo-folders.ts`, `file-name-rules.ts`),
`src/shared/modules/replays.ts`, `src/main/modules/replays/{discovery,zip-demos,scan-service, index-cache,demo-rename,index}.ts` + new `demo-move.ts`, `demo-folders.ts`,
`src/renderer/src/modules/replays/` (view, list, new folder row/breadcrumb/store), flows + fixture,
`docs/systems/replays-module.md`, `CHANGELOG.md`.

## Deliverables

- [x] **D1 — Shared folder logic (pure).** New `src/shared/replays/file-name-rules.ts`: move the
      invalid-character set, reserved Windows names and trailing dot/space rule out of
      `src/shared/replays/demo-rename.ts` (which then imports them; its tests stay green). New
      `src/shared/replays/demo-folders.ts`:
      `validateFolderName(name): DomainResult<string, …>` (trimmed, 1–100 chars, no `/` `\`, not `.`/`..`, plus the shared rules; refusal keys `replays.folder.error.*`);
      `type FolderRef = { sourceKey: string; path: string[] }`;
      `buildFolderView({ rows, folders, current })` → `{ crumbs, folders: { ref, name, label?, archive, demoCount }[], demos }` where top level (`current === null`) lists one entry per root (label
      from the source, path `[]`), folders sort by `localeCompare(…, { sensitivity: 'base', numeric: true })`, `demoCount` counts rows at any depth below, folder nodes are the union of `folders`
      and every ancestor of a row's `folder`; `rowsBelow(rows, current)` for search mode;
      `nearestExisting(current, folders)`. Generic over a row accessor
      (`{ sourceKey, folder }`), so it does not depend on `DemoRow` details. Tests in
      `src/shared/replays/demo-folders.test.ts` and the existing `demo-rename.test.ts`.
- [x] **D2 — Recursive discovery + `foldersRead`.** `src/main/modules/replays/discovery.ts`:
      `scanDemosDir` recurses through `listDirOrReason` dirs at any depth; a visited set of
      `pathKey(canonicalizePath(dir))` (`src/main/lib/fs-utils.ts`) seeded with every root's real
      path before any walk, so a junction/symlink loop or a nested root is never descended; skip
      `LAUNCHER_DIR_NAME` (`demo-staging.ts`) directly under an installation `demos/`
      (case-insensitive). Each `DiscoveredDemo` gains `folder: string[]` (segments relative to its
      root; schema in `src/shared/modules/replays.ts` `discoveredDemoSchema`). Zips
      (`zip-demos.ts`): entries get `folder = [...zipFolder, zipFileName, ...entryDirs]`. Discovery
      also returns the root's folders `{ sourceKey, source, path, archive }[]` (every directory,
      empty ones included, plus zip pseudo-folders with `archive: true`). `scan-service.ts` keeps them
      in its snapshot; `index-cache.ts` persists folder paths + folder list, cache version bumped.
      New handler `foldersRead` (`REPLAYS_HANDLERS`, empty `.strict()` schema, registered in
      `index.ts`) returns the snapshot's folders. Tests in `discovery.test.ts` ("a demo three
      folders deep is found with its folder path", "a junction loop does not hang the scan" — create
      the loop with `fs.symlink(target, link, 'junction')`, "an empty subfolder is listed",
      "`_launcher` copies are not listed"), `zip-demos.test.ts` ("zip entries sit inside the zip's
      folder"), `demo-play.test.ts` ("a demo in a subfolder of demos plays from a copy"). Update
      `docs/systems/replays-module.md` (External inputs: recursive, loop detection; handler
      `foldersRead`).
- [x] **D3 — Folder view in the list.** `src/renderer/src/modules/replays/`: `client.ts`
      (`foldersRead`); new `folder-store.ts` (Zustand: `current: FolderRef | null`, `open`, `up`);
      new `components/DemoFolderRow.tsx` (inline-SVG folder glyph, name, "n demos", archive marker
      with "Archive — read-only" text; `data-testid="replays-folder-row"`, Enter/double-click open);
      new `components/DemoBreadcrumb.tsx` (`nav` with `aria-label`, crumbs as buttons,
      `data-testid="replays-breadcrumb"`/`replays-crumb`; last crumb `aria-current="page"`);
      `components/VirtualDemoList.tsx` renders a union item list (`folder` | `demo`, same
      `DEMO_ROW_HEIGHT`); `ReplaysView.tsx` reads folders with the index (and after each scan),
      builds the view with D1's `buildFolderView`, falls back via `nearestExisting`; `locale/en.json`
      (`replays.folder.*`). Fix `ReplaysView.test.tsx` for the folder view and add "folders come
      before demos and open on Enter". Add one line to `CHANGELOG.md` under Unreleased: "Demos:
      browse your demo subfolders — breadcrumb, new/rename folder, drag a demo to move it."
- [x] **D4 — Flows follow the folder view.** `scripts/lib/replays-copy-in.mjs`: add
      `openFolder(page, ...names)` (double-clicks `replays-folder-row` by text, waits for the crumb).
      Every flow under `scripts/flows/replays-*.mjs` that expects demo rows without searching
      (archive-readonly, cinema-_, console-command, demo-detail, demo-rows, detail-quick-edit,
      discovered-list, edit-_, extra-folders, fullscreen, incremental-scan, list-_, mod-_, play-_,
      row-quick-rating, sort-order, stage-_, stop, timeline-*, zip-entries) calls it after
      `openDemos`; the `replays-*` screens in `scripts/lib/screens.mjs` likewise. Mechanical; the
      only acceptance is `npm run ui:flows` green for every `replays-*` flow and `npm run ui:verify`
      green. New flow `scripts/flows/replays-folders.mjs` (fixture: demos in `demos/a/b/c/` and a zip
      in `demos/`): top level shows roots; opening the root shows subfolders first with counts, then
      demos; opening `a`→`b`→`c` shows the deep demo; each crumb returns to its level; the zip opens as
      a folder with its entries and the read-only text.
- [x] **D5 — Search across folders.** `ReplaysView.tsx`: while `isDemoFilterActive(filter)`, the
      list is D1's `rowsBelow(sortedDemos, current)` filtered as today (no folder rows); `DemoRow.tsx`
      source cell shows `root label / seg / seg` (new prop `folderText`); clearing the filter
      returns to the folder view of the unchanged `current`. Test in `ReplaysView.test.tsx`
      ("search matches demos in every folder below the current one and shows their folder"); flow
      `scripts/flows/replays-folders-search.mjs`.
- [x] **D6 — Move one demo (main).** Extract the demo+sidecar rename-with-rollback steps of
      `src/main/modules/replays/demo-rename.ts` into new `demo-relocate.ts`
      (`relocateDemo(fs, from, to)` — demo then `${path}.json`, undo on failure, collision checks
      for both names, EXDEV via `moveFile` in `fs-utils.ts`); `demo-rename.ts` uses it. New
      `demo-move.ts` + handler `demoMove { id, target: FolderRef }` (schema in
      `src/shared/modules/replays.ts`, segments via D1's `validateFolderName`): resolves `id` via
      `scan.resolveFile`, the target from the snapshot's folders (must exist, `archive: false`, real
      path inside the root's real path); refuses archive entries, playing demo, running scan, clash
      (`replays.move.error.*`); then `scan.applyRelocate(oldId, newPath, folder)` (generalise
      `applyRename` in `scan-service.ts`; rekey cache entry, no re-parse); returns the composed
      `DemoRow`. Register in `index.ts`; add `demoMove` to `docs/systems/replays-module.md`.
      Tests: `demo-move.test.ts` ("moves demo and sidecar", "a clash in the target is refused and
      overwrites nothing", "a sidecar failure rolls the demo back", "a playing demo is not moved"),
      `demo-rename.test.ts` stays green.
- [x] **D7 — Create and rename a folder (main).** New `src/main/modules/replays/demo-folders.ts` +
      handlers `folderCreate { parent: FolderRef, name }` and `folderRename { folder: FolderRef, name }` (schemas in `src/shared/modules/replays.ts`; registered in `index.ts`). Both resolve
      root + segments from the snapshot (never an absolute path), validate the name with D1, require
      the real path inside the root's real path, refuse a root (`path: []`) for rename, archive
      folders, a running scan (`replays.folder.error.*`). Create: `mkdir` non-recursive, refuse
      existing. Rename: refuse clash (case-only rename allowed via `pathKey`), refuse if
      `sessions.isPlaying` for any demo below; `fs.rename` of the directory (sidecars move with it);
      then `scan.applyFolderRelocate(oldDir, newDir)` in `scan-service.ts` rewrites every file and
      folder below the prefix (path, `folder`, id via `demoIdForPath`, `fileById`, cache keys) without
      re-parsing, and the handler returns `{ ids: { from, to }[] }`. Tests in
      `demo-folders.test.ts` ("rename moves the sidecars with their demos", "rename keeps parsed facts
      without re-parsing", "a root cannot be renamed", "a folder with a playing demo is not renamed",
      "an existing name is refused", "create in an archive is refused", "a symlinked folder outside
      the root is refused"). Add both handlers to `docs/systems/replays-module.md`.
- [x] **D8 — Create / rename folder UI.** `components/DemoBreadcrumb.tsx` gets "New folder"
      (`replays-folder-new`; disabled at "All demos" and inside a zip, with the visible reason);
      `components/DemoFolderRow.tsx` gets a rename icon button (`replays-folder-rename`; absent on
      roots, disabled in zips); both open the UI kit `NameDialog`; `client.ts` (`folderCreate`,
      `folderRename`); `ReplaysView.tsx` re-reads index + folders after success and remaps the
      selected id from the returned map; refusals shown inline in the dialog. Test in
      `components/DemoFolderRow.test.tsx`; flow `scripts/flows/replays-folder-manage.mjs`
      (create `new`, rename a folder holding a demo with a sidecar, assert on disk both moved and the
      row still shows its sidecar data).
- [x] **D9 — Drag a demo onto a folder.** `VirtualDemoList.tsx` wraps rows in a `DndContext`
      (`@dnd-kit/core`, `PointerSensor` with the same 8px activation as
      `src/renderer/src/components/dnd/SortableList.tsx`, plus `KeyboardSensor`); `DemoRow.tsx`
      `useDraggable` (not for archive entries); `DemoFolderRow.tsx` and `DemoBreadcrumb.tsx` crumbs
      `useDroppable` (not archive folders, not "All demos"), with a visible drop highlight;
      `client.ts` (`demoMove`); `ReplaysView.tsx` replaces the row with the returned one (it leaves
      the current folder) and shows a refusal as a toast via `toastRefusal`/`toastOutcomeError`. Flow
      `scripts/flows/replays-folder-drag-move.mjs` (low-level `page.mouse` drag as in
      `controls-drag-reorder.mjs`; demo + sidecar land in the target on disk; a clash is reported and
      the target file is unchanged).
- [x] **D10 — Scale.** `scripts/lib/fixture/replays.mjs`: `writeReplaysFolderScaleFixture` (5 000
      placeholder demos in 200 folders, 4 levels, plus a junction loop `loop → ..` created with
      `symlinkSync(target, link, 'junction')`), variant `replays-folder-scale`. Flow
      `scripts/flows/replays-folders-scale.mjs`: the scan finishes (bounded by the flow timeout),
      folder rows show their counts summing to 5 000, opening a folder and returning via a crumb each
      render within 1 000 ms, and fewer than 100 rows are mounted at any time.

## Model Hints

- D7 → deliverable-hard: the in-place remap of a whole subtree in `scan-service.ts` (paths, ids,
  `fileById`, cache keys) is the one cross-file subtlety — a missed prefix case (case-folded Windows
  paths, a sibling `ab` matching prefix `a`) silently re-parses or orphans rows and their sidecar
  data.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/discovery.test.ts` › "a demo three folders deep is found with
  its folder path" + e2e `scripts/flows/replays-folders.mjs` › "replays-folders"
- AC2 → unit `src/shared/replays/demo-folders.test.ts` › "folders come first with their recursive
  demo count" + e2e `scripts/flows/replays-folders.mjs` › "replays-folders"
- AC3 → e2e `scripts/flows/replays-folders.mjs` › "replays-folders" + unit
  `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "folders come before demos and open on
  Enter"
- AC4 → e2e `scripts/flows/replays-folders-search.mjs` › "replays-folders-search" + unit
  `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "search matches demos in every folder
  below the current one and shows their folder"
- AC5 → e2e `scripts/flows/replays-folder-manage.mjs` › "replays-folder-manage" + unit
  `src/main/modules/replays/demo-folders.test.ts` › "rename moves the sidecars with their demos"
- AC6 → e2e `scripts/flows/replays-folder-drag-move.mjs` › "replays-folder-drag-move" + unit
  `src/main/modules/replays/demo-move.test.ts` › "moves demo and sidecar"
- AC7 → e2e `scripts/flows/replays-folders-scale.mjs` › "replays-folders-scale" + unit
  `src/main/modules/replays/discovery.test.ts` › "a junction loop does not hang the scan"
- AC8 → e2e `scripts/flows/replays-folders.mjs` › "replays-folders" (zip opens as a read-only
  folder) + unit `src/main/modules/replays/demo-folders.test.ts` › "create in an archive is refused"

## Done

Summary: The Demos view finds demos at any depth and browses them as folders (roots at top level, folders-first rows with recursive counts, breadcrumb, zips as read-only folders), searches across the folders below the current one, creates/renames folders (sidecars move along) and moves one demo by pointer or keyboard drag onto a folder or crumb. Main keeps the folder list and root dirs in the scan snapshot and index cache (cache v5) and remaps rename/move in place without re-parsing.

Commit message: `242: browse demos in folders — recursive discovery, folder view + breadcrumb, search across folders, create/rename folder, drag-move demo`

Verification (narrow gate, run twice: before and after the one review-fix cycle; second run is the result): `npm run build`, `typecheck`, `lint` green; `npx vitest run --changed HEAD` 175 files / 1518 tests green, `src/comments.test.ts`, `src/architecture.test.ts`, `systems-docs.test.ts` green. Flows: instead of `--affected` (too broad for a 10-minute call) the story's five flows (`replays-folders`, `-folders-search`, `-folder-manage`, `-folder-drag-move`, `-folders-scale`) plus every `replays-*` flow and `action-bar-view` (54) ran in batches of 7-14, all green; `ui:verify` on the 7 replays screens green, axe clean. AC → test as verified: AC1-AC8 each passed with the unit test and flow named in `## Acceptance Tests` (no manual residue). Review: stage 1 (default) returned FAIL on 2 spec points, fixed with the other findings and re-verified.

Decisions:

- Breadcrumb bar always renders once loaded (top level: only a disabled "New folder" with the visible reason "Open a folder first"); the `replays-breadcrumb` nav shows inside a folder and stays while a search matches nothing; a library with only empty folders still lists them.
- `DemoDragZone` hosts the `DndContext` (breadcrumb sits outside the list); keyboard drag starts on Ctrl+Space (own sensor, arrows move, Enter drops, Esc cancels) with an i18n hint, so a row's Enter/Space keeps selecting.
- Main records each root's absolute dir internally (never sent to the renderer) so empty and zip-only roots can be targets; folder-ref segments are validated for path safety only, new names with `validateFolderName`.
- Recursive scan counts the fixture decoy `old/nested.dm2`: list-loading flow and screen expect `REPLAYS_FIXTURE_SCANNED_TOTAL` (demos + 1).
- `replays-rename` now reads the map from the in-place input (story 243); `replays-zip-entries` split across the zip folder levels.
- `demoMove` also supports a changed source (groundwork for 244), the renderer offers same-root moves only. Duplicate `sourceLabel` (discovery.ts, ReplaysView.tsx) left as is.

tiers: D 10 / hard 1 · review default · cycles 1 · agents 19
