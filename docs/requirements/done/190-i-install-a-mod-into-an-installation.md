---
id: 190
title: I install a mod into an installation
status: done # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player, I click **Install** on a catalog tile and the mod lands in my installation, with the
game library that fits my engine and platform. When no such build exists, the launcher still
installs what it can, so joining a server works. It then tells me plainly that the mod is not
playable locally with this engine. Example: OpenTDM ships only a 32-bit Windows DLL, and the
bundled Q2PRO is 64-bit.

The install is a job in the existing pipeline: progress, mirrors in order, size and SHA256
verification, archive cache, 7-Zip extraction. Its write phase runs inside the write guard, so it
waits while the game runs. The launcher keeps an install record of the files it wrote
(`Installation.moduleData['mods']`). Stories 191 (remove) and 194 (update) work from that record.

Concept: [mods.md](../concepts/mods.md) §6, §10; requirements MOD-5 to MOD-11.

## Acceptance Criteria

- [x] **AC1** — Clicking Install on a catalog tile starts a job that shows progress in the
      Downloads surface and on the tile.
- [x] **AC2** — When the job finishes, the mod's files are in `<installation root>/<gamedir>/`
      and the tile shows *installed*.
- [x] **AC3** — With a matching variant, the installed game library is the one for the
      installation's platform and engine architecture (for example, r1q2 on Windows gets the
      32-bit `gamex86.dll`).
- [x] **AC4** — Without a matching game library, the content is installed, and the tile and
      detail panel show the visible text "Not playable locally with <engine>: no matching build".
- [x] **AC5** — A package whose size or SHA256 does not match is never extracted or written. The
      job fails with a visible reason, and the installation is unchanged.
- [x] **AC6** — When the source URL fails, the package's mirrors are tried in order.
- [x] **AC7** — While the game runs in that installation, the job waits before writing and says
      so. It writes once the game has exited.
- [x] **AC8** — After the install, the action bar's gamedir picker offers the mod.
- [x] **AC9** — The installation's state contains an install record listing every file the job
      wrote, with its size and hash, plus the catalog id, version and variant.
- [x] **AC10** — Installing a catalog mod whose gamedir already exists as *installed manually*
      first shows a confirmation naming the folder. Cancelling writes nothing.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — (concept §14 item 1) — Where does the engine architecture come from: the engines-manifest
  entry the installation was built from, the executable's PE/ELF header, or a per-engine,
  per-platform table? Manually added installations have no manifest entry.
- ~~**Q2**~~ answered → Decisions (Sprint) — (concept §14 item 7) — When installing over a manual gamedir, what happens to an existing
  file with the same name: overwrite, keep, or ask?
- ~~**Q3**~~ answered → Decisions (Sprint) — (concept §14 item 9) — OpenTDM's Linux build is a `.tar.gz`. Does the vendored 7-Zip
  extract it in one step, or in two (gz, then tar), on both platforms?

## Decisions (Sprint)

- **(User)** Engine architecture source: engines-manifest entry when the installation has one, else the executable PE/ELF header
- **(User)** Existing same-name / changed file: ask per operation: a dialog lists the changed/conflicting files and the user chooses overwrite or keep (same answer as 191 Q1 and 194 Q2)
- **Q3 `.tar.gz`: two passes, same code on both platforms.** Running the vendored `7za.exe x` on a
  `.tar.gz` here produced only the inner `.tar`. 7-Zip's `7zz` on Linux behaves the same way, so the
  stager extracts a lone staged `*.tar` a second time.
- **Arch from the manifest = a new optional `arch: 'x86' | 'x86_64'` on engine packages.** The
  engines manifest has no bitness today. The entry is found through the installation's recorded
  `moduleData['downloads'].packageId`, which is the "entry the installation was built from".
- **Header fallback reads PE COFF `Machine` (0x14c → x86, 0x8664 → x86_64) and ELF
  `EI_CLASS`/`e_machine` (3 → x86, 62 → x86_64).** Anything else is `unknown`. These are the only
  two binary formats the app launches.
- **An `unknown` arch matches no game library, so the install is content-only with the AC4
  reason.** Guessing a DLL that will not load is worse than being honest.
- **The variant platform comes from the executable's binary kind (`pe` → `win32`, `elf` →
  `linux`), falling back to `process.platform`.** A Windows build under Wine on Linux needs the
  Windows library.
- **No matching variant and no content-only variant: refused before any job, with
  `mods.error.noVariant`.** Nothing to install is a visible refusal, not an empty job.
- **The over-manual confirmation comes after staging, before any write.** AC10's "first" means
  before anything is written into the installation. The dialog has to list the conflicting files
  (user decision), and those are only known once the package is extracted. Until the user answers,
  the download lands only in the launcher's own cache.
- **A conflict is an existing file of the same name (case-insensitive) whose SHA256 differs.** An
  identical existing file is left alone and not recorded. A file the user chose to *keep* is not
  recorded, so 191 can never delete it. An overwritten file is recorded, because the launcher wrote
  it.
- **The dialog appears only when the gamedir exists as *installed manually*.** A gamedir with an
  install record is refused with `mods.error.alreadyInstalled` (replacing it is 194's update).
- **The job waits for the decision through the existing `JobsService.setWaiting` with
  `mods.job.waitingForDecision`.** That is the generic, key-carrying wait story 091 built for later
  waits, so no new job state is needed.
- **All packages of a variant are downloaded, verified and staged before the first write.** The
  write phase backs up every file it overwrites and restores it on failure, so a failed package or
  write never leaves half a mod (AC5).
- **Download, verification and 7-Zip stay inside the downloads module.** `layering.test.ts`
  confines spawn/fetch/7za tokens there. A new `downloads/stage-package.ts` is injected into the
  mods job.
- **Persistence goes through a generic `InstallationsService.setModuleData(id, moduleId, value)`.**
  A module cannot persist per-installation data otherwise. It follows `setEngineState`'s precedent,
  and 191/194 reuse it.
- **Version: the install payload has an optional `version`, defaulting to the pinned one, and main
  checks it against the entry's listed versions.** This carries 189's "version selectable in the
  UI" decision.
- **The `<engine>` in AC4 is the engine's display name plus bitness ("Q2PRO 64-bit"), rendered from
  `engineKind` + `arch` in the record.** That matches the concept's own example and keeps prose off
  IPC.
- **Mods are written to `<rootPath>/<gamedir>/`, keeping an existing folder's spelling, and never
  to `writeDirPath`.** The engine loads mod libraries from its base directory.
- **The tile finds its job through `activeInstalls: {catalogId, jobId}[]` in the mods state
  response.** A remounted view finds its running job again without hacking `labelParams`.
- **Proof is five offline `ui:flow`s against the loopback fixture server.** This follows the
  `engine-update.mjs` pattern, one flow per independent precondition.

## Plan

Builds on 188 (mods module, tiles, detail panel, mods state) and 189 (catalog with variants per
*(platform, arch)*, its manifest parse and fixture route). Where those stories named a file or a
field differently from below, their name wins. The behaviour described here does not change.

1. **Engine arch (main, pure).** Add optional `arch` to engine packages in the engines manifest,
   its schema and the shared type, plus `readBinaryArch()` for PE/ELF. A `resolveEngineTarget()`
   returns `{ platform, arch, engineKind }`, and `selectVariant()` picks the full variant or the
   content-only fallback.
2. **Install record (main).** A defensive `moduleData['mods']` reader/writer plus
   `InstallationsService.setModuleData`.
3. **Package stager (downloads module).** Download with mirrors in order, size+SHA256, archive
   cache, extract into `extract/<jobId>`, then a second pass for a lone `.tar`. No installation
   writes.
4. **Install job (main, hard).** Pre-flight refusals → job → stage every package → map `contents`
   into a gamedir tree → compute conflicts → (manual gamedir) wait for the decision → `runWrite`
   (backup, copy, record) → `validate()`.
5. **Contract + wiring.** Add `install` / `resolveInstall` handlers with zod payloads, an
   `installDecision` event and `activeInstalls` in the mods state.
6. **Renderer.** Install on the tile and in the detail panel, progress and waiting reason on the
   tile, the decision dialog, the content-only reason text, i18n keys and the changelog line.
7. **Fixture + e2e flows.** Mod packages served by the loopback fixture server (a source 404 with a
   working mirror, a bad-SHA package, a `.tar.gz`), r1q2/q2pro installations with recorded arch, a
   manual gamedir, and five flows.

Order: D1, D2 and D3 are independent. D4 needs D1–D3, D5 needs D4, D6 needs D5, and D7/D8 need D6.

## Deliverables

- **D1 — Engine target and variant selection.** Add optional `arch: 'x86' | 'x86_64'` to engine
  packages in `src/main/modules/downloads/schemas.ts` (both URL variants share
  `manifestPackageBaseSchemaWith`, so add it in the `engine` branch only) and to `ManifestPackage`'s
  engine member in `src/shared/modules/downloads.ts`. Set it in
  `content/q2_community_content/engines/manifest.json` (`q2pro-nightly-win64` → `x86_64`,
  `r1q2-b8012-msvs2022-win32` → `x86`). Add `readBinaryArch(path): Promise<'x86' | 'x86_64' |
  'unknown'>` to `src/main/lib/fs-utils.ts`, next to `readBinaryKind` (same never-throw style). For
  PE it reads `e_lfanew` at 0x3C, checks `PE\0\0`, and reads Machine: 0x14c → x86, 0x8664 → x86_64.
  For ELF it reads EI_CLASS and `e_machine` at offset 18: 3 → x86, 62 → x86_64. Everything else is
  `unknown`. New `src/main/modules/mods/engine-target.ts` gets two functions:
  - `resolveEngineTarget(installation, enginePackages, readArch)` returns
    `{ platform: 'win32' | 'linux', arch, engineKind }`. `arch` is the manifest package's `arch` when
    `moduleData['downloads'].packageId` (read with `readEngineState`) names an engine package with
    one, else the header of `installation.executablePath`. `platform` is `executableKind` `pe` →
    `win32`, `elf` → `linux`, else `process.platform`.
  - `selectVariant(entryVersion, target)` returns `{ variant, contentOnly: boolean }` or
    `{ refused: 'mods.error.noVariant' }`. It takes the variant whose `(platform, arch)` equals the
    target and that carries a game library. Otherwise it takes the entry's content-only variant for
    that platform, or any content-only variant. An `unknown` arch never matches a library variant.
  Use 189's variant field names. Tests: `src/main/lib/fs-utils.test.ts` gets
  "readBinaryArch reads x86 and x86_64 from PE and ELF headers" (synthetic headers in a temp dir,
  plus a truncated file → `unknown`). `src/main/modules/mods/engine-target.test.ts` gets "r1q2 on
  Windows selects the x86 library variant", "an x86-only mod for a 64-bit Q2PRO selects
  content-only", "the manifest arch wins over the header", and "no variant and no content-only
  variant is refused". `src/main/modules/downloads/schemas.test.ts` gets "an engine package
  accepts an optional arch and refuses an unknown one".

- **D2 — Install record.** New `src/main/modules/mods/install-record.ts`. If 188 already created a
  reader for `moduleData['mods']`, extend that file. There is exactly one parser of this key.
  Shape: `{ records: ModInstallRecord[] }`, and `ModInstallRecord = { catalogId, gamedir, version,
  variantId, engineKind, arch, platform, contentOnly, installedAt (epoch ms), files: { path
  (gamedir-relative, forward slashes), sizeBytes, sha256 }[] }`. `readModsState(moduleData)` parses
  defensively, mirroring `src/main/modules/downloads/engine/installation-state.ts`: a bad record is
  dropped, garbage becomes `{ records: [] }`, and it never throws. `withRecord(moduleData, record)`
  replaces any record for the same gamedir (case-insensitive) and keeps every other module's key.
  Add `setModuleData(id, moduleId, value): Outcome<Installation>` to
  `src/main/services/installations.ts`, shaped exactly like `setEngineState` (find → fail
  `installations.error.notFound`, one `commit()`, bump `updatedAt`). Put the shared record type
  (renderer reads `contentOnly`/`engineKind`/`arch`/`version`) in `src/shared/modules/mods.ts`.
  Tests: `src/main/modules/mods/install-record.test.ts` gets "a malformed record is dropped, others
  survive" and "writing a record keeps other modules' moduleData". `installations.test.ts` gets
  "setModuleData persists under its module key only".

- **D3 — Package stager in the downloads module.** New
  `src/main/modules/downloads/stage-package.ts` exports `stagePackage({ source: PackageSource,
  jobId, userDataPath, signal, onProgress, resolveExtractor, download?, extract? })` →
  `{ ok: true, archivePath, extractDir } | { ok: false, key: DownloadsErrorKey, cancelled }`. It
  calls `downloadPackage` (`fetcher.ts`: `url` then `mirrors` in order, `.part`, size+SHA256, archive
  cache), then `extractArchive(markVerified(...))` (`extractor.ts`) into
  `getExtractDir(userDataPath, \`${jobId}-${index}\`)` from `pipeline.ts` (SAFE_JOB_ID allows that).
  If the extract dir then holds exactly one `*.tar` file and nothing else, it extracts that a second
  time into the same dir and deletes the `.tar`. A failed or unverified download never spawns the
  extractor. It creates no job (the caller owns the job) and writes nothing outside the downloads
  cache. Mirror `src/main/modules/downloads/engine/update-job.ts`'s download/extract section and
  `pipeline.ts`'s cancel checks. Export a production `resolveVendoredExtractor()` wrapper around
  `resolveExtractorPath({ isPackaged, resourcesPath })` from this file, so callers outside the
  downloads module never import the 7-Zip path module (`layering.test.ts` forbids that token outside
  `downloads/`). Tests in `src/main/modules/downloads/stage-package.test.ts` (fake download/extract
  seams, plus one real-7za case skipped when the binary is not vendored, like `extractor.test.ts`):
  "a size or SHA256 mismatch never extracts", "a failing url falls back to the mirror", and "a
  .tar.gz is extracted in two passes".

- **D4 — The install job.** New `src/main/modules/mods/install-job.ts` exports
  `startModInstall(deps, { installationId, catalogId, version? })` → `Outcome<{ jobId, settled }>`.
  It mirrors `src/main/modules/downloads/engine/update-job.ts` and `retail/upgrade-job.ts`: narrow
  `Jobs`/`Installations`/`WriteGuard` host interfaces, one `AbortController`, `report()` silent
  after cancel, and one failure exit with i18n keys. Deps: `jobs`, `installations` (`find`,
  `validate`, `setModuleData`), `writeGuard` (`runWrite` only, required), `catalog` (189's
  `getEntry(catalogId)`), `enginePackages()`, `stage` (D3's `stagePackage`), `readArch`
  (`readBinaryArch`), `askDecision(jobId, { folder, conflicts })` → `Promise<'overwrite' | 'keep' |
  'cancel'>`, `log`. The steps:
  1. **Pre-flight, before `jobs.create` (no job, nothing on disk).** Unknown installation →
     `installations.error.notFound`. Unknown catalogId or version not listed →
     `mods.error.unknownMod`. Gamedir fails the `launch-plan.ts` safe-token rule →
     `mods.error.unknownMod`. A record already exists for this gamedir → `mods.error.alreadyInstalled`.
     `selectVariant` refusal → `mods.error.noVariant`.
  2. **Create the job:** `moduleId: 'mods'`, kind `mod-install`, `labelKey: 'mods.job.install'`,
     `labelParams { name }`, `installationId`, cancellable.
  3. **Stage every package of the variant** (D3), with progress across packages. The first failure
     fails the job with its `downloads.error.*` key, and nothing in the installation has been
     touched.
  4. **Build the planned file list:** map each staged tree through the package `contents[]` into
     gamedir-relative paths. Every path must stay inside the gamedir (`isPathContainedBy`, no `..`,
     no absolute paths), otherwise `mods.error.badPackage`. Hash each staged file.
  5. **Manual gamedir** (folder exists, resolved case-insensitively with `findChild`; no record).
     Conflicts are existing files with the same name and a different SHA256. Call
     `jobs.setWaiting(jobId, { key: 'mods.job.waitingForDecision' })`, then `askDecision`. `cancel`
     → job cancelled, staging removed, nothing written, no record. Existing identical files are
     skipped and not recorded. `keep` skips conflicting files and does not record them.
  6. **Inside `writeGuard.runWrite(installation.id, jobId, signal, …)`:** create
     `<rootPath>/<gamedir>` (an existing folder keeps its spelling). Back up each file about to be
     overwritten into the job's staging dir. Copy each file as `<dest>.q2l-part` and then rename it.
     Then `setModuleData(id, 'mods', withRecord(...))` with exactly the files written (size +
     SHA256 of the written bytes) plus catalogId, version, variantId, engineKind, arch, platform and
     contentOnly. Any failure inside restores the backups, removes files this run created, writes
     no record, and fails with `mods.error.writeFailed`.
  7. **Outside the guard:** `installations.validate(id)` (refreshes `gameDirs` for the action bar),
     remove the staging dirs (also in `finally`), and finish the job as succeeded.
  Tests in `src/main/modules/mods/install-job.test.ts` (temp dirs, fake stage/guard/catalog):
  - "a verification failure writes nothing and records nothing"
  - "a second package failing leaves the gamedir untouched"
  - "the write runs inside runWrite"
  - "the record lists every written file with size and hash"
  - "keep leaves the user's file and keeps it out of the record"
  - "overwrite replaces and records the file"
  - "cancel at the decision writes nothing"
  - "a failed copy restores the overwritten file"
  - "an existing record is refused before any job exists"
  - "a content-only variant records contentOnly"

- **D5 — Contract and main wiring.** In `src/shared/modules/mods.ts` add handler types: `install`
  `{ installationId, catalogId, version? }` → `Outcome<{ jobId }>`, and `resolveInstall`
  `{ jobId, choice: 'overwrite' | 'keep' | 'cancel' }` → `Outcome<null>`. Add the event
  `installDecision` `{ jobId, installationId, catalogId, folder, conflicts: string[] }`. Add
  `activeInstalls: { catalogId, jobId, decision?: { folder, conflicts } }[]` and the per-entry
  record fields (`contentOnly`, `engineKind`, `arch`, `version`) to the existing mods state
  response. Put the zod payload schemas next to the mods module's other payload schemas (where 188
  put them). `installationId`/`catalogId` are non-empty strings checked in main, `jobId` matches
  `^[A-Za-z0-9_-]{1,64}$`, and `choice` is an enum. In `src/main/modules/mods/index.ts`, register
  both handlers and wire `startModInstall` with `app.jobs`, `app.installations`, `app.writeGuard`,
  189's catalog, the engines manifest packages from the downloads manifest service (189 shows how
  the mods module reaches it), `stagePackage` + `resolveVendoredExtractor` (D3) and
  `readBinaryArch`. `askDecision` stores a pending resolver per jobId and emits `installDecision`.
  `resolveInstall` settles it, and an unknown or already-settled jobId → `mods.error.noPendingDecision`.
  A job cancelled from the Downloads tab settles its pending decision as `cancel`. Tests: the mods
  module's index test file (mirror `src/main/modules/downloads/index.test.ts`) gets "install
  refuses an invalid payload without starting a job", "resolveInstall settles the pending
  decision", and "resolveInstall with an unknown jobId is refused".

- **D6 — Renderer.** In 188's tile and detail-panel components
  (`src/renderer/src/modules/mods/components/…`): **Install** on a *not installed* catalog tile and
  in the detail panel. The detail panel passes 189's selected version, the tile passes none. While
  the tile's job (joined via `activeInstalls` → the jobs store) runs, the tile shows its progress
  ratio. When `waiting`, it shows the job's `waitingReason` text, reusing the Downloads `JobRow`
  translation of `waitingReason.key`. When `failed`, it shows the job's error text. When a record
  exists, it shows *installed*. When `contentOnly`, both tile and detail show the visible line
  `mods.reason.notPlayableLocally` = "Not playable locally with {{engine}}: no matching build",
  where `{{engine}}` is the engine's display name plus " 32-bit" or " 64-bit" when arch is known.
  New `src/renderer/src/modules/mods/components/InstallDecisionDialog.tsx` (mirror
  `src/renderer/src/components/installations/RemoveInstallationDialog.tsx`) opens on the
  `installDecision` event, or from `activeInstalls[].decision` after a remount. It names the folder,
  lists the conflicting files (or says there are none), and offers **Overwrite**, **Keep my files**
  and **Cancel**, each calling `resolveInstall`. Stable testids: `mods-install-<catalogId>`,
  `mods-tile-status-<catalogId>`, `mods-tile-progress-<catalogId>`,
  `mods-content-only-reason`, `mods-install-decision`, `mods-install-decision-folder`,
  `mods-install-decision-conflict`, `mods-install-decision-overwrite` / `-keep` / `-cancel`. Every
  string is an i18n key in `src/renderer/src/i18n/locales/en.json` (`mods.action.install`,
  `mods.status.installed`, `mods.status.installedContentOnly`, `mods.reason.notPlayableLocally`,
  `mods.job.install`, `mods.job.waitingForDecision`, `mods.decision.*`, and every `mods.error.*` key
  from D4/D5). Add one `CHANGELOG.md` line under `## Unreleased` → `### Added`: "Install Action
  Quake, OpenTDM and CTF from the Mods view, with the build that fits your engine." Tests:
  `InstallDecisionDialog.test.tsx` gets "lists every conflicting file and sends the chosen answer".
  The tile test file 188 created gets "a content-only install shows the not-playable reason".

- **D7 — Fixture and the main install flow.** Extend `scripts/lib/fixture.mjs`:
  - In the fixture engines manifest served by `startBootstrapFixtureServer`, give the r1q2 and
    q2pro fixture packages `arch` (`x86` / `x86_64`).
  - Seed one r1q2 and one q2pro installation, each recording its fixture `packageId` in
    `moduleData['downloads']` (or reuse existing fixture installs if they already do).
  - In the fixture mods manifest (189's route), add a fixture entry `fixturemod` with an `x86`
    Windows library variant (zip with `gamex86.dll` + `pak0.pak`, built with the vendored 7za like
    the other fixture archives) whose `url` returns 404 and whose `mirrors[0]` serves the file. Add a
    content-only variant, and an entry `fixturebad` whose package is served with bytes that do not
    match its SHA256.
  - Expose `modsFixtureFiles` (expected bytes per path).
  New `scripts/flows/mods-install.mjs` (mirror `scripts/flows/engine-update.mjs`'s offline
  plumbing: `Q2L_UI_CONTENT_REPO_BASE`, the request log). On the r1q2 install: click
  `mods-install-fixturemod`, see the job on the tile and in the Downloads tab (`downloads-job-*`),
  wait for *installed*, then assert:
  - the files exist under `<root>/fixturemod/` and `gamex86.dll` equals the x86 variant's bytes;
  - the request log shows the 404 source followed by the mirror;
  - the action bar's gamedir picker lists `fixturemod`;
  - `state.json`'s installation `moduleData.mods.records[0]` lists every file with size+SHA256 plus
    catalogId, version and variantId.

- **D8 — The remaining four flows** (same fixture, each its own file):
  - `scripts/flows/mods-install-content-only.mjs`: on the q2pro 64-bit install, `fixturemod` has no
    `x86_64` library, so after install `<root>/fixturemod/pak0.pak` exists, no `gamex86.dll` exists,
    and the tile and detail show "Not playable locally with Q2PRO 64-bit: no matching build".
  - `scripts/flows/mods-install-refused.mjs`: installing `fixturebad` ends with a failed job whose
    visible reason is the verification error, no `<root>/fixturebad/` exists, and no record exists.
  - `scripts/flows/mods-install-waits.mjs`: with `dev:simulateLaunch` running (mirror
    `scripts/flows/job-waits-for-running-game.mjs`), the job shows the waiting reason on the tile
    and in `downloads-job-waiting-<id>`, and no gamedir exists yet. After `idle`, the files appear
    and the tile shows *installed*.
  - `scripts/flows/mods-install-over-manual.mjs`: seed `<root>/fixturemod/pak0.pak` with other
    bytes as a manual gamedir. Install → `mods-install-decision` names the folder and lists
    `pak0.pak` → Cancel → folder bytes unchanged, no record. Install again → Keep → `pak0.pak`
    unchanged, `gamex86.dll` written, and the record does not list `pak0.pak`.

## Model Hints

- D4 → deliverable-hard: this is the first job that writes into a gamedir the user may already own,
  and its order is the acceptance. That means staging every package before the first write,
  recording only the files actually written (never kept or identical ones, or 191 deletes user
  files), and restoring overwritten files on a failed write.
- Review: → story-review-hard. The plausible wrong implementation records the variant's full file
  list instead of the files actually written: every flow and a default review pass, but 191's
  Remove then deletes the user's kept `pak0.pak`. Or it extracts package 1 into the gamedir before
  package 2 has verified. Both are negative behaviours that only a reading of the order catches.

## Acceptance Tests

- AC1 → e2e `scripts/flows/mods-install.mjs` › "mods-install" (job visible on the tile and in the
  Downloads tab)
- AC2 → e2e `scripts/flows/mods-install.mjs` › "mods-install" (files under `<root>/fixturemod/`,
  tile *installed*)
- AC3 → e2e `scripts/flows/mods-install.mjs` › "mods-install" (r1q2 gets the x86 `gamex86.dll`)
  + unit `src/main/modules/mods/engine-target.test.ts` › "r1q2 on Windows selects the x86 library
  variant"
- AC4 → e2e `scripts/flows/mods-install-content-only.mjs` › "mods-install-content-only" + unit
  `src/main/modules/mods/engine-target.test.ts` › "an x86-only mod for a 64-bit Q2PRO selects
  content-only"
- AC5 → e2e `scripts/flows/mods-install-refused.mjs` › "mods-install-refused" + unit
  `src/main/modules/downloads/stage-package.test.ts` › "a size or SHA256 mismatch never extracts"
  + unit `src/main/modules/mods/install-job.test.ts` › "a second package failing leaves the gamedir
  untouched"
- AC6 → e2e `scripts/flows/mods-install.mjs` › "mods-install" (request log: source 404, then
  mirror) + unit `src/main/modules/downloads/stage-package.test.ts` › "a failing url falls back to
  the mirror"
- AC7 → e2e `scripts/flows/mods-install-waits.mjs` › "mods-install-waits" + unit
  `src/main/modules/mods/install-job.test.ts` › "the write runs inside runWrite"
- AC8 → e2e `scripts/flows/mods-install.mjs` › "mods-install" (action bar gamedir picker lists
  `fixturemod`)
- AC9 → e2e `scripts/flows/mods-install.mjs` › "mods-install" (`state.json` record) + unit
  `src/main/modules/mods/install-job.test.ts` › "the record lists every written file with size and
  hash"
- AC10 → e2e `scripts/flows/mods-install-over-manual.mjs` › "mods-install-over-manual" + unit
  `src/main/modules/mods/install-job.test.ts` › "cancel at the decision writes nothing"

Coverage: AC1/AC2/AC8 → D4+D6+D7. AC3 → D1+D7. AC4 → D1+D6+D8. AC5 → D3+D4+D8. AC6 → D3+D7.
AC7 → D4+D8. AC9 → D2+D4+D7. AC10 → D4+D5+D6+D8. The e2e flows sit in D7/D8 because the user path
only exists once D6 lands. Every behaviour D also carries its own unit tests.

## Done

Install of a catalog mod is real: engine target + variant selection (`engine-target.ts`, manifest `arch`, `readBinaryArch`), install record + `setModuleData`, package stager in downloads, `startModInstall` (stage all, plan, decision, guarded write with backup/restore, record of written files only), `install`/`resolveInstall` handlers + `installDecision` event + `activeInstalls`, renderer Install/progress/decision dialog/reasons, fixture + five `ui:flow`s.

Commit message: `190: install a catalog mod — engine target, stager, install job + record, decision dialog, flows`

Verification (narrow gate, run twice: after build and after review fixes): `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (197 files / 2756 tests), `ui:flow` mods-install, -content-only, -refused, -waits, -over-manual (+ mods-catalog/-view/-detail) each after `ui:seed`: all green. Full gate not run (sprint's). AC -> test: AC1-AC10 all mapped tests ran and passed as listed; no manual residue. Review: stage 1 PASS (3 fixed: unknown arch recorded as x86, concurrent same-gamedir installs, aria role=status), stage 2 hard PASS (3 fixed: re-check destination inside the write, record paths validated, NUL byte in slot key).

Decisions:
- Seam 1: install renames a top-level suffixed game library (`gamex86-opentdm-r388~add8f3c.dll` -> `gamex86.dll`, `gamex86_64-….so` -> `gamex86_64.so`), `placedGameLibraryName` in `install-job.ts`; no manifest schema change.
- Seam 2: records carry optional `pkzUnsupported` (r1q2 + a written `.pkz`); tile/detail show visible `mods.reason.pkzNeedsQ2pro`.
- Seam 3: a `from` that is a single file lands at `<gamedir>/<basename>`.
- Seam 4: inspector `isGameDir` needs a top-level `.pak/.pkz/.pk3`, `game(x86|x86_64).dll` or any `.so`; a pak-only content install passes (tested with the real inspector). A content-only package with only nested files would not be listed (no catalog entry has that shape; job logs a warning).
- Record field is `gameDir` (188's name); arch may be `unknown` (no bitness in the UI text); `variantId` = `<platform>-<arch>` or `content-only`. Detail Install testid is `mods-detail-install-<catalogId>`.
- AC5 visible reason: the fetcher folds a bad-SHA mirror into `downloads.error.allMirrorsFailed`; the flow asserts that text (failed jobs are not listed on the Downloads tab, flow asserts via `jobs:list`).
- Unfixed, documented: Keep/all-identical still saves a record with `files: []` (194 must not treat it as launcher-owned content); `setModuleData` disk write is debounced (crash window: files without record); `recordedGameDirs` stays lenient (188 contract); shipped manifest has OpenTDM `contentOnly.packages: []`, so OpenTDM on 64-bit Q2PRO is refused `mods.error.noVariant` (manifest content, not code); AQtion's two `from` dirs into one gamedir are untested against duplicate paths.

Names later stories reuse: `readModsState`/`withRecord`/`recordedGameDirs`/`isSafeRecordedPath` (`install-records.ts`), `ModInstallRecord`/`ModGameDir`/`ModActiveInstall`/`ModInstallDecisionEvent`/`MODS_HANDLERS.install|resolveInstall`/`MODS_EVENTS.installDecision` (`src/shared/modules/mods.ts`), `startModInstall` (job kind `mod-install`, label `mods.job.install`, wait `mods.job.waitingForDecision`), `resolveEngineTarget`/`selectVariant`, `stagePackage`/`resolveVendoredExtractor`, `InstallationsService.setModuleData`, renderer `installMod`/`resolveInstall`/`ModInstallState`/`InstallDecisionDialog`, fixture `writeModsInstallFixture`/`modsFixtureFiles`, `scripts/lib/mods-install-flow.mjs`.

tiers: D 8 / hard 1 · review default+hard · cycles 2 · agents 14
