---
id: 244
title: I select several demos and delete, tag or move them
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player cleaning up a large demo collection, I select several demos at once and delete them,
tag them or move them to another folder in one action.

User feedback 2026-10-04: bulk actions in the demo list — multi-select, then delete, tag or move.

Today selection is a single demo, and there is no delete or move at all (left out of v1 on purpose,
[demo-browser.md](../concepts/demo-browser.md) §2); the only file actions are reveal, copy path and
rename.

## Acceptance Criteria

- [ ] **AC1** — Demos can be multi-selected: Ctrl/Cmd-click toggles, Shift-click selects a range,
      Ctrl+A selects all visible, Escape clears; each row also has a checkbox.
- [ ] **AC2** — With two or more demos selected, a bulk bar shows the count and the actions Delete,
      Tag and Move, and the detail panel shows a summary instead of one demo.
- [ ] **AC3** — Delete asks for confirmation naming the count, then moves the demos and their
      sidecars to the system trash/recycle bin.
- [ ] **AC4** — Tag adds one or more tags to every selected demo, and can remove a tag that some of
      them carry; demos without a sidecar get one.
- [ ] **AC5** — Move asks for a target folder and moves the demos with their sidecars; a name clash
      in the target is reported per demo and never overwrites a file.
- [ ] **AC6** — A bulk action reports its outcome ("12 deleted, 1 failed: in use") and leaves the
      failed demos selected.
- [ ] **AC7** — Zip entries in the selection are skipped for delete, move and tag, and the bar says
      how many and why, as visible text.
- [ ] **AC8** — A demo that is currently playing is not deleted or moved; it is reported as skipped.
- [ ] **AC9** — Delete and move work on Windows and Linux (trash on Linux via the desktop's trash).
- [ ] **AC10** — A folder (not a demo root, not a zip) can be deleted from its row's menu after a
      confirmation naming the folder and how many demos it holds; it goes to the trash with everything
      inside, and a folder holding a playing demo is refused. (decision on [[242]])
- [ ] **AC11** — A single demo can be deleted or moved from the detail panel and from its row's
      context menu, with the same confirmation, skip rules and outcome report as a bulk action.

## Open Questions

- ~~**Q1** — Move targets: only folders within the current tree ([[242]]), or also another
  installation's demos folder? Recommendation: any folder within the scanned demo roots, plus
  "Choose folder…".~~ answered → Decisions (Sprint)
- ~~**Q2** — Is single-demo delete/move (detail panel, context menu) part of this story?
  Recommendation: yes — a selection of one is the same action.~~ answered → Decisions (Sprint)
- ~~**Q3** — Depends on [[242]] for the folder target; build 242 first.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Move targets: any scanned demo-root folder plus "Choose folder…".
- **(User)** Single-demo delete/move (detail panel, context menu): in scope.
- **(User)** Dependency on 242: informational (build 242 first), acknowledged.
- Folder delete is in this story (AC10), because 242's binding decision "folder delete comes with 244
  behind the same confirmation" puts it here.
- Single-demo delete/move is written down as AC11 so the binding "in scope" decision has a
  deliverable and a test.
- Folder rows are not part of the multi-selection; a folder is deleted on its own from its row's
  menu, so one confirmation never mixes "N demos" with "a folder and everything inside it".
- "Ctrl+A selects all visible" means every row matching the current folder/search/filter (not just
  the virtualised on-screen rows), and Ctrl+A/Escape only act while focus is in the list, not in a
  text field or dialog. That is what the user can see the list holds.
- When the folder, search or filter changes, the selection is pruned to rows that are still
  visible, so an action never touches demos the user can no longer see.
- A plain click still selects just that demo (today's behaviour). The row checkbox toggles like
  Ctrl-click. Shift-click selects the range from the last plain- or Ctrl-clicked row in visible order.
- The bulk bar shows at two or more selected demos. After an action it stays visible, whatever the
  count, while it shows that action's outcome; the outcome is dismissed on the next selection change.
  Otherwise a single failed demo left selected would hide its own failure report.
- The outcome is one summary line ("12 deleted, 1 failed") plus a per-demo list of failed and skipped
  demos with their reasons, shown as visible text in the bar. AC5 needs clashes reported per demo.
- Skipped demos (zip entries, playing demos, a move into the folder they are already in) stay
  selected along with the failed ones, because they were not acted on.
- Delete always goes through `shell.trashItem`, reached via `OsService`. If the trash refuses
  (e.g. a Linux desktop without a trash), that demo is reported as failed and is never removed
  permanently, because a user's demo collection must not be silently destroyed.
- Move never overwrites. If a demo or its sidecar already exists in the target, that demo is
  reported and nothing is touched. The demo moves first and its sidecar after; if the sidecar step
  fails, the demo is moved back (same rollback shape as `demo-rename.ts`). A cross-device move
  copies without overwriting, keeps the modification time, then removes the source, because a move
  to another drive through "Choose folder…" is a normal case.
- "Choose folder…" opens the native folder dialog **in main** (harness: `uiHarnessPickedFolders`).
  Tree targets are sent as 242's folder identity and resolved and contained by main, so no
  renderer path ever reaches the file system (CLAUDE.md).
- Demos moved to a chosen folder outside every scanned root leave the index (and so the list). The
  index only ever holds scanned roots.
- Delete, move, tag and folder delete are refused as a whole while a scan is running, the same
  rule as `demo.rename`. Mutating files under a scan in flight is the race rename already rules out.
- Bulk tag reuses the existing tag rules (trim, max 40 chars, case-insensitive dedupe, max 50 tags)
  through one shared `mergeTags` helper. A demo whose sidecar is broken (error state) is reported as
  failed and never written, as concept §8.1 requires.
- The Tag dialog shows the union of tags across the selection with how many demos carry each; any
  of them can be removed, and new tags can be added. That is the smallest UI that satisfies AC4.
- A bulk action is one IPC call processed sequentially in main, and the bar shows a busy state.
  There are no per-item progress events, to keep the contract small; a progress channel can come
  later if users report slow trash runs.
- No Delete-key shortcut: AC1 lists the keyboard set, and a destructive shortcut is not asked for.
- The row context menu opens on right-click and on Shift+F10 / the context-menu key, using the
  existing `Menu.tsx` primitive. It offers the actions that apply to what it was opened on (a demo
  outside the selection selects that demo first), so it is keyboard reachable and needs no new
  primitive.
- Zip entries: in the single-demo surfaces Delete/Move stay visible but disabled with the reason as
  text, the same pattern rename uses today (concept §8.1, platform/read-only parity rule).

## Plan

Build after 242 (folder tree, folder identity, single-demo drag-move) and 243 (in-place detail
editor). Reuse what 242 left; never build a second copy of its move or containment code.

1. **Main, file operations** (D1): `demo-file-ops.ts` deletes (trash) and moves demos and their
   sidecars item by item. It skips zip entries and playing demos, refuses while scanning, never
   overwrites, and updates the index (`scan.applyMoves`). `OsService.trashItem` gets a harness stub.
2. **Main, tags** (D2): `demo-bulk-tags.ts` adds and removes tags across demos using a shared
   `mergeTags` helper.
3. **Main, folder delete** (D3): `demo-folder-delete.ts` uses D1's trash and index helpers.
4. **Contract + handlers** (D4): channels `demos.delete`, `demos.move`, `demos.tag`,
   `demoFolder.delete` in the replays contract with zod schemas, handlers in `index.ts`, a main-owned
   folder pick, renderer `client.ts` wrappers, and the systems doc.
5. **Renderer, selection** (D5): a pure selection helper plus store wiring, row checkbox, and
   mouse/keyboard selection.
6. **Renderer, bulk bar + delete** (D6): bulk bar, detail-panel summary, delete confirmation and
   outcome report.
7. **Renderer, tag + move dialogs** (D7).
8. **Renderer, single-demo + context menu + folder delete UI** (D8), plus the changelog.

Order D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8. Main is unit-tested; each renderer D carries its
own ui:flow.

## Deliverables

- **D1 — Demo delete/move service in main.** New `src/main/modules/replays/demo-file-ops.ts` (+
  `demo-file-ops.test.ts`) exports `createDemoFileOps({ scan, sessions, os, fs? })` with
  `delete(ids)` and `move(ids, targetDir)` → `Outcome<BulkOutcome>`. `BulkOutcome` and its item type
  are new in `src/shared/replays/bulk.ts`: per item `{ demoId, status: 'done'|'failed'|'skipped',
  reasonKey, params? }`; the module is pure, with no node imports. Rules:
  - Refuse the whole call with `replays.bulk.error.scanning` while `scan.isScanning()`.
  - Resolve every id via `scan.resolveFile`, never a path. Unknown id → failed `unknownDemo`.
    `archiveEntry !== null` → skipped `archiveEntry`. `sessions.isPlaying(id)` → skipped `playing`.
  - Delete: `os.trashItem(demoPath)`, then the sidecar `${path}.json` if it exists. A rejection is
    reported as failed: `inUse` for EBUSY/EPERM/EACCES, else `trashFailed`. Never fall back to
    `fs.rm`.
  - Move: if the target folder equals the demo's folder (`pathKey`) → skipped `alreadyThere`. If the
    demo or its sidecar exists in the target → failed `exists`/`sidecarExists`, nothing touched.
    Moving uses `fs.link` + `unlink` (atomic no-overwrite). On `EXDEV`/`EPERM`/`ENOTSUP`, fall back
    to `copyFile(COPYFILE_EXCL)` + `utimes` (keep the mtime) + `unlink`. The demo goes first, then
    the sidecar; if the sidecar step fails, move the demo back. If that undo fails →
    `rollbackFailed` naming both locations. This mirrors `demo-rename.ts`'s step and undo shape and
    its `errnoCode`/`exists` seams, which move into `src/main/modules/replays/fs-steps.ts` so both
    files share them. If 242 built a single-demo move, generalise that instead of adding a second one.
  - After the items: one `scan.applyMoves([{ id, newPath | null }])`, a new method in
    `scan-service.ts` next to `applyRename`. `null` (deleted, or moved outside every scanned root) drops
    the row; a new path re-ids it via `demoIdForPath`.
  - Add `trashItem(path)` to `OsService` (`src/main/services/os.ts` + `os.test.ts`, extending
    `shell` to `Pick<…, 'trashItem'>`). Under the harness, move the path into
    `<userData>/harness-trash/` and record it (new `harnessTrashDir()` in `src/main/lib/ui-harness.ts`,
    next to `harnessRevealedPathsFilePath`); otherwise call `shell.trashItem`.
  Tests: the names in Acceptance Tests for AC3, AC5, AC6, AC7, AC8, AC9, plus "a sidecar failure
  moves the demo back" and "a cross-device move keeps the modification time".

- **D2 — Bulk tag service in main.** Extract `mergeTags(tags, add, remove)` into
  `src/shared/replays/sidecar-draft.ts`; `addTag`/`removeTag` call it, keeping the trim, 40-char,
  case-insensitive and 50-tag rules, and existing tests stay green. New
  `src/main/modules/replays/demo-bulk-tags.ts` (+ test) exports `createDemoBulkTags({ scan, sidecars })`
  with `tag(ids, add, remove)` → `Outcome<BulkOutcome>`. It refuses while scanning, skips
  `archiveEntry`, and treats a sidecar in `error` state as failed `sidecarBroken`, never written. A
  demo without a sidecar gets one through `sidecars.write`. If a demo would exceed 50 tags →
  failed `tagLimit`. If nothing changes, the item is still `done` but no write happens. Tags do not
  change file paths, so no index re-path; the renderer re-reads rows.

- **D3 — Folder delete in main.** New `src/main/modules/replays/demo-folder-delete.ts` (+ test):
  `deleteFolder(folderId)` resolves 242's folder identity to a real directory, contained in a scanned
  root using 242's containment helper. It refuses `isRoot` (a demo root itself), `archive` (a zip
  folder), `scanning`, and `playing` (any `sessions.isPlaying` row under the folder). Otherwise it calls
  `os.trashItem(dir)` (D1) and then `scan.applyMoves` with `null` for every row under the folder.
  Returns `Outcome<{ demoCount }>`; a trash rejection → `trashFailed`, never `fs.rm`.

- **D4 — Contract, handlers, folder pick, client, systems doc.** In `src/shared/modules/replays.ts`
  (in whatever handler-contract shape story 232 left), add these channels with zod schemas (`demoIds`
  a non-empty array of ids, max 10 000; tags ≤ 40 chars, max 50 per list):
  - `demos.delete { demoIds }`
  - `demos.move { demoIds, target: { kind: 'folder', folderId } | { kind: 'pick' } }` → `{ cancelled: true } | BulkOutcome`
  - `demos.tag { demoIds, add, remove }`
  - `demoFolder.delete { folderId }`
  Register the handlers in `src/main/modules/replays/index.ts`, wiring D1–D3. `kind: 'pick'` calls a
  new `DialogService.pickFolder()` (`src/main/services/dialog.ts` + test), whose harness stub reads
  `uiHarnessPickedFolders(app.harness)`. A folder target is resolved and contained in main. Add typed
  wrappers in `src/renderer/src/modules/replays/client.ts`. Update `docs/systems/replays-module.md`
  (file actions: delete/move/tag/folder delete, trash rule, no-overwrite rule, skip rules).
  Tests: `index.test.ts` › "bulk channels reject a payload carrying a path" and `dialog.test.ts` ›
  "pickFolder returns the harness folder without opening a dialog".

- **D5 — Multi-select in the renderer.** New pure `src/renderer/src/modules/replays/selection.ts` (+
  test): `toggle`, `range(anchor, id, visibleOrder)`, `all(visibleOrder)`, `clear`, `prune(visible)`.
  Wire it into the list state (`list-state.ts`, or the store 242 left, next to `selectedId`):
  `selectedIds` plus an anchor. The detail panel's single demo is shown only when exactly one is
  selected; moving to two or more counts as a selection change for 243's save-on-leave. Wire it in
  `DemoRow.tsx`: a checkbox (24px hit area, labelled, `data-testid="replays-row-select"`), plus
  Ctrl/Cmd-click and Shift-click. Wire it in `VirtualDemoList.tsx`: Ctrl+A and Escape only while
  focus is in the list. Prune on folder/search/filter change. Flow
  `scripts/flows/replays-multi-select.mjs`, mirroring `replays-rename.mjs`'s setup/teardown.

- **D6 — Bulk bar, summary, delete, outcome.** New `components/BulkActionBar.tsx` (count; Delete/Tag/
  Move; skipped-zip line "N zip entries are skipped: demos inside a zip are read-only" as visible
  text; busy state; outcome summary + per-demo failed/skipped list with reasons). New
  `components/SelectionSummary.tsx` in the detail panel (count, total size, zip count). Delete
  confirmation via the existing `components/ui/ConfirmDialog.tsx`, naming the count excluding
  skipped zips. After the action, re-read the list and set the selection to failed + skipped ids.
  Wire it into `ReplaysView.tsx`. Add i18n keys in `src/renderer/src/i18n/locales/en/` for every
  `replays.bulk.*` reason from D1–D3. Flow `scripts/flows/replays-bulk-delete.mjs` (fixture
  demos + one zip; asserts files land in `harness-trash/`, the outcome text, and the failed or
  skipped rows staying selected).

- **D7 — Tag and Move dialogs.** New `components/TagDemosDialog.tsx`: the union of tags with counts,
  each removable, and an add input reusing `TagInput.tsx`. New `components/MoveDemosDialog.tsx`: the
  folders of every scanned demo root from 242's folder model, indented, the current folder marked,
  plus a "Choose folder…" button → `kind: 'pick'`. Both report through D6's outcome. Flow
  `scripts/flows/replays-bulk-tag-move.mjs`: tag two demos (one without a sidecar → the sidecar
  is created), remove a tag one of them carries, move them into a subfolder with one name clash
  (that demo reported, the target file unchanged byte for byte), and move via `Q2L_UI_PICK_FOLDER`.

- **D8 — Single-demo actions, row context menu, folder delete UI, changelog.**
  - `components/DemoFileActions.tsx`: Delete… and Move… for the single demo. For a zip entry they are
    disabled with the reason as visible text, the rename pattern.
  - New `components/DemoRowMenu.tsx`, on `components/ui/Menu.tsx`: right-click, Shift+F10 and the
    context-menu key on a row. It offers reveal, copy path, rename, move and delete for one demo, or
    delete, tag and move for the selection; opening it on a row outside the selection selects that
    row first.
  - The folder row's menu gets "Delete folder…": a `ConfirmDialog` naming the folder and its demo
    count. For a root or a zip folder it is disabled with the reason as text.
  - All of these reuse D6/D7's dialogs and outcome.
  - Add one `CHANGELOG.md` line under Unreleased › Added.
  Flow `scripts/flows/replays-demo-context-menu.mjs`.

## Model Hints

- D1 → deliverable-hard. Moving user files with their sidecars has several traps: no-overwrite has
  to hold atomically (Windows `rename` replaces existing files); a cross-device fallback has to keep
  the mtime the index dates by; a sidecar failure needs the demo-first undo; and a trash rejection
  must never become a permanent `rm`. A wrong step here loses or overwrites a user's demos.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-multi-select.mjs` › "replays-multi-select"; unit
  `src/renderer/src/modules/replays/selection.test.ts` › "range selects the visible order between anchor and target"
- AC2 → e2e `scripts/flows/replays-bulk-delete.mjs` › "replays-bulk-delete"
- AC3 → e2e `scripts/flows/replays-bulk-delete.mjs` › "replays-bulk-delete"; unit
  `src/main/modules/replays/demo-file-ops.test.ts` › "delete trashes each demo and its sidecar"
- AC4 → e2e `scripts/flows/replays-bulk-tag-move.mjs` › "replays-bulk-tag-move"; unit
  `src/main/modules/replays/demo-bulk-tags.test.ts` › "a demo without a sidecar gets one, a broken sidecar is never written"
- AC5 → e2e `scripts/flows/replays-bulk-tag-move.mjs` › "replays-bulk-tag-move"; unit
  `src/main/modules/replays/demo-file-ops.test.ts` › "a name clash in the target is reported and never overwritten"
- AC6 → e2e `scripts/flows/replays-bulk-delete.mjs` › "replays-bulk-delete"; unit
  `src/main/modules/replays/demo-file-ops.test.ts` › "a busy file is reported as in use and the rest proceed"
- AC7 → e2e `scripts/flows/replays-bulk-delete.mjs` › "replays-bulk-delete"; unit
  `src/main/modules/replays/demo-file-ops.test.ts` › "zip entries are skipped for delete and move"
- AC8 → unit `src/main/modules/replays/demo-file-ops.test.ts` › "a playing demo is skipped for delete and move"
- AC9 → unit `src/main/services/os.test.ts` › "trashItem hands the path to shell.trashItem and never removes it itself";
  unit `src/main/modules/replays/demo-file-ops.test.ts` › "a trash failure is reported and nothing is removed permanently";
  manual residue: the real Windows Recycle Bin and a Linux desktop trash — the harness deliberately
  never touches the OS trash (story 209's record-instead-of-OS rule).
- AC10 → e2e `scripts/flows/replays-demo-context-menu.mjs` › "replays-demo-context-menu"; unit
  `src/main/modules/replays/demo-folder-delete.test.ts` › "a root, a zip folder or a folder with a playing demo is refused"
- AC11 → e2e `scripts/flows/replays-demo-context-menu.mjs` › "replays-demo-context-menu"

## Done
