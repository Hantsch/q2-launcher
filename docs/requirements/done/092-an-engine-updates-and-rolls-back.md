---
id: 092
title: An engine updates and rolls back
status: done
created: 2026-09-12
---

## Requirement

The [install-module concept](../concepts/install-module.md) §10 (INST-U1–U4) covers engine
lifecycle after bootstrap: the pinned manifest version is compared against what an
installation actually has, an update is offered (never automatic), applying it replaces the
engine files while moving the previous ones into a backup inside the installation, and
rollback restores that backup in one step. A per-installation "bleeding edge" opt-in follows
upstream instead of the pinned version. This is the first story to write into an existing,
already-playable installation, so it rides [[091]]'s guard rather than inventing its own.

## Acceptance Criteria

- [x] **AC1** — An installation whose recorded engine version differs from the manifest's
      pinned version for that engine shows an available update, without downloading or
      changing anything on its own.
- [x] **AC2** — Applying the update downloads and verifies the package (per INST-V1–V3), then
      replaces the engine files, moving the previous ones into a backup kept inside the
      installation.
- [x] **AC3** — Rollback restores the most recent backup in one step, without re-downloading
      anything.
- [x] **AC4** — An installation can opt into "bleeding edge": while enabled, the update check
      compares against the newest upstream build instead of the manifest's pinned version, for
      that installation only.
- [x] **AC5** — Turning bleeding edge off returns that installation's update check to the pinned
      manifest version.
- [x] **AC6** — Applying an update or a rollback to an installation whose game is currently
      running waits per [[091]]'s guard rather than overwriting files underneath it.
- [x] **AC7** — After an update or a rollback completes, the installation's recorded engine
      version reflects what is actually on disk (`detectedVersion`, defined in the model but
      never written today).
- [x] **AC8** — A failed update (download or verification failure) leaves the installation on
      its previous, working engine files — never a half-replaced state.

## Open Questions

~~The bleeding-edge probe mechanism (GitHub release API vs. `version.txt`, rate limits, and
what can be verified without a manifest-supplied hash) is open point §15.12 of the concept
and has no decision yet.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Bleeding-edge probe mechanism: fetch Q2PRO's `version.txt` next to the nightly
  release asset (same transport pattern as the manifest fetch), not the GitHub Releases API —
  no rate limit, simpler parsing. r1q2 has no such file, so bleeding edge stays Q2PRO-only in
  v1.
- **(User)** Bleeding-edge verification: size-only sanity check against what the probe
  reported; no SHA256, since there is no pinned hash for a moving nightly target. The opt-in
  itself is the trust signal.
- **Recorded engine version lives in `Installation.moduleData['downloads']`** (version, package
  id, bleeding-edge flag, backup pointer), mirrored into `Installation.detectedVersion` for
  display — that is the slot the concept §4 reserves for per-installation module data, so neither
  `Installation` nor `LauncherSettings` gains a new top-level field.
- **An installation with no recorded engine version counts as "differs"** and is offered the
  pinned version, labelled "current version unknown" — otherwise every installation bootstrapped
  before this story could never update, and AC1's "differs from the pinned version" is literally
  true of an unknown one.
- **The bootstrap job records the engine version it just installed** (one small addition in
  `bootstrap/job.ts`) — so new installations never start in that unknown state and AC7's record
  has exactly one writer.
- **"The engine files" are defined as the `role: 'engine'` entries of
  `buildAssemblePlan({ engine })`** — the same allowlist that put them there is the only
  definition of engine ownership the repo has; nothing recursively replaces a folder.
- **Exactly one backup slot per installation**, `<root>/.q2launcher-engine-backup/`, overwritten
  by each update; its metadata (version, package id, file list, timestamp) lives in `moduleData`,
  not in a file inside the game folder — "restores the most recent backup" (AC3) needs one slot,
  and the launcher should not have to parse files in a folder the game also writes to.
- **`.q2launcher-engine-backup` is added to `NON_GAME_DIRS`** — so a backup can never surface as a
  selectable game directory in `GameDirSelect`, by rule rather than by luck of its contents.
- **Write order for AC8:** download → verify (size + SHA256, INST-V1–V3) → extract → completeness
  check against the engine allowlist → move the current engine files into the backup (`rename`)
  → copy the new ones; a failure after the first move restores from the backup it just made.
  Nothing inside the installation is touched before verification passed.
- **Bleeding-edge URLs are derived from the manifest's pinned Q2PRO package `url`** (`version.txt`
  next to the asset, and the asset URL itself for the download) — INST-M1 ("no download URL in
  launcher code") stays intact and the content repo needs no schema change.
- **The probe reports the size via a `HEAD` on the asset URL** (`Content-Length`) — the user's
  size-only sanity check needs a reported size, and `version.txt` carries only a version string.
- **Bleeding edge is offered on Q2PRO installations only**; the toggle is not rendered for R1Q2 —
  the direct consequence of the user's Q2PRO-only decision above.
- **One UI surface:** an engine button in the ActionBar's utility cluster opens a module dialog
  (update / rollback / bleeding-edge toggle), mirroring [[090]]'s `retail-upgrade` dialog; the
  rail + library-card duplication of that story's trigger is deliberately not repeated.
- **Update and rollback both run as `JobsService` jobs** — so the Downloads tab, cancel and the
  failure log work unchanged, and both writing paths carry [[091]]'s guard in one shape, even
  though rollback downloads nothing.
- **AC6 rides [[091]]'s guard as an injected dependency**, with no second running-game check of
  this story's own; 092 proves *usage* at unit level, 091 proves the waiting state on the real
  surface (its own AC1–AC3).
- **The e2e flow seeds an out-of-date installation** into the fixture and runs the real job
  against the loopback fixture server (a second engine package version plus a `version.txt`/`HEAD`
  route) instead of bootstrapping one first — same offline discipline, a fraction of the runtime.

## Plan

Everything lands in the existing `downloads` module; the shell change is two lines in `ActionBar`.

1. **Contract first** (`src/shared/modules/downloads.ts`, `main/modules/downloads/schemas.ts`):
   four handlers — `engine.updateStatus`, `engine.updateStart`, `engine.rollbackStart`,
   `engine.setBleedingEdge` — their wire types, and the new `downloads.error.*` keys. Mirrors
   story 090 D1.
2. **Per-installation engine state**: a zod-parsed `moduleData['downloads']` shape plus one narrow
   `InstallationsService.setEngineState()` (mirroring `setIcon`/`setLastFailure`) that also writes
   `detectedVersion`. `bootstrap/job.ts` calls it on success.
3. **Update check** (pure): recorded version + channel (pinned | bleeding edge) + manifest →
   `EngineUpdateStatus`. No download, no write — AC1.
4. **Bleeding-edge probe**: `version.txt` next to the pinned Q2PRO asset + `HEAD` for the size,
   behind the same `DownloadSource`/harness gate the manifest fetch uses. AC4/AC5.
5. **Update job** (`engine/update-job.ts`, shaped after `retail/upgrade-job.ts`): resolve →
   091 guard → download/verify/extract → completeness → backup by `rename` → copy → record version
   → `installations.validate()`. AC2/AC6/AC7/AC8.
6. **Rollback job** (`engine/rollback-job.ts`): 091 guard → restore the recorded backup file list
   → record the backed-up version. No network. AC3/AC6/AC7.
7. **Renderer**: `engine/EngineUpdateAction.tsx` (button + status, module-owned) rendered by
   `ActionBar`, `engine/EngineUpdateDialog.tsx` registered in `bootstrap/Dialogs.tsx`, client
   methods, `en.json` keys.
8. **Offline e2e**: fixture gains a second engine package version + the probe routes; new flow
   `scripts/flows/engine-update.mjs` drives update → rollback → bleeding-edge toggle for real.

Order: 1 → 2 → (3, 4) → 5 → 6 → 7 → 8. Steps 3–6 are main-only and testable without the UI.

## Deliverables

- **D1 — the contract.** `DOWNLOADS_HANDLERS` entries `engineUpdateStatus`/`engineUpdateStart`/
  `engineRollbackStart`/`engineSetBleedingEdge`, the types (`EngineUpdateStatus`,
  `EngineUpdateChannel`, `EngineBackupInfo`, `StartEngineUpdateInput/Result`,
  `SetBleedingEdgeInput`) and the new `DOWNLOADS_ERROR_KEYS` members
  (`engineUpdateUnavailable`, `engineNoBackup`, `engineReplaceFailed`,
  `bleedingEdgeUnsupported`, `bleedingEdgeProbeFailed`, `bleedingEdgeSizeMismatch`).
  Files: `src/shared/modules/downloads.ts`, `src/main/modules/downloads/schemas.ts`.
  Mirror: story 090 D1's `StartRetailUpgradeInput` block and its schema entry.
  Acceptance: `npm run typecheck` green plus its schema cases in
  `src/main/modules/downloads/schemas.test.ts` (reject non-string ids, unknown keys).
- **D2 — the recorded engine version.** `InstallationEngineState` (version, packageId,
  bleedingEdge, backup) with a defensive parser, and `InstallationsService.setEngineState(id,
  patch)` writing both `moduleData.downloads` and `detectedVersion`; `bootstrap/job.ts` records
  the engine package it just installed. `.q2launcher-engine-backup` joins `NON_GAME_DIRS`.
  Files: `src/main/modules/downloads/engine/installation-state.ts` (new),
  `src/main/services/installations.ts`, `src/main/lib/schemas.ts`, `src/shared/constants.ts`,
  `src/main/modules/downloads/bootstrap/job.ts`.
  Mirror: `InstallationsService.setLastFailure` (story 077 D1).
  Acceptance: plus its tests in `engine/installation-state.test.ts` and
  `src/main/services/installations.test.ts` — a round-trip write/read, a garbage `moduleData`
  parsed back to "unknown" rather than throwing, and `detectedVersion` visible on the record.
- **D3 — the update check (AC1).** `engine/update-status.ts`: recorded state + engine kind +
  manifest snapshot + channel → `EngineUpdateStatus` (`current`, `target`, `updateAvailable`,
  `channel`, `backup`), plus the `engine.updateStatus` handler in `index.ts`. Reads nothing,
  writes nothing.
  Files: `src/main/modules/downloads/engine/update-status.ts` (new),
  `src/main/modules/downloads/index.ts`.
  Acceptance: plus its test in `engine/update-status.test.ts` — equal versions ⇒ no update,
  different ⇒ update, unknown recorded version ⇒ update with `current: undefined`, engine with no
  manifest pin ⇒ no update and no throw.
- **D4 — bleeding edge (AC4/AC5).** `engine/bleeding-edge.ts`: derive the `version.txt` URL from
  the pinned Q2PRO package's `url`, fetch it, `HEAD` the asset for `Content-Length`, answer
  `{ version, sizeBytes, url }`; Q2PRO-only (`bleedingEdgeUnsupported` for R1Q2). Plus the
  `engine.setBleedingEdge` handler persisting the per-installation flag through D2's writer, and
  D3's check honouring it.
  Files: `src/main/modules/downloads/engine/bleeding-edge.ts` (new),
  `src/main/modules/downloads/engine/update-status.ts`, `src/main/modules/downloads/index.ts`.
  Mirror: `manifest-service.ts`'s fetch + `harness.ts`'s `DownloadSource` gate (never a hardcoded
  host).
  Acceptance: plus its test in `engine/bleeding-edge.test.ts` with a stub fetch — probe parses the
  version, a missing/garbage `version.txt` fails with the key, R1Q2 is refused, and turning the
  flag off makes the check compare against the pin again.
- **D5 — the update job (AC2/AC6/AC7/AC8).** `engine/update-job.ts`, shaped after
  `retail/upgrade-job.ts`: hosts for jobs/installations, [[091]]'s guard injected as a dep, the
  download/verify/extract of the target package, the engine-allowlist completeness check, backup
  by `rename` into `<root>/.q2launcher-engine-backup/`, copy of the new files, restore-on-failure,
  `setEngineState`, `installations.validate()`.
  Files: `src/main/modules/downloads/engine/update-job.ts` (new),
  `src/main/modules/downloads/index.ts`.
  Mirror: `src/main/modules/downloads/retail/upgrade-job.ts` (job creation, `report`/`failed`,
  staging + rename discipline) and `bootstrap/job.ts`'s package download/extract path.
  Acceptance: plus its tests in `engine/update-job.test.ts` — a successful run leaves the new
  files in place and the old ones in the backup, a verification failure leaves every engine file
  byte-identical and no backup dir, a failure during the copy restores the backup, the recorded
  version afterwards is the one that was written, and the write phase does not start while the
  guard reports the game running (and does start once it clears).
- **D6 — rollback (AC3/AC6/AC7).** `engine/rollback-job.ts`: 091's guard, restore the recorded
  backup's file list over the current engine files, drop the backup pointer, record the restored
  version. No network, no manifest.
  Files: `src/main/modules/downloads/engine/rollback-job.ts` (new),
  `src/main/modules/downloads/index.ts`.
  Mirror: D5's own job scaffold.
  Acceptance: plus its tests in `engine/rollback-job.test.ts` — restores byte-for-byte without any
  fetch being called, refuses with `engineNoBackup` when there is none, and the recorded version
  afterwards is the backed-up one.
- **D7 — the surface.** `EngineUpdateAction` (button in the ActionBar utility cluster, carrying an
  "update available" indicator) and `EngineUpdateDialog` (current/target version, Update,
  Rollback, bleeding-edge toggle), client methods, i18n keys.
  Files: `src/renderer/src/modules/downloads/engine/EngineUpdateAction.tsx` (new),
  `.../engine/EngineUpdateDialog.tsx` (new), `.../downloads/client.ts`,
  `.../downloads/bootstrap/Dialogs.tsx`, `src/renderer/src/components/shell/ActionBar.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
  Mirror: `modules/downloads/retail/RetailUpgradeDialog.tsx` + its `ActionBar` trigger (story 090
  D3/D4), including its `data-testid` convention (`engine-update-*`).
  Acceptance: `npm run build` green, the i18n vocabulary test passes, and the dialog is reachable
  from the ActionBar button.
- **D8 — the offline proof.** Fixture: a second Q2PRO engine package version (distinct fill bytes)
  the server can pin on request, plus `/engines/version.txt` and `HEAD` support for the probe, and
  a seed helper for an installation with an out-of-date recorded engine version. Flow:
  `scripts/flows/engine-update.mjs`.
  Files: `scripts/lib/fixture.mjs`, `scripts/flows/engine-update.mjs` (new), the flow registry in
  `scripts/ui-verify.mjs`.
  Mirror: `scripts/flows/retail-upgrade.mjs` (assertion style, job waiting, `shot()` placement).
  Acceptance: `npm run ui:verify` runs the flow with no outbound network and its assertions hold.

## Model Hints

- D5 → `deliverable-hard` — it is the only deliverable that overwrites the engine files of an
  already-playable installation, and its backup/restore-on-failure ordering across [[091]]'s
  waiting guard is exactly where a half-replaced installation (AC8) would come from.
- Every other deliverable → default tier: D1–D4 are contract/pure-logic/fetch work with existing
  mirrors, D6 is D5's scaffold minus the network, D7 copies an existing dialog, D8 copies an
  existing flow.
- Review: → `story-review-hard` — this story writes into a user's existing, working game folder
  and its correctness argument is a file-move ordering, which is the kind of thing a cheap review
  reads past.

## Acceptance Tests

- AC1 → D3 + D5(fix) + D7; unit `src/main/modules/downloads/engine/update-status.test.ts` ›
  "a recorded version different from the pin reports an available update" and "an unknown recorded
  version reports an available update without a current version", plus
  `src/main/modules/downloads/index.test.ts` › "resolves the pinned target on a cold manifest
  service, without any earlier manifest call" (the review-fix regression test for the manifest
  warm-up bug), plus e2e `scripts/flows/engine-update.mjs` › "an out-of-date installation shows
  the update affordance and nothing has been downloaded or changed".
- AC2 → D5; unit `src/main/modules/downloads/engine/update-job.test.ts` › "a successful update
  replaces the engine files and keeps the previous ones in the backup" and "an archive without the
  optional menu file leaves the installation copy in place", plus e2e
  `scripts/flows/engine-update.mjs` › "applying the update writes the new engine bytes and leaves
  the old ones in the backup directory".
- AC3 → D6; unit `src/main/modules/downloads/engine/rollback-job.test.ts` › "rollback restores the
  backup without fetching anything", plus e2e `scripts/flows/engine-update.mjs` › "rollback
  restores the previous engine bytes in one step".
- AC4 → D4 + D5(fix); unit `src/main/modules/downloads/engine/bleeding-edge.test.ts` › "with
  bleeding edge on, the check compares against the probed upstream version" (pure comparator) plus
  `src/main/modules/downloads/index.test.ts` › "takes the target from the probe with bleeding edge
  on, and from the manifest pin with it off" (the actual per-installation flag switch, added in
  review-fix — the story's originally named unit test only covered the pure comparator, not the
  switch), plus e2e `scripts/flows/engine-update.mjs` › "the bleeding-edge toggle changes the
  target version for this installation only".
- AC5 → D4 + D5(fix); unit `src/main/modules/downloads/engine/bleeding-edge.test.ts` › "turning
  bleeding edge off compares against the pinned version again", plus the same
  `index.test.ts` switch test above (covers both directions), plus e2e
  `scripts/flows/engine-update.mjs` › "turning the toggle off restores the pinned target".
- AC6 → D5 + D6; unit `src/main/modules/downloads/engine/update-job.test.ts` › "the write phase
  waits while the target installation's game is running and continues once it exits" and
  `.../rollback-job.test.ts` › "rollback waits on the same guard". The *waiting state on the real
  surface* is [[091]]'s own e2e (its AC1–AC3); this story's e2e cannot hold a real Quake II
  process open against a fixture installation whose executables are filler bytes, so what 092
  proves here is that both jobs go through that guard rather than checking for themselves.
- AC7 → D2 + D5 + D6; unit `src/main/modules/downloads/engine/update-job.test.ts` › "the recorded
  engine version afterwards is the one written to disk" and `.../rollback-job.test.ts` › "the
  recorded version afterwards is the restored one", plus e2e `scripts/flows/engine-update.mjs` ›
  "the rail badge shows the new version after the update and the old one after the rollback".
- AC8 → D5; unit `src/main/modules/downloads/engine/update-job.test.ts` › "a verification failure
  leaves every engine file untouched and creates no backup", "a failure during the copy restores
  the backup, leaving a complete previous engine", "a restore that cannot put a file back keeps the
  backup rather than deleting the only copy left" and "a failure right after the previous backup
  slot is emptied leaves no stale backup pointer" (the last two are review-fix regression tests for
  the two backup-integrity findings below).

## Done

### Summary

Implemented the full engine update/rollback lifecycle for an existing, already-playable
installation: an IPC contract (`engine.updateStatus`/`updateStart`/`rollbackStart`/
`setBleedingEdge`), a per-installation recorded engine version in `moduleData.downloads`
(mirrored into `detectedVersion`), a pure update-status comparator, a Q2PRO-only bleeding-edge
probe against Q2PRO's `version.txt`, an update job and a rollback job both riding [[091]]'s
`InstallationWriteGuard`, an ActionBar button + dialog, and an offline e2e flow
(`scripts/flows/engine-update.mjs`) proving all of AC1–AC5/AC7 against a loopback fixture server.
A first review pass (story-review-hard) found two critical defects — a cold-session manifest
read that made AC1 always report "no update" in a fresh app session, and a backup-integrity gap
where a partial restore or a mistimed pointer update could lose engine files or misdescribe the
backup slot — both fixed and re-reviewed to PASS.

### Commit message

092: an engine updates and rolls back

### Decisions

- **Backup set is what the new archive actually staged, not the full `buildAssemblePlan({engine})`
  allowlist.** An optional engine entry (`baseq2/q2pro.menu`, `required: false`) that the new
  archive doesn't ship would otherwise be moved into the backup and never restored, silently
  deleting it from the installation. A missing *required* entry still fails the completeness
  check before any file is touched, so this only narrows what gets backed up/replaced, never what
  blocks the update. Documented in `update-job.ts` and unit-tested (archive missing the optional
  menu file leaves the existing copy in place).
- **`EngineBackupInfo` carries no file list** (version, package id, timestamp only) despite the
  Decisions (Sprint) text mentioning one; `rollback-job.ts` restores by walking the actual contents
  of `.q2launcher-engine-backup/` on disk instead. Accepted as a safe substitute — the slot is
  written only by the update job, one generation at a time, and is excluded from `GameDirSelect`
  via `NON_GAME_DIRS` — reviewed and kept as-is.
- **Backup pointer is cleared in the same step that empties the old backup slot**, before the new
  backup is written — closing a window found in review where the recorded pointer could describe a
  backup slot that no longer matched what was physically on disk. The remaining window (record says
  "no backup" while a slot may or may not exist) is the safe direction: a rollback attempted there
  answers `engineNoBackup` rather than restoring the wrong thing.
- **A restore that can't move every file back keeps the backup rather than deleting it.** The
  original write-order left a "best-effort restore, then delete the backup regardless" gap that
  review flagged as capable of losing engine files past what AC8 permits; fixed so the backup
  directory is only removed once every file was actually moved back, otherwise the job fails and
  the (possibly partial) backup is preserved for a future retry.
- **The bleeding-edge probe reaches the fixture server without its own `DownloadSource` override.**
  It derives `version.txt`'s URL from the manifest's own pinned Q2PRO package `url`; under the UI
  harness that URL is already rewritten to the loopback fixture origin (`harness.ts`), so the probe
  transitively reaches the fixture. Confirmed correct (not a false-pass) by the e2e flow, which logs
  the fixture server's own request log including `/packages/version.txt`.
- **D8's e2e flow seeds a registered installation directly** (a sixth fixture installation with
  `moduleData.downloads` already pointing at an older recorded version, and real filler-byte engine
  files on disk) rather than running the bootstrap wizard first, per the story's own decision.

### Verification

- `npm run typecheck` — green (node + web).
- `npm test` — 210 files, 3779+ passed, 1 pre-existing skip, 0 failed (post-fix count; grew from
  3774 as review-fix tests were added).
- `npm run build` — green.
- `npm run ui:verify` — 82 screenshots, 0 axe violations.
- `npm run ui:flow -- engine-update` — passes on a cold session (no manual manifest warm-up), all
  logged assertions hold: no package download before Update is clicked (AC1), new bytes written and
  old ones backed up (AC2), rollback restores the old bytes in one step (AC3), bleeding-edge toggle
  changes/reverts the target for that installation only (AC4/AC5), the dialog's displayed version
  updates after each step (AC7).
- Clean-agent review (`story-review-hard`): first pass FAIL (manifest cold-read breaking AC1;
  restore-then-delete and pointer/slot ordering gaps risking AC7/AC8's backup integrity); both
  fixed plus regression tests added; second pass PASS on all six review dimensions (per-AC
  verdicts, test-strength, ordering proof, non-tautological new tests, no regressions, in-scope).
- AC → test mapping verified as listed in `## Acceptance Tests` above; no manual residue.
- AC6's "waiting state on the real surface" stays [[091]]'s own e2e per the story's original
  Decision — 092 only proves both jobs go through the guard, not the waiting UI itself.
