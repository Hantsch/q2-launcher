---
id: 194
title: a newer mod version is offered
status: done # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player, when the curated catalog pins a newer version of a mod I installed through the
launcher, the Mods view tells me so and lets me update with one click. It never updates by
itself. This is the same model as engine updates: the manifest is the truth, the user decides.

Concept: [mods.md](../concepts/mods.md) §10; requirement MOD-12.

## Acceptance Criteria

- [x] **AC1** — When the manifest's pinned version of a catalog entry differs from the version in
      the installation's install record, the tile shows _Update available_ and the detail panel
      shows both versions.
- [x] **AC2** — No file in the gamedir changes until the user clicks _Update_.
- [x] **AC3** — After the update, the gamedir holds the new version's files, the install record
      names the new version and its files, and the tile shows _installed_.
- [x] **AC4** — A file listed in the old record but not in the new version is removed. A file in
      neither record is kept.
- [x] **AC5** — A failed update (verification or extraction) leaves the previous version's files
      and record in place, and shows the failure.
- [x] **AC6** — A manually installed mod never shows _Update available_.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — — Is "newer" any difference from the pinned version (a rollback pin counts as an update
  too, as with engines), or only a higher version?
- ~~**Q2**~~ answered → Decisions (Sprint) — — A recorded file the user changed since install (hash differs): overwrite, keep, or ask?
  This is the same question as 190 Q2 and 191 Q1, and should get one answer for all three.

## Decisions (Sprint)

- **(User)** What is newer: any difference from the pinned version (rollback pin counts, as with engines)
- **(User)** Changed recorded file: ask per operation, same answer as 190 Q2 and 191 Q1
- The update target is always the manifest's **pinned** version. An install of another listed version (189's version picker, e.g. the rc) therefore shows _Update available_ towards the pinned one. Reason: the binding "any difference from the pinned version" answer, and the manifest is the truth.
- Unknown or missing installed version in a catalog record counts as "differs". A record without a catalog id, or no record at all, never counts. Reason: this is the engine precedent (`update-status.ts`), and AC6 says manual mods never get an update.
- The update re-picks the variant with 190's rule (platform plus engine architecture), so the result can move between full and content-only. Reason: concept §10 says an update "runs as an install of the new version".
- AC3's "the tile shows _installed_" covers _installed — content only_ when the new variant is content-only. Reason: that is the same installed-status family 188/190 define, and showing plain _installed_ there would hide 190's AC4 reason.
- The changed-file question is asked **once per update, before the job starts**, through 190's changed-files dialog. It lists every recorded file whose disk hash differs from the record, whether the new version overwrites it or deletes it as obsolete. The single choice applies to all of them. _Overwrite/delete_ replaces or deletes them. _Keep_ leaves them byte-for-byte untouched and leaves them out of the new record, so they become user files. Reason: this is the binding "ask per operation" answer, and 190 AC9 says the record lists only files the launcher wrote.
- The job re-hashes at write time and applies the chosen policy to every changed file it finds then, not only to the ones shown in the dialog. Reason: a file edited between the dialog and the write must not slip through as silently overwritten when the user said _keep_.
- Before anything is overwritten or deleted, the write phase moves the file into a same-device backup slot `<root>/.q2launcher-mod-backup/<jobId>/<gamedir>/…` (dot-prefixed, so the inspector never sees it as a gamedir). The new record is written last. Any write-phase error restores the backup, removes files this run created, keeps the old record, and the slot is deleted on every exit. Reason: AC5 has to hold for a failure _during_ writing, not only before it. This mirrors the engine update job's backup and restore (`update-job.ts`).
- Download, verify and extract happen into the cache/staging dir. A verification or extraction failure therefore ends the job before the write phase, and the gamedir is never touched. Reason: AC2 and AC5, plus 190's pipeline order.
- The update's write phase runs inside `app.writeGuard.runWrite`, like install and remove. Reason: MOD-9 applies to every write into an installation, and updating while the game runs would swap a loaded game library.
- Update status is computed in main as part of the existing mods list/state response (status `update-available` plus `installedVersion`/`pinnedVersion`), with no extra polling channel and no download before the click. Reason: AC2, and one source of truth for tile and detail panel.
- A failed update shows the job's failure reason in the Downloads surface and in the detail panel, the same way 190 shows a failed install. The tile keeps _Update available_. Reason: AC5's "shows the failure", reusing 190's failure surface rather than inventing a second one.
- The update is one job with its own i18n'd title ("Update <mod> to <version>"). Its main action reuses the tile's single action slot (Install / **Update** / Installed, concept §9). Reason: the concept's one-main-action tile.

## Plan

Builds on 190 (install job, install record in `moduleData['mods']`, changed-files dialog) and 191
(record-driven delete). Files named here follow concept §12. Where 190 lands a different name, use 190's.

1. **Pure core (main):** `computeModUpdateStatus(record, catalogEntry)` compares the pinned version
   with the installed one, with manual → never. `planModUpdate(oldRecord, newFiles, diskHashes, policy)`
   splits files into write / delete-obsolete / changed / kept-untouched. "In neither record" is
   never in any list.
2. **Update job (main):** reuse 190's download → verify → extract into staging. Then, inside the
   write guard, back up → write → delete obsolete → write the new record. On error, restore and keep
   the old record. Built next to 190's install job and mirroring `downloads/engine/update-job.ts`'s
   backup and restore.
3. **Contract + handlers:** `mods/update` (installationId, catalogId, changedPolicy) and
   `mods/updatePreview` (changed-file list), both zod-validated. The list/state response gains the
   `update-available` status and both versions.
4. **Renderer:** the tile badge plus the Update main action. The detail panel shows installed and
   pinned versions, Update, and the failure reason. The changed-files dialog is reused from 190.
   Add i18n keys and a CHANGELOG line.
5. **Flow:** `scripts/flows/mod-update.mjs` against the fixture content server with a newer
   pinned version.

Order: D1 → D2 → D3 → D4. D4 also carries the flow.

## Deliverables

- **D1 — pure update status and update plan.** Create `src/main/modules/mods/update-status.ts`
  (mirror `src/main/modules/downloads/engine/update-status.ts`). `computeModUpdateStatus(record | undefined,
entry | undefined)` returns `{ updateAvailable, installedVersion?, pinnedVersion? }`, with these rules:
  - `updateAvailable` is true only when a record with a catalog id exists and the entry's pinned
    version is defined and differs from the record's version. A missing installed version counts as
    "differs".
  - Any difference counts, including a lower pinned version (a rollback pin).
  - With no record, or a record without a catalog id (manual), it is always false.

  Create `src/main/modules/mods/update-plan.ts`. `planModUpdate(oldRecord, newFiles, diskHashes,
policy: 'overwrite' | 'keep')` returns `{ write[], deleteObsolete[], changed[], keptUntouched[] }`
  over gamedir-relative paths:
  - `changed` holds the recorded files whose disk hash ≠ record hash.
  - `deleteObsolete` is old minus new, without the files kept under `keep`.
  - `write` is the new files, without the changed files kept under `keep`.
  - A file in neither record never appears in any list.

  Tests: `update-status.test.ts`, which also covers rollback pin, manual and missing version, and
  `update-plan.test.ts` (see Acceptance Tests). Main only, no IPC.

- **D2 — the update job with backup and rollback.** Add `src/main/modules/mods/update-job.ts`
  next to 190's install job, reusing its download/verify/extract-to-staging steps. Mirror the
  backup/restore of `src/main/modules/downloads/engine/update-job.ts` (`moveFile`, `restore()`,
  staging cleanup). The order is:
  1. Resolve the variant with 190's picker.
  2. Download, verify and extract into staging. A failure here fails the job, and the gamedir and
     record stay untouched.
  3. Inside `app.writeGuard.runWrite`, re-hash the recorded files and call `planModUpdate`.
  4. Move every file to be overwritten or deleted into `<root>/.q2launcher-mod-backup/<jobId>/<gamedir>/`.
  5. Copy the `write` files from staging, then write the new record. The record holds version,
     variant, and files with size and hash, minus the kept ones.
  6. Delete the backup slot.

  On any write-phase error, move the backups back, delete the files this run created, leave the
  old record, delete the slot, and fail the job with an i18n reason key. Files in neither record are
  never touched.

  Test: `src/main/modules/mods/update-job.test.ts` against a temp root, with injected failures at
  verify, at extract and mid-copy.

- **D3 — contract and handlers.** In `src/shared/modules/mods.ts`, add handler `update` with the zod
  payload `{ installationId, catalogId, changedPolicy: 'overwrite' | 'keep' }`. Add `updatePreview`
  with `{ installationId, catalogId }`, which returns the changed recorded files as relative paths.
  Extend the tile/entry state type with status `update-available` and `installedVersion`/`pinnedVersion`.

  In `src/main/modules/mods/index.ts`:
  - Wire both handlers. Validate the installation id and catalog id in main, and refuse a mod
    without a catalog record.
  - Compute the status via D1 in the list/state handler.
  - Emit the same refresh event 190 emits after the job ends.

  Tests: extend 190's `src/main/modules/mods/index.test.ts` (or the module's handler test) with
  "update refuses a manual mod", "updatePreview lists changed files" and "the list reports
  update-available without touching the gamedir". Also the IPC/contract coverage test that already
  covers module handlers.

- **D4 — renderer and flow.** In `src/renderer/src/modules/mods/`, the tile shows the
  _Update available_ status and an **Update** main action. The detail panel shows "Installed
  <v> · Catalog <v>", an Update button and the last failed job's reason.

  Clicking Update calls `updatePreview`:
  - If no files changed, it starts `update` with `overwrite`.
  - Otherwise it opens 190's changed-files dialog, which sends the user's choice. Cancel starts
    nothing.

  Add the i18n keys in `src/renderer/src/i18n/locales/en.json` (`mods.status.updateAvailable`,
  `mods.action.update`, `mods.detail.versions`, `mods.job.update`, failure reason keys). Add a
  CHANGELOG `## Unreleased` line, folded into the mods entry if one exists.

  Flow `scripts/flows/mod-update.mjs` (mirror `scripts/flows/engine-update.mjs` and 190's mod-install
  flow). The fixture seeds three things:
  - `opentdm` with an old catalog record whose files include `old-only.txt`, plus a user file
    `demos/mine.dm2` that is in no record.
  - `action` with an old record whose new package has a wrong SHA256 in the fixture mods manifest.
  - A manual gamedir `ctf` without a record.

  The fixture content server serves a mods manifest with newer pinned versions.

  Component test: `src/renderer/src/modules/mods/components/ModDetailPanel.test.tsx` (or 188's panel
  test).

## Model Hints

D2 → deliverable-hard. It adds the first record-driven replace into a user-shared folder. The
backup/restore has to undo a failure in the middle of a copy without touching unrecorded user
files, and without losing the old record. It also has to interleave correctly with 190's install
pipeline and the write guard. A wrong order loses either user files or the old version.

Review: → default. The mid-copy failure, the "in neither record is kept" negative and "no write
before the click" are each pinned by named unit tests and by the flow's on-disk byte checks.

## Acceptance Tests

- AC1 → unit `src/main/modules/mods/update-status.test.ts` › "a pinned version that differs from
  the record, higher or lower, is an update". e2e `scripts/flows/mod-update.mjs` › "mod-update":
  the `opentdm` tile shows _Update available_, and its detail panel shows both versions.
- AC2 → e2e `scripts/flows/mod-update.mjs` › "mod-update". After the catalog loads with the newer
  pin, the `opentdm` gamedir bytes are unchanged and the fixture server has received no package
  request until Update is clicked. Also unit `src/main/modules/mods/index.test.ts` › "the list
  reports update-available without touching the gamedir".
- AC3 → e2e `scripts/flows/mod-update.mjs` › "mod-update". After Update, the gamedir holds the
  new version's bytes, `moduleData['mods']` names the new version and its files, and the tile shows
  _installed_. Also unit `src/main/modules/mods/update-job.test.ts` › "a successful update writes
  the new files and record".
- AC4 → unit `src/main/modules/mods/update-plan.test.ts` › "a file only in the old record is
  deleted, a file in neither record is never listed". Also unit `update-job.test.ts` › "update
  removes obsolete recorded files and keeps unrecorded ones". e2e `scripts/flows/mod-update.mjs` ›
  "mod-update": `old-only.txt` is gone and `demos/mine.dm2` remains.
- AC5 → unit `src/main/modules/mods/update-job.test.ts` › "a verify or extract failure leaves the
  old files and record" and "a mid-copy failure restores the backup and keeps the old record". e2e
  `scripts/flows/mod-update.mjs` › "mod-update": the `action` update with a bad SHA256 fails, its
  files and record are unchanged, and the failure reason is visible in the detail panel.
- AC6 → unit `src/main/modules/mods/update-status.test.ts` › "a manual gamedir never has an
  update". Also unit `src/main/modules/mods/index.test.ts` › "update refuses a manual mod". e2e
  `scripts/flows/mod-update.mjs` › "mod-update": the manual `ctf` tile shows no _Update available_
  and no Update action.
- Changed-file decision → unit `update-plan.test.ts` › "keep leaves changed files untouched and out
  of the new record". e2e `scripts/flows/mod-update.mjs` › "mod-update" uses the no-changed-files
  path. The dialog itself is proven by 190's flow.

## Done

Update of a catalog mod is real: pure status/plan (`update-status.ts`, `update-plan.ts`), `startModUpdate`/`previewModUpdate` (`update-job.ts`, job kind `mod-update`: stage, re-hash and plan inside the write guard, backup slot, record last, restore on error), handlers `update`/`updatePreview`, `update-available` status with both versions on `list`, renderer tile/detail Update action + `UpdateModDialog` (keep/overwrite), fixture `writeModsUpdateFixture`, flow `mod-update`, CHANGELOG line.

Commit message: `194: a newer mod version is offered — update status/plan, update job with backup and restore, handlers, Update action and dialog, flow`

Verification (narrow gate): `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (122 files / 972 tests), `npm run ui:flow -- mod-update` green; after the review fix vitest (mods + renderer mods), typecheck, build and the flow re-run green. Full gate not run (sprint's). AC -> test: AC1-AC6 and the changed-file decision all mapped unit + flow tests ran and passed as listed (flow AC5 check now scoped to the detail panel); no manual residue. Review: stage 1 PASS, 2 minor fixed (AC5 flow scope, case-mapping test); unfixed minor: keep/slot-retained and cancel paths of update-job untested, install-job does not check for a running `mod-update` (write guard serialises), unchanged identical recorded files are moved and rewritten.

Decisions:

- Changed-file dialog is a new `UpdateModDialog` (keep default / overwrite), not 190's `InstallDecisionDialog` (tied to `resolveInstall`); follows the `RemoveModDialog` pattern. Versions line uses key `mods.detail.installedVsCatalog` (`mods.detail.versions` was taken).
- `install-job.ts` exports `resolveModVariant`, `stagePackages`, `collectPackageFiles` etc. for reuse; `remove-job.ts` busy check also blocks on `mod-update`.
- Unrecorded file at a path the new version ships is left untouched and kept out of the record; new paths differing only in case map to the old record's spelling; a backup slot is kept (logged) if a restore is incomplete.
- No separate refresh event (190 emits none beyond jobs list + revalidation).
- Pre-existing red, not caused here and not fixed (allowlist edit denied by the permission classifier): `src/main/modules/downloads/layering.test.ts` fails at HEAD because `mods/index.ts` contains "7za" (from 192's `../downloads/7za-path` import); needs `mods/index.ts` in `ALLOWED_MAIN_SPAWN_NETWORK_FILES`.

tiers: D 5 / hard 1 · review default · cycles 1 · agents 8
