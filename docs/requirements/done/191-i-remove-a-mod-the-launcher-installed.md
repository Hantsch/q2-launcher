---
id: 191
title: I remove a mod the launcher installed
status: done # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player, I remove a mod I installed through the launcher. My own demos, configs and
screenshots in that folder survive. The launcher deletes exactly the files its install record
(story 190) lists, removes the folder only if it is then empty, and never touches a manually
installed mod.

Concept: [mods.md](../../concepts/mods.md) §10; requirements MOD-13, MOD-14.

## Acceptance Criteria

- [x] **AC1** — The detail panel of a catalog-installed mod offers _Remove_, behind a confirmation
      that names the installation and the mod.
- [x] **AC2** — After removal, every file in the install record is gone from the gamedir.
- [x] **AC3** — A file in the gamedir that is not in the install record (for example a recorded
      demo under `demos/`) still exists after removal.
- [x] **AC4** — The gamedir folder is deleted when it is empty after removal, and kept when it is
      not.
- [x] **AC5** — After removal, the install record is gone, the tile shows _not installed_, and the
      action bar picker no longer offers the mod if its folder was deleted.
- [x] **AC6** — While the game runs in that installation, removal waits before deleting and says
      so.
- [x] **AC7** — The remove channel refuses a mod with no install record, and deletes nothing.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — — A recorded file the user has changed since install (its hash differs from the record):
  delete it anyway, keep it, or list it in the confirmation? This is linked to story 190's Q2.
- ~~**Q2**~~ answered → Decisions (Sprint) — — If the removed mod was the installation's `activeGameDir` and its folder is gone, does
  the installation fall back to the base game silently (today's revalidation behaviour,
  `installations.ts`), or with a visible note?

## Decisions (Sprint)

- **(User)** Changed recorded file: ask per operation: the confirmation lists user-changed files and the user chooses delete or keep (same answer as 190 Q2 and 194 Q2)
- **(User)** activeGameDir fallback: falls back to the base game with a visible note
- A "changed" recorded file is one whose size or SHA256 differs from the record (size first, hash
  only when sizes match); a recorded file already missing is "already gone", not changed — this is
  the record's own definition of user change (concept §5).
- The changed-files choice is one answer for the whole operation (_Delete them too_ / _Keep them_),
  default _Keep them_ — the user decision says "per operation", and keeping is the non-destructive
  default for user data.
- The job re-checks changes at delete time, so "keep" keeps every file that differs from the record
  then, even if it changed after the preview — the preview is advisory, the job is authoritative.
- Removal is a job (`kind: 'mods-remove'`) inside `app.writeGuard.runWrite` — the write guard
  surfaces its wait only as a job's `waitingReason`, which is what AC6's "says so" reuses
  (Downloads row, action bar, detail panel).
- The record is dropped entirely after a successful removal, even when changed files were kept —
  AC5 requires it gone, and kept files become the user's (a _manual_ folder if the inspector still
  sees a game dir).
- If a delete fails (e.g. a file locked by another program), the job fails with a visible reason
  and the record is rewritten to list only the recorded files still on disk — the record stays
  truthful, so a retry removes exactly the remainder.
- Every recorded path must resolve (after `realpath` of its parent) inside the real
  `<root>/<gamedir>/`; one escaping entry refuses the whole removal before anything is deleted —
  the record lives in an editable state file and a partial delete of a suspect record is worse
  than none.
- Subdirectories that held recorded files are pruned deepest-first with a non-recursive `rmdir`
  when left empty, then the gamedir itself the same way — otherwise an empty `maps/` would keep the
  folder alive and AC4 could never delete it; `rm -r` is never used.
- Removal works from the install record alone, without the catalog — a mod must stay removable
  when the catalog is offline or the entry was dropped from the manifest (names fall back to the
  record's catalog id/gamedir).
- AC5's _not installed_ holds when the remaining folder is not a game dir by the inspector's rule;
  a kept folder the inspector still recognises (a known name such as `ctf`, or a kept changed pak)
  shows _installed manually_ — the tile must agree with the action-bar picker, and MOD-2 is the
  truthful label. The flow therefore uses `opentdm` for the kept-folder case.
- The visible fallback note is a main-side `app.broadcast.toast('info', 'mods.remove.fellBackToBase',
{ installation, gameDir })`, sent when `activeGameDir` was the removed gamedir before revalidation
  and is `''` after — main is where the fallback happens (`installations.ts:604`), and a toast
  reaches the user even if the Mods view is closed.
- Remove is refused while another mods job (install/update/remove) for the same installation and
  mod is queued or running — two writers on one record would corrupt it.
- The remove channels take `{ installationId, modId }` (catalog id, as 190's record keys it); an
  unknown installation, an unsafe id or a missing record is refused before `jobs.create` — AC7 and
  the "renderer paths are never trusted" rule.

## Plan

Builds on 188 (mods module, view, detail panel), 189 (catalog) and 190 (install record in
`Installation.moduleData['mods']`, its reader/writer and the installation setter). Use the names
190 actually shipped — its `## Done` lists the files; the names below marked "190's" are expected,
not existing today.

1. **Removal core (D1, main, pure fs):** `planRemoval` (changed / already-gone files) and
   `removeRecordedFiles` (containment check, delete, prune empty dirs, report) in
   `src/main/modules/mods/remove.ts`, with temp-dir unit tests.
2. **Contract + job (D2, shared + main):** handlers `removal.preview` and `remove` in
   `src/shared/modules/mods.ts` with zod payloads; `remove-job.ts` mirroring
   `src/main/modules/downloads/engine/rollback-job.ts`: validate → `jobs.create` → `runWrite` → D1 →
   rewrite/drop record → `installations.validate` → fallback toast → `finish`.
3. **UI + flow (D3, renderer):** _Remove_ in the catalog-installed detail panel, `RemoveModDialog`
   naming installation + mod and listing changed files with the delete/keep choice, the job's
   waiting text in the panel, fixture installation, flow `mods-remove`, CHANGELOG.

Order D1 → D2 → D3. Platform parity: plain fs operations, identical on Windows and Linux; nothing
is disabled per platform.

## Deliverables

- **D1 — Removal core (main, filesystem only).** New `src/main/modules/mods/remove.ts`, no IPC, no
  jobs. Input: installation root, gamedir name, and 190's install record (list of
  `{ path, size, sha256 }` relative to the gamedir). Export:
  - `planRemoval(root, gameDir, record) → { changed: string[]; missing: string[] }` — a file is
    _changed_ when its size differs, or sizes match and its streamed SHA256 differs; _missing_ when
    absent.
  - `removeRecordedFiles(root, gameDir, record, { changedFiles: 'delete' | 'keep' }) →
{ deleted: string[]; kept: string[]; failed: { path; code }[]; folderRemoved: boolean }`.
    Before deleting anything: resolve `realpath(<root>/<gameDir>)` and, for every entry,
    `realpath` of its parent dir; if any entry is absolute, contains `..` that escapes, or its real
    parent is outside the real gamedir → throw `RemovalRefusedError('mods.remove.refused.unsafePath')`
    and delete nothing. Then re-run the change check (the job's answer is authoritative), `unlink`
    each file (never follow a symlink: `lstat`, skip directories), collect failures without
    aborting. Afterwards prune, deepest first, every parent dir of a recorded file plus the gamedir
    itself with non-recursive `rmdir`, ignoring `ENOTEMPTY`/`EEXIST`/`ENOENT`; never `rm -r`.
    Mirror the copy-then-`rmdir` idea of `removeAssembled` in
    `src/main/modules/downloads/bootstrap/job.ts` (~:764) and the containment check
    `isInsideDir` in `src/main/modules/downloads/bootstrap/target.ts:84` (write a local helper or
    export it; case-insensitive compare on Windows via the same `pathKey`).
    Tests in `src/main/modules/mods/remove.test.ts` (mirror the mkdtemp/realpath pattern of
    `src/main/lib/fs-utils.test.ts:25` and `src/main/modules/config/cleanup.test.ts:37`):
    › "every recorded file is deleted", › "an unrecorded file survives" (`demos/mine.dm2`),
    › "the gamedir is removed when empty and kept when not" (incl. a recorded `maps/x.bsp` whose
    `maps/` is pruned), › "a changed file is listed and kept on keep, deleted on delete",
    › "a missing recorded file is already gone, not an error", › "a record path outside the gamedir
    refuses the removal and deletes nothing" (`../baseq2/pak0.pak`, absolute path),
    › "a symlinked subdirectory pointing outside is not followed" (skip on Windows without symlink
    privilege via `it.skipIf`), › "a failed delete is reported and the rest still deleted".

- **D2 — Remove contract + job (shared + main).** In `src/shared/modules/mods.ts` (188's file) add
  handlers `removalPreview: 'removal.preview'` and `remove: 'remove'` with zod payloads
  `{ installationId, modId }` and `{ installationId, modId, changedFiles: 'delete' | 'keep' }`
  (reuse the id primitives in `src/shared/schemas.ts` and the catalog-id rule 189/190 use),
  registered in the module's schema map. Responses: preview `Outcome<{ installationName; modName;
gameDir; changedFiles: string[] }>`, remove `Outcome<{ jobId }>`. New
  `src/main/modules/mods/remove-job.ts`, mirroring
  `src/main/modules/downloads/engine/rollback-job.ts` (validate before `jobs.create` :46/:150-161,
  then `runWrite`, then `finish`, cancel during the wait via `isWriteCancelled`):
  1. Validate: installation known; 190's record for `modId` exists → else refuse with
     `mods.remove.refused.noRecord` and touch nothing (AC7); no other mods job for that installation
     - mod queued/running → else `mods.remove.refused.busy`. Preview runs D1's `planRemoval` with
       the same validation; it never deletes.
  2. `jobs.create({ moduleId: 'mods', kind: 'mods-remove', labelKey: 'mods.job.remove',
labelParams: { mod, installation }, installationId, cancellable: true })`.
  3. Inside `app.writeGuard.runWrite(installationId, jobId, signal, …)`: remember
     `activeGameDir`, call D1 `removeRecordedFiles`; on success drop the record via 190's
     mods-state setter on `InstallationsService` (shape of `setEngineState`,
     `src/main/services/installations.ts:386`); on partial failure rewrite the record to the files
     still present and `finish` failed with `mods.remove.failed.locked` + the first path; on
     `RemovalRefusedError` finish failed with its key.
  4. `installations.validate(id)` (`installations.ts:503`); if the remembered `activeGameDir`
     equalled the gamedir (case-insensitive) and is now `''`, `app.broadcast.toast('info',
'mods.remove.fellBackToBase', { installation, gameDir })` (`src/main/services/broadcast.ts:20`).
     Wire the handlers in `src/main/modules/mods/index.ts`. Add the en strings for every key above to
     `src/renderer/src/i18n/locales/en.json` under `mods.*` (e.g. fellBackToBase: "{{installation}}
     now starts the base game — {{gameDir}} was removed"). Tests in
     `src/main/modules/mods/remove-job.test.ts` (fake jobs/writeGuard/installations, real temp dir):
     › "a mod with no install record is refused and nothing is deleted", › "nothing is deleted before
     the write guard grants the lock", › "the install record is dropped and the installation
     revalidated", › "a removed active gamedir falls back to the base game with a toast",
     › "a partial failure keeps only the remaining files in the record", › "a second mods job for the
     same mod is refused"; plus the payload schemas reject an unknown id / unsafe mod id in the
     module's schema test.

- **D3 — Remove in the detail panel + flow (renderer).** In 188's mods detail panel
  (`src/renderer/src/modules/mods/components/…DetailPanel.tsx`), show a _Remove_ button
  (testid `mods-detail-remove`) only for a catalog-installed mod (never for _installed manually_).
  New `src/renderer/src/modules/mods/components/RemoveModDialog.tsx` on `Modal`
  (`src/renderer/src/components/ui/Modal.tsx`; mirror
  `src/renderer/src/components/installations/RemoveInstallationDialog.tsx`): opens by calling
  `removal.preview`; title names mod and installation (`mods.remove.title` "Remove {{mod}} from
  {{installation}}?"), body says demos/configs/screenshots not installed by the launcher stay;
  when `changedFiles` is non-empty, lists them (testid `mods-remove-changed-list`) with a radio
  pair _Keep them_ (default, `mods-remove-changed-keep`) / _Delete them too_
  (`mods-remove-changed-delete`); Cancel / Remove (`mods-remove-confirm`) → `remove` with the
  choice; a refusal shows its i18n reason in the dialog. Client functions in
  `src/renderer/src/modules/mods/client.ts`. While the mod's `mods-remove` job is waiting, the
  panel shows the job's `waitingReason` text (`jobs.waiting.gameRunning`, en.json:3106) in testid
  `mods-detail-job-status` (reuse 190's job-status element if it exists). Fixture in
  `scripts/lib/fixture.mjs` (mirror the `INSTALL_*_ID` blocks ~:655/:753): installation
  `INSTALL_MODS_REMOVE_ID` with `activeGameDir: 'ctf'` and two 190-shaped records with matching
  sizes/hashes — `ctf` (only recorded files: `gamex86.dll`, `pak0.pak`) and `opentdm` (recorded
  `gamex86.dll`, `maps/tdm1.bsp`, `opentdm.cfg` whose content was altered after "install", plus an
  unrecorded `demos/mine.dm2`). New flow `scripts/flows/mods-remove.mjs` (mirror
  `scripts/flows/installation-remove-from-disk.mjs`, incl. its `simulateLaunch` helper ~:97 via
  `dev:simulateLaunch`, and `job-waits-for-running-game.mjs`). Flow order: simulate the game
  running → remove `ctf` → assert the waiting text and that its files still exist → simulate idle →
  assert the `ctf` folder is gone, the base-game toast is shown and the action-bar picker no longer
  offers `ctf`; then remove `opentdm`, assert the dialog names both and lists `opentdm.cfg`, choose
  _Delete them too_ → assert every recorded file gone, `demos/mine.dm2` and the folder kept, no
  `mods` record for it in the fixture's state file, tile shows _not installed_. Unit test
  `RemoveModDialog.test.tsx`. Add one CHANGELOG line under `## Unreleased` (or fold into the Mods
  entry if 188/190 already added one): "Remove a mod the launcher installed — your own demos and
  configs stay."

## Model Hints

- D1 → deliverable-hard — it deletes files on a user's disk: the realpath containment check, the
  never-follow-symlinks rule, the authoritative re-check of changed files and the non-recursive
  pruning are each one wrong line away from deleting user data outside or inside the gamedir.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/mods-remove.mjs` › "the remove confirmation names the installation and
  the mod and lists the changed file"; unit
  `src/renderer/src/modules/mods/components/RemoveModDialog.test.tsx` › "changed files default to
  keep and the choice reaches the remove call"
- AC2 → unit `src/main/modules/mods/remove.test.ts` › "every recorded file is deleted"; e2e
  `scripts/flows/mods-remove.mjs` › "after removal every recorded file is gone"
- AC3 → unit `src/main/modules/mods/remove.test.ts` › "an unrecorded file survives"; e2e
  `scripts/flows/mods-remove.mjs` › "a demo under demos/ survives removal"
- AC4 → unit `src/main/modules/mods/remove.test.ts` › "the gamedir is removed when empty and kept
  when not"; e2e `scripts/flows/mods-remove.mjs` › "the empty ctf folder is deleted and the
  opentdm folder with a demo is kept"
- AC5 → e2e `scripts/flows/mods-remove.mjs` › "after removal the record is gone, the tile says not
  installed and the picker no longer offers ctf"; unit `src/main/modules/mods/remove-job.test.ts` ›
  "the install record is dropped and the installation revalidated"
- AC6 → e2e `scripts/flows/mods-remove.mjs` › "removal waits while the game runs and says so";
  unit `src/main/modules/mods/remove-job.test.ts` › "nothing is deleted before the write guard
  grants the lock"
- AC7 → unit `src/main/modules/mods/remove-job.test.ts` › "a mod with no install record is refused
  and nothing is deleted"
- Decision (activeGameDir note) → e2e `scripts/flows/mods-remove.mjs` › "removing the active ctf
  shows the base-game note"; unit `remove-job.test.ts` › "a removed active gamedir falls back to the
  base game with a toast"

## Done

Remove a mod the launcher installed: `remove.ts` (realpath-contained delete of exactly the recorded files, changed-file check, non-recursive pruning), `remove-job.ts` (`removal.preview`/`remove` channels, `mods-remove` job inside the write guard, record drop/rewrite, revalidate + base-game toast), renderer Remove button + `RemoveModDialog` (keep/delete changed files), fixture `INSTALL_MODS_REMOVE_ID`, flow `mods-remove`, CHANGELOG line.

Commit message: `191: remove a catalog mod — recorded-files-only removal core, mods-remove job, confirmation dialog, flow`

Verification (narrow gate): `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (116 files / 914 tests), `ui:flow` mods-remove (7 labelled checks), mods-catalog, mods-detail, mods-install: all green. Full gate not run (sprint's). AC -> test: AC1-AC7 and the activeGameDir decision: all mapped unit/e2e tests exist, ran and passed as listed; no manual residue. Review: stage 1 PASS, 0 blocking findings, no fix cycle.

Decisions:

- D1 is stricter than the plan: gamedir name must pass `isSafeGameDirName` (`baseq2`, `..`, `''` refused) and a gamedir that is itself a link is refused; a recorded path that is no longer a regular file is kept and listed as changed.
- Mod id rule `^[A-Za-z0-9_.-]+$` (max 128), payloads `.strict()`; preview field names `installationName`/`modName`; `modName` is the record's catalog id, the dialog prefers the catalog display name when available.
- Busy check also blocks on any active `mod-install` of the same installation (install labels carry no mod id) - stricter, safe.
- Partial failure rewrites the record to failed + kept-changed files, job fails `mods.remove.failed.locked`.
- After removing `opentdm` with only `demos/` left, the tile reads _not installed_ (inspector: no top-level pak/dll/.so).
- Unfixed, documented: RemoveModDialog radio labels are ~20px high (no 44px deviation row written in CLAUDE.md, none authorised in this run - desktop mouse app, same reason as the existing rows); partial-failure test mocks `removeRecordedFiles` (real failing unlink not reproducible on Windows; D1 covers unlink failure itself).

Names later stories reuse: `planRemoval`/`removeRecordedFiles`/`RemovalRefusedError` (`remove.ts`), `previewModRemoval`/`startModRemove` (`remove-job.ts`, job kind `mods-remove`, label `mods.job.remove`), `MODS_HANDLERS.removalPreview|remove`, renderer `previewRemoval`/`removeMod`/`RemoveModDialog`, testids `mods-detail-remove`/`mods-detail-job-status`/`mods-remove-*`, fixture `INSTALL_MODS_REMOVE_ID`/`writeModsRemoveFixture`.

tiers: D 3 / hard 1 · review default · cycles 0 · agents 6
