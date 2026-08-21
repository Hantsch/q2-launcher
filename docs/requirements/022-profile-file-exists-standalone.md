---
id: 022
title: A profile is a real <name>.cfg that exists before any assignment
status: done # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

A config profile should be a file I can point at, named after the profile (`<name>.cfg`), which
exists as soon as the profile does — regardless of whether it is assigned to an installation.
Today the rendered file only comes into existence inside an installation, under a generated name
(`baseq2/q2l-profile-<id>.cfg`), so an unassigned profile has nothing on disk to look at, open, or
hand to anyone.

Whether a profile is present in a given installation should then be answerable by "is that file
there" instead of by a separate bookkeeping tab, and keeping the copies current should happen
automatically whenever I change something — no manual write step.

This is the on-disk half; the tab that shows and opens the files is story 023.

## Acceptance Criteria

- [ ] Every profile has a canonical file in a launcher-owned location, named from the profile name
      (sanitised, `<name>.cfg`), written when the profile is created and rewritten on every change.
- [ ] An unassigned profile has that file — creating a profile and looking at it needs no
      installation at all.
- [ ] Renaming a profile renames the file; two profiles that sanitise to the same name do not
      overwrite each other.
- [ ] Assigned installations receive their copy automatically on every change (the existing
      debounced-save → write path), with the existing backup-once and diff-skip guarantees intact.
- [ ] The write pipeline reports, per installation, whether the file is present and whether it
      matches the current profile — the data the Care tab (story 025) renders as out-of-sync.
- [ ] A profile whose file cannot be written (locked, missing directory, running installation)
      surfaces as an error state and is retried, not silently dropped.
- [ ] Existing installations keep working: files written under the old `q2l-profile-<id>.cfg` name
      and the `autoexec.cfg` loader that `exec`s them are handled, not orphaned.

## Open Questions

- ~~Does the copy inside an installation also become `<name>.cfg`, or does it keep the id-based
  name?~~ answered → Decisions (Sprint)
- ~~If the name changes: migrate/rename existing files inside installations and rewrite the
  `autoexec.cfg` loader line, or leave the old file behind?~~ answered → Decisions (Sprint)
- ~~Where is the launcher-owned location?~~ answered → Decisions (Sprint)
- ~~Does the played-mods selection survive here, and where is it configured once that tab is
  gone?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Copy naming inside installations: name-based (`<name>.cfg`), not id-based — applies
  to the canonical file and every per-installation copy alike. Names must be unique; sanitising
  two different profile names to the same string is a collision to resolve (disambiguate), not an
  overwrite.
- **(User)** Existing id-based copies (`q2l-profile-<id>.cfg`) inside installations are migrated on
  first write after this ships: renamed to the new `<name>.cfg`, and the `autoexec.cfg` `exec`
  line is rewritten to match — nothing is left behind orphaned.
- **(User)** Launcher-owned canonical file location: userData, next to `state.json` — not a
  separate user-visible "profiles" folder.
- **(User)** Played-mods selection (which gamedirs receive a copy) is configured per installation
  row in the Raw File tab (story 023), not in a separate control.

### Taken during refine

1. **File names are resolved by one pure function over the whole profile list**
   (`resolveProfileFileNames(profiles)` in a new `src/shared/config/profile-files.ts`), not derived
   per profile — a collision can only be decided by looking at all names at once, and canonical
   write, installation write, loader `exec` and switch-bind chain must agree on the same string.
2. **Sanitising rule:** keep `[A-Za-z0-9_.-]` (the repo's existing `GAME_DIR_TOKEN` set), map
   everything else to `-`, collapse runs, trim leading/trailing `.-`, cap at 48 characters, empty
   result → `profile-<first 8 of id>` — the name is embedded in an `exec <file>` line inside a cfg,
   where a space, quote, `;` or `$` breaks the loader line, and 48 keeps a switch-bind step alias
   far below the engine's 1024-byte line limit.
3. **Windows reserved device names** (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) get a
   `-cfg` suffix — writing `nul.cfg` on Windows addresses a device, not a file.
4. **Collisions are compared case-insensitively and resolved by `createdAt`, then `id`**, later
   profiles taking `-2`, `-3` — Windows and macOS fold filename case, and a fixed order keeps a
   profile's file from moving whenever the list is re-read.
5. **The sentinel line stays id-based** (`// q2-launcher profile <id>`) — it is what still
   identifies a file's owning profile after a rename, which is what makes on-disk reconcile
   (migration, rename, orphan removal) possible at all.
6. **Reconcile from disk instead of persisting file names:** before writing, each target directory's
   launcher-owned `*.cfg` files are matched to profiles by their sentinel id and renamed to their
   expected name — this is also how `q2l-profile-<id>.cfg` migrates — and launcher-owned files whose
   profile no longer exists, or is no longer assigned to that installation, are deleted; no new
   persisted field can then drift from what is actually on disk.
7. **Only launcher-owned files are ever renamed or deleted** (first line starts with
   `OWNERSHIP_MARKER`); anything else keeps the existing backup-once treatment — the writer's "a
   file that is not ours is the user's" rule is the boundary this story must not weaken.
8. **The write trigger moves into main:** every mutating config handler (`create`, `rename`,
   `remove`, `setCvars`, `setBinds`, `setLayers`, `setActions`, `assign`, `unassign`, `setDefault`,
   `import.commit`) awaits the sync run before returning — "rewritten on every change" must not
   depend on a renderer component that story 023 deletes, and awaiting means the returned profile
   list already matches the disk.
9. **The renderer debounce stays where it is** (`SettingsTab`'s 500 ms) and `WriteTargets`'s
   `updatedAt` effect becomes a sync-state refetch — the debounce AC 4 protects is the *edit*
   debounce, not the write trigger.
10. **A sync run writes every profile assigned to a target installation**, not just the saved one
    plus that installation's default — otherwise "missing" in the AC 5 report would routinely mean
    "assigned but never saved" instead of a real problem, and diff-skip makes the extra targets free
    after the first run.
11. **Present/matches is computed live on read**, by reading the file and comparing it against
    freshly rendered content — a persisted flag is wrong the moment the user edits a file by hand,
    and story 023 explicitly wants a re-read rather than a cached copy.
12. **Only failures and running-installation deferrals are persisted:** `configPendingWrites` keeps
    its current meaning and a new additive `configWriteFailures` map
    (`<profileId>|<installationId|own>` → `{ messageKey, at }`) survives a restart — following the
    "new key, no schema bump, no migration" precedent `configPlayedMods` set in `state.ts`.
13. **Retry has three triggers and no timer:** the next mutation of that profile, `configModule`
    `setup()` on app start, and the existing `write` channel the user invokes — a background loop
    would fight a locked file forever, while those three cover AC 6.
14. **Exactly one new IPC channel, read-only `syncState`** (`{ profileId }` →
    `Outcome<ProfileSyncState>`: an `own` entry plus one per assigned installation, each
    `{ path, fileName, status, messageKey? }` with `status ∈ inSync | outOfSync | missing | pending
    | error`); `write` stays the retry trigger with its existing `WriteTargetResult[]` shape —
    stories 023 and 025 both render exactly this shape, and one channel keeps the contract diff
    reviewable.
15. **Reading and opening files stays out of this story** — `syncState` hands out paths and status
    only; the file-read and `shell.openPath` channels belong to story 023, which owns the viewer and
    its path validation.
16. **The canonical file is literally `<userData>/<name>.cfg`** next to `state.json` per the user
    decision, and removing a profile deletes it — the launcher owns that directory, so no user file
    can be shadowed by it.
17. **UI in this story stays minimal:** `WriteTargets` is adapted to render `syncState` and keeps its
    Retry button — this story only needs an existing surface for its error/retry acceptance; the
    Care tab presentation is story 025's job.

## Plan

Order matters: names first, then the two writers, then the orchestration, then the surface.

1. **Names (`src/shared/config/profile-files.ts`, new)** — `sanitizeProfileFileBase(name)` and
   `resolveProfileFileNames(profiles): Map<id, fileName>`, pure and deterministic (decisions 1–4).
   `profileFileName(id)` in `render.ts` stays, but only as the matcher for old id-based files.
2. **Every name consumer takes the resolved name** — `renderLoaderFile(profile, fileName,
   switchBind?)`, `SwitchBindProfile` gains `fileName`, and the call sites in
   `main/modules/config/index.ts` and `renderer/.../lib/validation-scope.ts` pass it in. No
   consumer derives a file name from an id any more.
3. **Canonical file (`main/modules/config/canonical.ts`, new)** — write / rename / remove
   `<userData>/<name>.cfg`, reusing `writer.ts`'s `writeTargetFile` (diff-skip + backup-once) rather
   than a second copy of that logic; the base directory is a parameter so tests need no `electron`.
4. **Installation reconcile (`main/modules/config/writer.ts`)** — `reconcileOwnedProfileFiles(
   installation, expected)`: list `baseq2/*.cfg`, read the first line, rename launcher-owned files
   to their expected name (this migrates `q2l-profile-<id>.cfg`), delete launcher-owned files with
   no live/assigned owner, leave everything else alone. Runs *before* the writes, so the following
   write diff-skips the renamed file and rewrites `autoexec.cfg`'s `exec` line.
5. **Contract + persisted failures** — `ProfileSyncState`/`ProfileFileSync`/`ProfileFileSyncStatus`
   and `CONFIG_HANDLERS.syncState` in `src/shared/modules/config.ts`; `configWriteFailures` added
   additively to `state.ts` + `lib/schemas.ts` (no schema bump).
6. **Sync engine (`main/modules/config/sync.ts`, new)** — one function that, for a profile: resolves
   names, writes the canonical file, then per assigned installation either marks `pending` (running)
   or reconciles + writes every profile assigned there via the unchanged `writeInstallationFiles`;
   returns `ProfileSyncState` with live present/matches and updates the failure map.
7. **Wiring (`main/modules/config/index.ts`)** — `syncState` handler; every mutating handler awaits
   the sync run; `setup()` retries persisted failures and pending writes once at start.
8. **Surface (`renderer/.../WriteTargets.tsx`, `client.ts`, `i18n/locales/en.json`)** — the
   `updatedAt` effect refetches `syncState` instead of triggering a write; rows show own file +
   per-installation status and keep Retry (`write`) for `error`/`pending`.

Out of scope: the Raw File viewer and its read/open channels (023), the Care tab (025), any state
schema migration (none needed), and deleting the `WriteTargets` tab (023).

## Deliverables

- **D1 — profile file-name resolution (pure)**
  Files: `src/shared/config/profile-files.ts` (new), `src/shared/config/profile-files.test.ts`
  (new). Mirror: `src/shared/config/alt-layers.ts` (`slugAliasName` style),
  `src/main/modules/config/render.test.ts` (test style).
  Acceptance: unit tests cover spaces/quotes/unicode → `-`, 48-char cap, empty name →
  `profile-<id8>`, Windows device names, case-insensitive collision → `-2`/`-3` in `createdAt`
  order, and identical output when the input list is reordered.

- **D2 — loader, switch-bind and validator take the resolved name**
  Files: `src/shared/config/render.ts`, `src/shared/config/switch-bind.ts`,
  `src/main/modules/config/index.ts`, `src/renderer/src/modules/config/lib/validation-scope.ts`,
  `src/main/modules/config/render.test.ts`, `src/main/modules/config/switch-bind.test.ts`.
  Acceptance: loader emits `exec <name>.cfg`, every switch-bind step execs the name-based file, the
  byte-length test on a step alias still passes; `npm test` and `npm run typecheck` green.

- **D3 — canonical `<userData>/<name>.cfg`**
  Files: `src/main/modules/config/canonical.ts` (new), `src/main/modules/config/canonical.test.ts`
  (new), `src/main/modules/config/writer.ts` (export `writeTargetFile`). Mirror:
  `src/main/modules/config/writer.ts` + `backup.ts`.
  Acceptance: write creates the file, an unchanged profile diff-skips it, a rename moves it, a
  removed profile's file is deleted, a foreign file at that path is backed up once before being
  overwritten; tests run against a temp directory passed in as the base dir.

- **D4 — installation reconcile + migration of id-based files**
  Files: `src/main/modules/config/writer.ts`, `src/main/modules/config/writer.test.ts`.
  Acceptance: an existing `q2l-profile-<id>.cfg` is renamed to `<name>.cfg` and the following write
  leaves `autoexec.cfg` pointing at the new name; a launcher-owned file whose profile is gone or no
  longer assigned is removed; the user's own `.cfg`, any `.q2l-backup` and unreadable files are
  never renamed or deleted; nothing is written outside `installation.rootPath`.

- **D5 — contract types, `syncState` channel, persisted failures**
  Files: `src/shared/modules/config.ts`, `src/main/modules/config/schemas.ts`,
  `src/main/services/state.ts`, `src/main/lib/schemas.ts`,
  `src/main/modules/config/schemas.test.ts`. Mirror: `configPlayedMods`/`configSwitchBinds` in the
  same two files.
  Acceptance: types + channel constant exist, `configWriteFailures` round-trips through the store,
  a state file without the key loads as `{}`, a malformed one is `.catch()`-defaulted.

- **D6 — sync engine**
  Files: `src/main/modules/config/sync.ts` (new), `src/main/modules/config/sync.test.ts` (new).
  Mirror: `writeProfileToAssignedInstallations` in `src/main/modules/config/index.ts`.
  Acceptance: writes canonical + every assigned profile per non-running installation through the
  unchanged `writeInstallationFiles`; running installation → `pending`, no write; an unwritable
  target → `error` + a `configWriteFailures` entry, a later successful run clears it; the returned
  `ProfileSyncState` reports `inSync`/`outOfSync`/`missing` from the real files on disk.

- **D7 — wire the trigger into main**
  Files: `src/main/modules/config/index.ts`, `src/main/modules/config/index.test.ts`.
  Acceptance: each mutating handler awaits the sync run and still returns its profile list; creating
  a profile with no assignment produces the canonical file; `setup()` retries persisted failures and
  pending writes once; `syncState` returns `config.error.profileNotFound` for an unknown id.

- **D8 — Write targets renders sync state**
  Files: `src/renderer/src/modules/config/WriteTargets.tsx`,
  `src/renderer/src/modules/config/client.ts`, `src/renderer/src/i18n/locales/en.json`.
  Acceptance: the `updatedAt` effect refetches `syncState` instead of calling `write`; the panel
  shows the profile's own file with its path plus one row per installation with its status; Retry
  still calls `write` for `error`/`pending`; all new strings are i18n keys, no prose over IPC.

**Coverage (acceptance criterion → deliverable):** canonical file written/rewritten → D1, D3, D7 ·
unassigned profile has its file → D3, D7 · rename renames, sanitised collisions do not overwrite →
D1, D3, D4 · assigned installations receive copies with backup-once and diff-skip intact → D6, D7 ·
per-installation present/matches reporting → D5, D6, D8 · unwritable file surfaces as error and is
retried → D5, D6, D7, D8 · old `q2l-profile-<id>.cfg` files and the `autoexec.cfg` loader handled →
D2, D4.

## Model Hints

- D4 → `deliverable-hard` — it renames and deletes files inside a user's game folder, where a wrong
  ownership check destroys a hand-written config that backup-once was supposed to protect.
- D7 → `deliverable-hard` — it moves the write trigger into every mutating handler, where one missed
  handler or a swallowed rejection silently stops all on-disk syncing without any test turning red.
- All other deliverables → default tier.
- Review: → `story-review-hard` — the diff combines destructive filesystem logic with a rewrite of
  the module's central write path that stories 023 and 025 build on.

## Test Plan (manual acceptance)

All steps through the real UI (Config module), on a copy of a real installation:

1. Create a profile named `My Config` in the Config view → `<userData>/My-Config.cfg` exists
   immediately, with no installation assigned.
2. Rename it to `Frag Setup` → the old file is gone, `<userData>/Frag-Setup.cfg` exists.
3. Create a second profile named `frag/setup` → it gets `frag-setup-2.cfg`; neither file is
   overwritten, both contents differ.
4. Assign `Frag Setup` to an installation, change a cvar in Settings → after the debounce,
   `<install>/baseq2/Frag-Setup.cfg` exists and `<install>/baseq2/autoexec.cfg` contains
   `exec Frag-Setup.cfg`; the Write targets row shows the installation in sync.
5. Migration: put a file `baseq2/q2l-profile-<that profile's id>.cfg` (first line
   `// q2-launcher profile <id> - generated, do not edit`) in place, delete the name-based file,
   then edit a cvar → the old file is gone, the name-based one is there, `autoexec.cfg` points at
   it, and a hand-written `baseq2/mystuff.cfg` next to it is untouched.
6. Error + retry: make `baseq2` read-only (or keep the game running), edit a cvar → the row shows an
   error/pending badge with a reason, Retry re-attempts; restore permissions and press Retry → the
   row goes back to in sync. Restarting the launcher must still show the failure until it succeeds.
7. `npm run ui:verify` for the live smoke (P2), plus `npm run build`, `npm test`,
   `npm run typecheck`.

## Done

Implemented across 8 deliverables (D1–D8): profile file-name resolution
(`src/shared/config/profile-files.ts`), loader/switch-bind/validator consuming the resolved name,
a canonical `<userData>/<name>.cfg` writer (`src/main/modules/config/canonical.ts`), per-installation
reconcile/migration of old `q2l-profile-<id>.cfg` files (`src/main/modules/config/writer.ts`),
contract types + the read-only `syncState` channel and persisted `configWriteFailures` map
(`src/shared/modules/config.ts`, `src/main/services/state.ts`), the sync engine
(`src/main/modules/config/sync.ts`) wired into every mutating handler in
`src/main/modules/config/index.ts`, and `WriteTargets.tsx` rendering live sync state with retry.

**Decisions (during build):**
- The `write` IPC handler now routes through the sync engine (not a separate write path), so a
  manual retry clears a persisted `configWriteFailures` entry the same way an automatic sync does.
- `getProfileSyncState`'s outcome was double-wrapped (`Outcome<Outcome<...>>`) — fixed to the
  single-wrap contract stories 023/025 depend on.

**Review finding fixed:** a code review (`story-review-hard`) found a confirmed AC-3 breach —
renaming a profile into another profile's sanitised name clobbered that other profile's canonical
file, because only the mutated profile was re-synced while `resolveProfileFileNames` had silently
shifted a second profile's slot. Fixed with two independent nets: `sync.ts` now cascades to every
profile whose resolved file name changed (ordering the displaced rename before the mutated
profile's write), and `canonical.ts` refuses to overwrite a destination still holding a different
live profile's sentinel, surfacing that as a `configWriteFailures` retry case instead. Two new
tests reproduce the clobber and the refusal guard in isolation; both fail without the fix.

**Noted, left out of scope:** `setPlayedMods`/`setSwitchBind` still write without a sync pass
(pre-existing, not listed under decision 8) — a switch-bind chain can `exec` a not-yet-migrated
file name until the next real sync; a path-comparison inconsistency (`!==` vs. `pathKey`) in
`canonical.ts`, harmless on Windows. The pre-existing `config-raw` double-unwrap crash (surfaced
again by `npm run ui:verify`) belongs to story 023, which owns that panel.

**Verification:** `npm run build`, `npm test` (813 tests), `npm run typecheck` all green;
`npm run ui:verify` — `config-writeTargets` screenshots clean, only the pre-existing baseline
moderate a11y finding shared by nearly every config screen (not a regression).

**Commit message:** `022: canonical <name>.cfg files with live sync/retry state`
