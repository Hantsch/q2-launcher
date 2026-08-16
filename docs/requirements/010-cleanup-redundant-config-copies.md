---
id: 010
title: Cleanup of redundant per-mod config copies
status: in-progress
created: 2026-08-16
---

## Requirement

As a user, I want to scan an installation for config file copies that are redundant now that
the search path makes the base file reachable, and remove them under my review, so old
manually-copied or `q2-config-manager`-era files don't shadow the profile the launcher now
manages.

See [docs/concepts/config-module.md §5](../concepts/config-module.md#5-feature-areas-carried-over-from-q2-config-manager-redesigned)
and CFG-11.

## Acceptance Criteria

- [x] A cleanup scan, run per installation, lists mod-folder config file copies made redundant
      by the search path (duplicates of files already reachable via `baseq2`) — excluding the
      `autoexec.cfg` copies story 004's write pipeline intentionally places in "played" mod
      folders.
- [x] The user reviews the found list before anything is deleted — no automatic/silent
      deletion.
- [x] A confirmed removal is recoverable (same backup contract this module already uses for
      writes, adapted for a delete) rather than an unrecoverable disk delete.
- [x] The scan and any removal only ever target `<installation.path>/baseq2` and mod folders
      already known to that installation, never an arbitrary path.

## Open Questions

- ~~Exact backup/undo mechanics for a delete (vs. this module's existing write-time backup).~~
  **Resolved during refine** — see Decisions 4–6. No open questions remain.

## Decisions (Sprint)

1. **Redundancy rule:** a finding is a regular `*.cfg` file directly inside a known mod folder
   (`installation.gameDirs`) whose file name also exists in `<rootPath>/baseq2` — reason: that is
   exactly AC 1's wording ("duplicates of files already reachable via `baseq2`") and it is the only
   rule that can be checked from disk alone, without guessing intent.
2. **Exclusions:** `autoexec.cfg` in any mod folder (story 004 puts it there on purpose, because
   `FS_ExecAutoexec` ignores the search path), any file whose first line starts with story 004's
   `OWNERSHIP_MARKER` (launcher-generated, owned by the write pipeline), anything that is not a
   regular file, and anything not a direct child — reason: the scan must never offer to delete a
   file the launcher itself maintains or a path it did not resolve itself.
3. **Scan is non-recursive and reports `identical`:** only direct children of each gamedir are
   listed, and each finding carries whether it is byte-identical (latin1) to the `baseq2` file of
   the same name; the UI pre-selects only identical findings, non-identical ones stay unchecked —
   reason: Quake II mods keep their cfgs at the gamedir root, and a differing file (typically an
   engine-written `config.cfg`) is a judgement call that belongs to the user, not to the scanner.
4. **A delete is "backup, then unlink":** the file is copied to `<file>.q2l-backup` *before*
   `unlink`, using story 004's exact suffix and backup-once helper — reason: AC 3 asks for "the
   same backup contract this module already uses for writes, adapted for a delete", and reusing
   the suffix means one recovery convention the user already knows from the write pipeline.
5. **An existing `.q2l-backup` always wins and is never clobbered:** if a backup is already there
   (from an earlier write of that same file), the current file is deleted without re-copying —
   reason: story 004 decision 6 says the backup holds the user's *original*, and overwriting it
   with a later copy would destroy the very thing it protects.
6. **Undo is a real UI action, not "go rename the file yourself":** `cleanup.apply` returns what it
   removed, and the result panel offers "Undo removal", which calls a `cleanup.restore` handler
   that copies each backup back (only when the target does not exist again) and *keeps* the backup
   — reason: `ui-acceptance-required: true`, so "recoverable" (AC 3) needs a path through the real
   UI; the undo offer is session-scoped (until the panel is left), the on-disk backup is permanent.
7. **Addressed by ids, never by a path:** the renderer sends
   `{ installationId, entries: [{ gameDir, fileName }] }`; main resolves every path from the
   registered installation — reason: CLAUDE.md's "paths from the renderer are never trusted", and
   the same rule story 005's import contract already states for `{ installationId, gameDir }`.
8. **`apply` re-scans and intersects:** only entries the fresh scan still reports as findings are
   deleted, everything else comes back as rejected — reason: it closes the gap between "the list
   the user reviewed" and "what is on disk now" with one cheap check, and makes a stale or forged
   `fileName` structurally undeletable rather than merely validated.
9. **`baseq2` is read-only for this feature:** it is the reference side of the comparison; removal
   only ever targets mod folders — reason: AC 4 allows both folders in scope, but a duplicate in
   `baseq2` is the original, not the copy, and deleting there would remove the file the search path
   is supposed to serve.
10. **Reuse `gameDirBelongsToInstallation` from `src/main/modules/config/import.ts`** for the
    gamedir trust check instead of a fourth copy of the single-ASCII-token rule — reason: the rule
    already exists three times in this repo; this story adds a caller, not a variant.
11. **`backupOnce` + `BACKUP_SUFFIX` move out of `writer.ts` into a module-local `backup.ts`**
    imported by both `writer.ts` and `cleanup.ts` — reason: one backup contract deserves one
    implementation, and AC 3 explicitly ties the delete to the write pipeline's behaviour.
12. **Running installations are refused for `apply`/`restore`, never for `scan`** (via
    `isInstallationRunning(app.launch.getState(), id)` from `write-plan.ts`) — reason: story 004
    already skips writes to a running installation, and deleting a cfg out from under a live engine
    is strictly worse than writing one; the scan is read-only and always safe.
13. **UI home is a `CleanupPanel` on the config *list* screen**, next to `InstallationProfilesPanel`,
    with an installation picker — and rendered even when no profile exists — reason: cleanup is
    per-installation and profile-independent (concept §3), so a per-profile detail tab would be the
    wrong place and would hide the feature behind having a profile.
14. **Nothing is persisted:** no new `state.json` slice; scan results are live disk truth held in
    component state — reason: a cached finding list can only ever be wrong, and re-scanning costs
    one directory listing per gamedir.

## Plan

Add cleanup as a module-local core (scan → remove/restore) behind the existing `module:invoke`
seam, then the panel that reviews and triggers it. Nothing outside `src/main/modules/config/`,
`src/shared/modules/config.ts` and `src/renderer/src/modules/config/` is touched.

1. **Backup helper extraction** — `src/main/modules/config/backup.ts`: move `BACKUP_SUFFIX` +
   `backupOnce` out of `writer.ts` (import-only change there), so the delete path uses the exact
   same contract as the write path (Decisions 4, 5, 11).
2. **Scan** — `src/main/modules/config/cleanup.ts`: for a resolved `Installation`, list each
   `gameDirs` entry's direct children via `listDir`, keep `*.cfg` regular files whose name also
   exists in `baseq2`, drop `autoexec.cfg` and files starting with `OWNERSHIP_MARKER`, and flag
   `identical` by latin1 content compare (Decisions 1–3). Pure over an `Installation` + fs, unit
   tested against a temp installation tree.
3. **Remove + restore** — same file: `removeRedundantCopies` (backup-once → `unlink`) and
   `restoreRemovedCopies` (copy back only if absent, keep the backup), both filtering entries
   through `gameDirBelongsToInstallation` and a bare-`*.cfg`-name check (Decisions 7–10).
4. **Wire** — `src/shared/modules/config.ts` (`cleanupScan`/`cleanupApply`/`cleanupRestore` +
   their in/out types), `src/main/modules/config/schemas.ts` (zod payloads),
   `src/main/modules/config/index.ts` (handlers, `Outcome`-returning, running guard per
   Decision 12). Mirror: the `import.*` handler trio from story 005.
5. **Surface** — `src/renderer/src/modules/config/CleanupPanel.tsx` + client wrappers + i18n keys
   under `config.cleanup.*`: installation picker, Scan, a reviewable checkbox list (identical
   pre-checked, others not, with a size and an "differs from baseq2" hint), a confirm dialog, a
   result list and the "Undo removal" button (Decisions 6, 13, 14). Mounted from `ConfigView.tsx`'s
   list screen, outside the `profiles.length === 0` branch.

Order: 1 → 2 → 3 → 4 → 5. Steps 1–3 are main-only and fully unit-testable; 4 exposes them; 5 is
the only renderer work and the acceptance path.

## Deliverables

- **D1 — Shared backup helper + redundancy scanner.** New `src/main/modules/config/backup.ts`
  (`BACKUP_SUFFIX`, `backupOnce` moved verbatim out of `writer.ts`, which switches to importing
  them), new `src/main/modules/config/cleanup.ts` with
  `scanRedundantCopies(installation): Promise<CleanupFinding[]>`, new `cleanup.test.ts`.
  Uses `listDir`/`isFile`/`fileSize` from `src/main/lib/fs-utils.ts` and `OWNERSHIP_MARKER` from
  `render.ts`. Mirror: `import.ts`'s `scanImportCandidates` for shape, `writer.test.ts` for the
  temp-dir test style. *Accepted when:* tests over a temp installation tree prove a duplicate is
  found, `autoexec.cfg` is never found, a launcher-generated file (sentinel first line) is never
  found, a mod-only cfg with no `baseq2` twin is never found, subdirectories are ignored, and
  `identical` is true only for a byte-equal pair. `writer.test.ts` still green (no behaviour
  change). **Covers AC 1 (core), AC 4 (scan side).**
- **D2 — Delete with backup, and restore.** Extends `src/main/modules/config/cleanup.ts` with
  `removeRedundantCopies(installation, entries)` and `restoreRemovedCopies(installation, entries)`
  plus tests in `cleanup.test.ts`. Backup-once before `unlink`; an existing `.q2l-backup` is kept
  untouched; restore copies back only when the target file is absent and never deletes the backup;
  every entry passes `gameDirBelongsToInstallation` (from `import.ts`) plus a bare
  `^[A-Za-z0-9_.-]+\.cfg$` name check, and is intersected with a fresh scan — rejects are returned,
  not thrown. *Accepted when:* tests prove backup-then-delete, that a pre-existing backup is not
  clobbered, that restore brings the file back byte-for-byte and is a no-op if the file reappeared,
  and that a `gameDir`/`fileName` outside the installation's known folders (incl. `..`, an absolute
  path, `baseq2`) never reaches the filesystem. **Covers AC 3 (disk side), AC 4 (removal side).**
- **D3 — Contract + handlers with the running guard.** `src/shared/modules/config.ts`
  (`cleanupScan: 'cleanup.scan'`, `cleanupApply: 'cleanup.apply'`, `cleanupRestore:
  'cleanup.restore'` in `CONFIG_HANDLERS`, plus `CleanupFinding`, `CleanupEntry`,
  `CleanupScanInput/Result`, `CleanupApplyInput/Result`, `CleanupRestoreInput/Result`),
  `src/main/modules/config/schemas.ts` (zod payloads, `gameDir`/`fileName` capped like the import
  schemas), `src/main/modules/config/index.ts` (three handlers using `safeParse` + `fail`/`ok`,
  `app.installations.find`, and `isInstallationRunning` from `write-plan.ts` refusing
  apply/restore with `config.error.installationRunning`). Mirror: the `import.*` handlers in the
  same file. *Accepted when:* a test drives scan → apply → restore against a temp installation and
  a faked running launch state makes apply fail without touching disk.
  **Covers AC 2 (main side: apply only ever acts on explicitly passed entries), AC 4 (contract).**
- **D4 — Cleanup panel in the config view.** New
  `src/renderer/src/modules/config/CleanupPanel.tsx`, three client wrappers in
  `src/renderer/src/modules/config/client.ts` (flattening the inner `Outcome`, like the import
  wrappers), mounting in `ConfigView.tsx`'s list screen, keys under `config.cleanup.*` in
  `src/renderer/src/i18n/locales/en.json`. Installation picker from
  `useLauncher(s => s.installations)`; Scan button; findings list with per-row checkbox (identical
  pre-checked, differing unchecked and marked), gamedir, file name and size; a confirm step naming
  the count before anything is deleted; a result list; an "Undo removal" button while the last
  result is on screen. Design-system primitives only (`Panel`, `SectionLabel`, `Badge`, `Button`,
  `Checkbox`, `Select`, `Modal`) — no image assets. Mirror: `WriteTargets.tsx` for panel layout and
  status rendering, `DeleteProfileDialog.tsx` for the confirm step.
  **Covers AC 1 (UI list), AC 2, AC 3 (undo path).**

## Model Hints

- `D2 → deliverable-hard` — it is the only irreversible step in the story: an off-by-one in the
  backup-before-unlink order, a backup-once condition that clobbers the user's original from the
  write pipeline, or a `gameDir`/`fileName` that escapes the installation deletes a file in a real
  game folder with no way back; it also has to stay bit-compatible with story 004's live backup
  contract it now shares.
- D1, D3, D4 → default tier.
- `Review: → story-review-hard` — the review has to re-check data-loss behaviour (backup exists
  before every unlink, no clobbered pre-existing backup, no delete in `baseq2` or an unknown
  folder, no delete without an explicit reviewed entry) against the spec, which is the class of bug
  a green test run passes over.

## Test Plan (manual acceptance)

1. Prepare an installation on disk: put `<install>/baseq2/gl_settings.cfg` there, copy the same
   file into a known mod folder (e.g. `<install>/rogue/gl_settings.cfg`), and additionally create
   `<install>/rogue/config.cfg` with content that *differs* from `<install>/baseq2/config.cfg`.
2. `npm run dev` → Config. On the profile list screen, the Cleanup panel is visible; pick that
   installation and press Scan.
3. Expect: `rogue/gl_settings.cfg` listed and pre-checked (identical), `rogue/config.cfg` listed
   but unchecked and marked as differing. Expect `autoexec.cfg` (written into `rogue` by story
   004's pipeline) and any `q2l-profile-*.cfg` to be absent from the list.
4. Press Remove — a confirm step names how many files will be removed. Confirm.
5. On disk: `rogue/gl_settings.cfg` is gone, `rogue/gl_settings.cfg.q2l-backup` holds the original
   bytes, `rogue/config.cfg` is untouched, `baseq2/` is untouched.
6. Press "Undo removal" in the result panel: `rogue/gl_settings.cfg` is back byte-for-byte and the
   `.q2l-backup` still exists. Re-scan lists it again.
7. Launch that installation, and while the game runs press Remove again: the panel reports the
   installation as running and nothing is deleted on disk.

## Done

**Summary.** Added a "cleanup" feature to the config module: `scanRedundantCopies` finds
mod-folder `.cfg` files that duplicate a same-named `baseq2` file, `removeRedundantCopies`
backs up (reusing the write pipeline's exact `backupOnce`/`.q2l-backup` contract, extracted
into a shared `backup.ts`) and deletes the reviewed selection, `restoreRemovedCopies` undoes
it. Exposed over `module:invoke` as `cleanup.scan`/`cleanup.apply`/`cleanup.restore`, with
`apply`/`restore` refusing a running installation (`scan` never does). A `CleanupPanel` on the
config module's list screen drives scan → review (identical findings pre-checked, differing
ones flagged) → confirm → remove → optional "Undo removal".

**Files changed/new:**
- New: `src/main/modules/config/backup.ts`, `src/main/modules/config/cleanup.ts`,
  `src/main/modules/config/cleanup.test.ts`, `src/renderer/src/modules/config/CleanupPanel.tsx`.
- Modified: `src/main/modules/config/writer.ts` (backup helpers extracted, re-exported;
  `isSafeGameDirName` made exported for reuse), `src/shared/modules/config.ts` (cleanup
  contract types + `CONFIG_HANDLERS` entries), `src/main/modules/config/schemas.ts` (cleanup
  zod payloads), `src/main/modules/config/index.ts` (three handlers plus extracted
  `applyCleanupIfNotRunning`/`restoreCleanupIfNotRunning`), `src/main/modules/config/index.test.ts`
  (running-guard tests), `src/renderer/src/modules/config/client.ts` (three wrappers),
  `src/renderer/src/modules/config/ConfigView.tsx` (mounts `CleanupPanel`),
  `src/renderer/src/i18n/locales/en.json` (`config.error.installationRunning`,
  `config.cleanup.*`).

**Decisions made during implementation** (beyond the sprint decisions already in this file):
1. **Second gamedir-safety layer in `entryIsTrusted`:** on top of `gameDirBelongsToInstallation`
   (decision 10), D2 also reuses `writer.ts`'s `isSafeGameDirName` (now exported) as a second,
   independent check — `gameDirBelongsToInstallation` alone only asks "did the installation
   record this gamedir", and `gameDirs` is persisted via a forgiving `.catch([])` parse, so a
   hand-edited `state.json` could contain `..` and still pass that one check. This mirrors
   `writer.ts`'s own two-layer defence for played-mod names.
2. **Running-guard extracted as standalone functions:** `applyCleanupIfNotRunning`/
   `restoreCleanupIfNotRunning` in `index.ts` wrap `removeRedundantCopies`/`restoreRemovedCopies`
   with the `isInstallationRunning` check, mirroring the file's existing
   `writeProfileToAssignedInstallations` pattern (pulled out of a handler closure specifically
   so it is unit-testable without booting `configModule.setup()`'s full `AppContext`) — needed
   because D3's own acceptance line ("a faked running launch state makes apply fail") has no
   other testable seam once the guard lives inside `configModule.setup()`.
3. **Test placement:** the running-guard and the scan→apply→restore round trip are tested in
   `index.test.ts` against the extracted functions directly (same style as every other test in
   that file), rather than via a full `configModule.setup()`-handler-level harness — a first
   pass built such a harness in a separate `cleanup-handlers.test.ts`, but it was redundant with
   the extracted-function tests once those existed, so it was removed rather than kept as
   duplicate coverage.
4. **`CleanupFinding`/`CleanupEntry` exist in two places** (`cleanup.ts`, main-only, and
   `@shared/modules/config.ts`, the renderer-facing contract) rather than one being imported by
   the other — `@shared/**` may not import from `main/**` (CLAUDE.md/ARCHITECTURE.md), and this
   is the same precedent `import.ts`'s `UnrecognizedConfigLine` vs. its own internal reader type
   already sets in this module.

**Verification:**
- `npm run build`: green.
- `npm test`: green, 415 tests across 25 files (includes `cleanup.test.ts`'s D1/D2 coverage of
  the scan/remove/restore logic — backup-before-unlink ordering, no-clobber of an existing
  backup, `baseq2` exclusion in both casings, path-escape rejection for `..`/absolute/
  separator-bearing entries, fresh-scan intersection on apply — and `index.test.ts`'s D3
  coverage of the running-guard and the IPC-level round trip).
- `npm run typecheck`: green (`typecheck:node` + `typecheck:web`).
- **Code review:** a `story-review-hard` clean-agent review was dispatched against the story's
  full diff (spec: this file's Acceptance Criteria/Decisions/Plan) but did not return a verdict
  in a reasonable time window; per the session's explicit fallback instruction, the review was
  not re-run indefinitely. In its place, the destructive-path guarantees D2 is built on were
  hand-verified directly against the final code and test suite: `backupOnce()` is awaited before
  every `unlink()` with no code path that reaches `unlink` first; an existing `.q2l-backup` is
  never re-copied (decision 5, `backupOnce`'s own `pathExists` short-circuit); `baseq2` is
  excluded from both `apply` and `restore` via an explicit lowercase compare that a differently-
  cased `gameDirs` entry (`BASEQ2`) cannot bypass (tested both ways); `entryIsTrusted`'s
  `BARE_CFG_NAME` regex and `isSafeGameDirName`/`gameDirBelongsToInstallation` pair reject every
  traversal/absolute-path/separator-bearing `gameDir`/`fileName` before a path is ever built
  (tested: `..`, `.`, `C:\Windows`, `/etc`, `../x.cfg`, `sub/x.cfg`); `removeRedundantCopies`
  re-scans and only deletes an entry present in that fresh result (tested: a stale/no-longer-a-
  finding entry is rejected, not deleted); `restoreRemovedCopies` never overwrites a file that
  reappeared and never deletes the backup file itself (tested both). This is not a substitute
  for the independent review the workflow calls for — it is the documented fallback the session
  was explicitly told to take once the review agent did not return in time.
- **Live UI acceptance:** not run. This sandbox cannot launch Electron (`npm run dev` has no
  display/runtime here), so the `## Test Plan (manual acceptance)` steps below are unexercised.
  Status stays `in-progress` per this project's `live-smoke-required`/`ui-acceptance-required`
  policy — a human needs to run the 7 manual steps above through the real app before this story
  can move to `done`.

**Commit message (prepared, not yet committed):**
```
010: add config cleanup scan/remove/restore with undo
```
