---
id: 254
title: The first assignment backs up the original configs and I can restore them
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, before the launcher writes its config into my installation for the first time, my existing
config files are saved, and I can restore that original state with one button.

User feedback 2026-10-26: before writing the launcher's configs into an installation, back up the existing
ones, so that if writing destroys something of the user's we can return to the original state.

Today `writeTargetFile` (`src/main/modules/config/writer.ts`) overwrites a non-launcher file after
`backupOnce` writes a single `<file>.q2l-backup` next to it, without telling the user, and there is no
restore.

## Acceptance Criteria

- [ ] **AC1** — Assigning a profile to an installation for the first time copies every existing file the
      launcher is about to write (`<profile>.cfg`, `autoexec.cfg` in baseq2 and mod folders) into a backup
      folder inside the installation, before anything is written.
- [ ] **AC2** — Files that do not exist yet are not backed up, and files the launcher does not write are not
      touched.
- [ ] **AC3** — Later writes to the same installation do not replace an already backed-up original.
- [ ] **AC4** — The installation shows a "Restore original configs" action while a backup exists.
- [ ] **AC5** — Restoring, after a confirmation, puts every backed-up file back byte-identical, removes the
      launcher-written files that did not exist before, and unassigns the launcher's profiles from that
      installation.
- [ ] **AC6** — After a restore, the action is gone and assigning again starts a fresh backup.

## Open Questions

## Decisions (Sprint)

- **(User)** Backed up are exactly the files the launcher is about to write into the installation — the
  profile's `<name>.cfg` and `autoexec.cfg` (in baseq2 and any mod folder the loader is copied to) — when
  they already exist. Nothing else.
- **(User)** The backup is taken once, when a launcher config is first assigned to that installation, into
  a backup folder inside the installation; its purpose is to get back to the original state if the
  launcher's write destroys something of the user's.
- **(User)** Restore is a button in the UI, with a confirmation.
- A file first written later (another profile, see 255) joins the same backup folder before it is
  overwritten; the first original of a path always wins.
- The backup folder is `<installation root>/q2launcher-original-configs/`, mirroring each file's path
  relative to the root (`baseq2/autoexec.cfg`, `<mod>/autoexec.cfg`) plus a `manifest.json`, because a
  visible, self-describing folder is findable by the user and holds no pak/dll, so the installation scan
  (`inspector.ts#isGameDir`) never mistakes it for a game dir.
- The backup is taken at the launcher's first write into the installation (which the first assignment
  causes), hooked in `writeInstallationFiles` and in `reconcileOwnedProfileFiles`' rename destination,
  because those are the only two places a launcher file lands in an installation (assign, setDefault,
  content saves, raw save and startup retry all funnel through them).
- All targets of one write call are backed up before the first target is written, and a backup failure
  throws before any write, because AC1 says "before anything is written" and a write without its backup is
  the data loss this story exists to prevent.
- A target that does not exist yet is recorded in the manifest as `created` (no copy), because restore must
  know which files to remove (AC5) without backing up anything that was not there (AC2).
- A target that already exists but carries the launcher's ownership stamp at first backup (installations
  written before this story) takes its legacy `<file>.q2l-backup` sibling as the original when one exists,
  else is recorded as `created`, because that sibling is the user's true original and the stamped file is
  launcher output.
- The writer and reconcile stop creating new sibling `<file>.q2l-backup` files; existing ones stay untouched
  and `cleanup.ts` keeps its own `backupOnce`, because two parallel backups of the same write are clutter
  and cleanup's undo is a separate, already-shipped contract.
- Restore removes a `created` file only while it still carries the launcher's ownership stamp, because a
  file at that path without the stamp is the user's, and the launcher never deletes the user's files.
- Restore order: refuse while the installation runs (`isInstallationRunning`, as cleanup does); unassign
  every profile from the installation and persist; put files back and remove created ones; delete the
  backup folder only when every step succeeded — because unassigning first guarantees no sync writes into
  the installation afterwards, and a half-failed restore must keep its backup.
- `manifest.json` is untrusted on read (zod; each entry must be `<safe game dir>/<bare .cfg name>` under the
  root, compared with `pathKey`); an invalid manifest refuses the restore with an i18n error and touches
  nothing, because a hand-edited file inside the game folder must never steer a write or delete.
- The action lives in the config module's `InstallationProfilesPanel` (the installation-side half of
  assignment), not the Library row, because that keeps it inside the config module with no new
  shell→module allowlist edge.
- Visibility comes from a new config query `originalConfigs.list` (ids of installations with a valid
  manifest on disk), refetched whenever the profiles list changes; no persisted slice, because the disk is
  the truth and a persisted flag could drift from it.
- `originalConfigs.restore` returns `ConfigProfile[]` like `unassign`, because the renderer's profile store
  is replaced from that outcome the same way.
- No platform gate: plain file copies work identically on Windows and Linux.

## Plan

1. Main core: new `original-backup.ts` (manifest read/validate/write, `backupOriginals`,
   `restoreOriginals`, `hasOriginalBackup`); `writer.ts` calls `backupOriginals` for all targets before
   writing and for the reconcile rename destination, replacing its `backupOnce` calls.
2. Main IPC: `originalConfigs.list` / `originalConfigs.restore` in the config contract; `profile-writes.ts`
   orchestrates restore (running guard → unassign all → restore files → drop folder); systems doc.
3. Renderer: client functions, the action + `ConfirmDialog` in `InstallationProfilesPanel`, en strings,
   CHANGELOG line, and the ui:flow proving AC1/AC4–AC6 through the real surface.

Order D1 → D2 → D3; each D's tests ship with it.

## Deliverables

- **D1 — Original-config backup in the writer.** New `src/main/modules/config/original-backup.ts` +
  `original-backup.test.ts`; edit `writer.ts`, `writer.test.ts` (and any `sync.test.ts` /
  `rebuild.test.ts` assertion on writer-created `.q2l-backup` siblings).
  - Folder `<rootPath>/q2launcher-original-configs/` with `manifest.json`
    `{ version: 1, entries: [{ path: 'baseq2/autoexec.cfg', kind: 'copied' | 'created' }] }`; copies are
    stored at the same root-relative path inside the folder. Manifest paths are root-relative with `/`.
  - `backupOriginals(rootPath, absTargetPaths)`: for each target not yet in the manifest (compare with
    `pathKey` from `src/main/lib/fs-utils.ts`): missing → `created`; exists and not launcher-owned
    (`isLauncherOwnedFile` from `@shared/config/render/file-ownership`) → copy bytes, `copied`; exists and
    launcher-owned → copy its legacy `<file>.q2l-backup` sibling (`BACKUP_SUFFIX` from `backup.ts`) as
    `copied` if it exists, else `created`. Paths already in the manifest are never touched (first original
    wins). Manifest written with `writeFileAtomic` after the copies. Throws on any failure.
  - `writeInstallationFiles` calls `backupOriginals` with all its targets before the first
    `writeTargetFile`; `writeTargetFile` no longer calls `backupOnce`. `reconcileOwnedProfileFiles` calls
    `backupOriginals` for a rename destination instead of `backupOnce`. `cleanup.ts` is not changed.
  - `readManifest(rootPath)` validates with zod; every entry path must be `<dir>/<name>` with
    `isSafeGameDirName(dir)` (writer.ts) and a bare `.cfg` file name; invalid → a typed `invalid` result,
    never a raw manifest path handed to an fs call. `hasOriginalBackup(rootPath)` = a valid manifest exists.
  - `restoreOriginals(rootPath)`: invalid manifest → `invalid`, nothing touched; else `copied` entries are
    copied back byte-identical (overwrite), `created` entries are unlinked only if the file still carries
    the ownership stamp (already missing is fine); only when all succeed is the folder removed (recursive
    `rm` on that folder path only).
  - Tests in `original-backup.test.ts` (temp dirs): "backs up every existing target before the first
    write" (including: a backup failure leaves every target unwritten), "missing targets are recorded as
    created, not copied", "files the launcher does not write are untouched", "a later write never replaces
    a backed-up original", "a later new target joins the existing backup", "a launcher-owned target takes
    its legacy sibling as the original", "restore puts originals back byte-identical and removes created
    files", "restore keeps a created path the user replaced with an unstamped file", "a tampered manifest
    path is refused and nothing is touched", "after restore no backup exists and the next write starts a
    fresh one".
- **D2 — Restore and list over IPC.** Edit `src/shared/modules/config.ts` (handlers
  `originalConfigsList: 'originalConfigs.list'` → `Outcome<string[]>` of installation ids;
  `originalConfigsRestore: 'originalConfigs.restore'` with `{ installationId }` → `Outcome<ConfigProfile[]>`),
  `src/shared/modules/config-schemas.ts` (payload schemas; installationId via the same primitive `unassign`
  uses), `src/main/modules/config/index.ts` (handlers, next to `assign`/`unassign`),
  `src/main/modules/config/profile-writes.ts` (restore orchestration), new
  `src/main/modules/config/profile-writes.restore-originals.test.ts` (reuse
  `profile-writes.test-helpers.ts`), `docs/systems/config-module.md` (handler-table rows, a file note for
  `original-backup.ts` and the backup folder).
  - List: every registered installation whose root has a valid manifest (`hasOriginalBackup` from D1's
    `original-backup.ts`).
  - Restore: unknown installation → `installations.error.notFound`; running (`isInstallationRunning` from
    `write-plan.ts`, as `cleanup.ts#applyCleanupIfNotRunning` does; reuse cleanup's refusal key) → refused,
    nothing touched; no backup → `config.error.noOriginalBackup`; invalid manifest →
    `config.error.originalBackupInvalid`. Otherwise `deps.profiles.unassign` every profile assigned to the
    installation, persist through the same `syncAndPersist` path `unassign` uses (it writes nothing into
    this installation — nothing is assigned there any more), then `restoreOriginals(rootPath)`; return the
    `withLiveAssignments(...)` list. A failed file step → `config.error.restoreOriginalsFailed`.
  - Tests: "restore unassigns every profile from the installation", "restore is refused while the
    installation runs and touches nothing", "list returns only installations with a backup".
- **D3 — The "Restore original configs" action.** Edit `src/renderer/src/modules/config/client.ts`
  (`listOriginalConfigBackups`, `restoreOriginalConfigs`), `InstallationProfilesPanel.tsx` (fetch the list
  the way it fetches `getSwitchBinds`, refetch when `profiles` changes; for each installation in the list a
  `size="sm"` Button "Restore original configs"; click opens `ConfirmDialog`
  (`src/renderer/src/components/ui/ConfirmDialog.tsx`) naming the installation; confirm → restore → on ok
  `config-profiles-store.ts#replaceAll` with the returned list and refetch; on fail show the i18n error),
  `InstallationProfilesPanel.test.ts` (component tests), `src/renderer/src/modules/config/locale/en.json`
  (button, confirm title/body/confirm label, and the error keys `config.error.noOriginalBackup`,
  `config.error.originalBackupInvalid`, `config.error.restoreOriginalsFailed`), `CHANGELOG.md` (one
  `### Added` line under Unreleased: "Your original config files are backed up on first assignment and can
  be restored."), new flow `scripts/flows/config-original-configs-restore.mjs` (model:
  `scripts/flows/care-fix-item.mjs`, selectors listed in its header) registered in
  `scripts/flows/areas.json` under the config area.
  - The flow picks a fixture installation with no profile assigned (add one in `scripts/lib/fixture.mjs`
    if none exists), writes a foreign `baseq2/autoexec.cfg` into it, assigns a profile through
    `AssignmentsMenu`, asserts the backup folder holds the original bytes and the action is shown, restores
    with confirm, asserts `autoexec.cfg` is byte-identical, the profile's `.cfg` is gone, the installation
    has no assignment and the action is gone, then assigns again and asserts a fresh backup exists.
  - Component tests: "the restore action shows only for an installation with a backup", "restore asks for
    confirmation before calling main".

## Model Hints

- D1 → deliverable-hard — the one irreversible path into the user's game folder: backups must land before
  any target write across both `writeInstallationFiles` and the reconcile rename, the legacy-sibling and
  launcher-owned branches decide what counts as "original", and the on-disk manifest is untrusted input
  that steers copies and deletes.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/config/original-backup.test.ts` › "backs up every existing target before
  the first write"; e2e `scripts/flows/config-original-configs-restore.mjs` › "config-original-configs-restore"
- AC2 → unit `src/main/modules/config/original-backup.test.ts` › "missing targets are recorded as created,
  not copied" and › "files the launcher does not write are untouched"
- AC3 → unit `src/main/modules/config/original-backup.test.ts` › "a later write never replaces a backed-up
  original" and › "a later new target joins the existing backup"
- AC4 → e2e `scripts/flows/config-original-configs-restore.mjs` › "config-original-configs-restore";
  component `src/renderer/src/modules/config/InstallationProfilesPanel.test.ts` › "the restore action shows
  only for an installation with a backup"
- AC5 → e2e `scripts/flows/config-original-configs-restore.mjs` › "config-original-configs-restore"; unit
  `src/main/modules/config/original-backup.test.ts` › "restore puts originals back byte-identical and
  removes created files"; unit `src/main/modules/config/profile-writes.restore-originals.test.ts` ›
  "restore unassigns every profile from the installation"; component
  `src/renderer/src/modules/config/InstallationProfilesPanel.test.ts` › "restore asks for confirmation
  before calling main"
- AC6 → e2e `scripts/flows/config-original-configs-restore.mjs` › "config-original-configs-restore"; unit
  `src/main/modules/config/original-backup.test.ts` › "after restore no backup exists and the next write
  starts a fresh one"

## Done
