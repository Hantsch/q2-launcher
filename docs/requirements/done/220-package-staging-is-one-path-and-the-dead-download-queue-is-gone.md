---
id: 220
title: package staging is one path and the dead download queue is gone
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want the Downloads settings to do what they say — or to say visibly that they do
nothing yet — and a bleeding-edge engine download to be as robust (stall timeout, retry, size
cap) as a pinned one. As the maintainer I want download → verify → extract to be one routine and
the content manifest to be read by one service, so that a staging fix is applied once and two
modules stop writing the same cache file.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F12, F13, F43, F45):

- `startDownload(app, source)` is the only caller of `pipeline.start()` and has zero callers in
  main; `createPipelineFor` still runs at setup; `concurrentJobs` is consumed only by the dead
  `queue.ts` and `downloadWhilePlayingAllowed` by nothing — yet the Settings UI shows both as
  live controls and docs/systems/install-module.md §9 promises parallelism and pause/resume.
  ~450 lines plus 711 lines of tests maintain a path nothing runs.
- `stage-package.ts` (story 190) describes itself as "the download/extract section of
  engine/update-job.ts without the job", yet bootstrap, repair and engine update still inline
  their own fetch → `markVerified` → extract → list sequences. `downloadUnpinnedAsset` (~85
  lines) is a second streaming downloader beside `fetcher.ts` (534 lines of retries, stall timer,
  size-overrun, sha256) with none of that hardening. `clamp01` x2, `removeDir` x2, `hashFile`
  duplicated, three recursive listers.
- `new ManifestService` is constructed in downloads and again in mods, each with its own memory,
  freshness window and `JsonStore` on the same `manifest-cache.json`; `CatalogService` mirrors it
  almost line for line.
- `bootstrap/job.ts` step 8 re-runs `assembleInstallation({ includeVideoAndPlayers: true })`,
  re-planning and re-copying every core file written in step 6 (roadmap follow-up since S19).

## Acceptance Criteria

- [x] **AC1** — `pipeline.ts`, `queue.ts`, their tests, `startDownload` and the `createPipelineFor`
      call are deleted (`getExtractDir` moves to staging); `concurrentJobs` and
      `downloadWhilePlayingAllowed` controls stay visible in Settings but disabled with a visible
      i18n reason ("Not available yet: downloads run one at a time") per the platform-parity
      rule, or are removed together with their persisted fields via a migration — decision
      recorded; install-module.md §9 matches.
- [x] **AC2** — bootstrap, repair and engine update stage through `stagePackage` (extended with
      `onProgress` and `verify: 'sha256' | { sizeOnly: true }`); `downloadUnpinnedAsset` is
      deleted and the unpinned branch goes through `downloadPackage` in size-only mode, so stall
      timer, retry/mirror loop and size-overrun abort apply; a test proves a stalled unpinned
      download times out.
- [x] **AC3** — `clamp01`, `removeDir`, `hashFile` live once in `src/main/lib/`; the three
      recursive listers are one (`fs-utils`, with story 199).
- [x] **AC4** — One `ManifestService` lives on `AppContext` (or a `content` service) and is
      injected into downloads and mods; a generic `CachedContentDocument<T>` in
      `src/main/lib/content-repo.ts` carries path, freshness, `cacheVersion` and envelope
      validation, and both `ManifestService` and `CatalogService` are thin wrappers over it.
- [x] **AC5** — `assembleInstallation`/`buildAssemblePlan` take `scope: 'core' | 'extras'`;
      `assemble.test.ts` asserts the two plans are disjoint; the bootstrap flow records each file
      once.
- [x] **AC6** — Every downloads/mods unit test and flow (bootstrap, repair, engine update, mod
      install/update) passes; `index.test.ts` asserts every exported job starter is reachable
      from a handler.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — Disable-with-reason or remove the two settings? Removing needs a migration step
  and drops a documented promise; disabling keeps the option to make the queue real later.
  Recommendation: disable with reason now.

## Decisions (Sprint)

- **(User)** queue settings: Disable with a visible i18n reason; no removal/migration.
- **Persisted fields stay live in main**: `concurrentJobs`/`downloadWhilePlayingAllowed` keep their
  schema, defaults and patch validation unchanged; only the renderer disables them — the user
  decision rules out a migration, and keeping the patch path lets the queue become real later.
- **Reason placement**: the same i18n key (`module.downloads.settings.queueUnavailable`, text "Not
  available yet: downloads run one at a time") is rendered as visible text under _each_ of the two
  disabled controls and wired via `aria-describedby` — the platform-parity rule wants the reason on
  the control, not once for the section.
- **Pipeline-only types move with `getExtractDir`**: `DownloadFn`/`ExtractFn` (used by
  `bootstrap/ports.ts`) move into the staging file with `getExtractDir`; `JobsHost`, `PipelineLog`,
  `DOWNLOAD_JOB_*` and the `downloads.job.download` i18n key go with the pipeline if nothing else
  uses them — dead code is deleted, not relocated.
- **Reachability test is static**: `index.test.ts` reads the downloads module sources and asserts
  every exported `start*` job starter is imported and called by `index.ts` — it is exactly the
  check that would have caught `startDownload`, without booting every handler.
- **`stagePackage` keeps its byte `onProgress` and gains `onExtractProgress(ratio)`**, an
  `extractDir` override and a failure `stage`/`reason`/download-attempt detail — mods' callers stay
  untouched, and bootstrap/repair/engine update keep their own staging paths and diagnostics.
- **Proof of "one staging path" is a layering test**: only the staging file (besides
  `extractor.ts`, which defines it) may call `markVerified(` — a static check no future inline
  sequence can slip past.
- **Size-only failure key is preserved**: a size-only download whose every attempt failed
  verification still ends as `downloads.error.bleedingEdgeSizeMismatch` in the engine update, so the
  user-visible message does not change.
- **The `.tar` second pass applies to every caller**: bootstrap, repair and engine update gain
  `stagePackage`'s two-layer `.tar.gz` handling — it only triggers on a lone `.tar`, so it cannot
  change a zip package's result.
- **Extras plan is the glob dirs**: `buildAssemblePlan({ scope: 'extras' })` returns the
  `GLOB_DIRS` (`baseq2/video`, `baseq2/players`) as plan entries and `scope: 'core'` the allowlist,
  `includeVideoAndPlayers` is removed from both inputs; callers that want both (retail copy) call
  twice — disjointness is then a real property, not a filter.
- **Helper homes**: `removeDir`/`hashFile`/`listFilesRecursive` go to `src/main/lib/fs-utils.ts`,
  `clamp01` to a new `src/main/lib/math.ts` — fs helpers belong with fs-utils, a number clamp does
  not.
- **`ManifestService` moves to the shell** (`src/main/services/content/`) and lives on
  `AppContext.content.manifest`, because the shell may not import a module (story 208's layer
  test); if story 209 already hoisted it, use that location. `CatalogService` stays in mods (only
  mods uses it) as a thin wrapper.
- **Stories 199/209 may land first** (sprint order): every D below names today's path and tells the
  implementer to grep for the symbol first; work already done by 199/209 is verified, not redone.
- **Changelog**: two lines — Changed (two Downloads settings say why they are disabled) and Fixed
  (bleeding-edge engine downloads now time out, retry and cap size) — both are user-visible.

## Plan

Order D1 → D8; one main-process layer per D except D2 (renderer + flow + doc).

1. **D1** delete the dead pipeline: `pipeline.ts`, `queue.ts`, their tests, `startDownload`,
   `createPipelineFor`; `getExtractDir` + `DownloadFn`/`ExtractFn` move into `stage-package.ts`;
   static reachability test for job starters.
2. **D2** Settings: concurrency + while-playing disabled with a visible reason; flow updated;
   install-module.md §9 rewritten; changelog line.
3. **D3** `downloadPackage` gets `verify: 'sha256' | { sizeOnly: true }`; `stagePackage` gets
   `verify`, `extractDir`, `onExtractProgress`, failure detail; engine update stages through it;
   `downloadUnpinnedAsset`/`downloadEngineArchive` deleted; stall test.
4. **D4** bootstrap + repair stage through `stagePackage`; layering test pins `markVerified` to the
   staging file.
5. **D5** `assembleInstallation`/`buildAssemblePlan` take `scope`; bootstrap step 8 copies only the
   extras; each file recorded once.
6. **D6** `clamp01`/`removeDir`/`hashFile`/one recursive lister in `src/main/lib/`.
7. **D7** `CachedContentDocument<T>` in `content-repo.ts`; `ManifestService`/`CatalogService` wrap it.
8. **D8** one `ManifestService` on `AppContext.content`, injected into downloads and mods.

Affected: `src/main/modules/downloads/**`, `src/main/modules/mods/{index,install-job,update-job,
remove,catalog-service}.ts`, `src/main/lib/{fs-utils,math,content-repo}.ts`, `src/main/context.ts`,
`src/renderer/src/modules/downloads/DownloadsSettingsSection.tsx`, `en.json`,
`scripts/flows/settings-downloads-section.mjs`, `docs/systems/install-module.md`, `CHANGELOG.md`.

## Deliverables

- **D1 — the dead download pipeline is gone.** Delete `src/main/modules/downloads/pipeline.ts`,
  `queue.ts`, `pipeline.test.ts`, `queue.test.ts`; in `src/main/modules/downloads/index.ts` delete
  `startDownload`, `createPipelineFor`, the `pipelines` WeakMap, the setup-time
  `createPipelineFor(app, log)` call and the doc comments that describe them. Move `getExtractDir`
  (with its `SAFE_JOB_ID` guard and `EXTRACT_SEGMENT`) and the `DownloadFn`/`ExtractFn` types into
  `src/main/modules/downloads/stage-package.ts` (grep `export async function stagePackage` first —
  story 209 may have moved it; use its current home). Re-point importers: `bootstrap/job.ts`,
  `bootstrap/ports.ts`, `engine/update-job.ts`, `stage-package.ts`, `mods/install-job.ts`,
  `mods/update-job.ts` and their tests. Delete `JobsHost`, `PipelineLog`, `DOWNLOAD_JOB_KIND`,
  `DOWNLOAD_JOB_LABEL_KEY` and the `downloads.job.download` en.json key if nothing else references
  them (grep). Do not touch the `concurrentJobs`/`downloadWhilePlayingAllowed` schema or patch
  handler. Test in `src/main/modules/downloads/index.test.ts`: "every exported job starter is
  reachable from a handler" — walks the module's non-test `.ts` files, collects exported functions
  named `start[A-Z]*`, and asserts `index.ts` imports and calls each; plus "the dead download
  pipeline is gone" — `pipeline.ts`/`queue.ts` do not exist.
- **D2 — two Downloads settings say why they do nothing.** In
  `src/renderer/src/modules/downloads/DownloadsSettingsSection.tsx` the concurrency `Select` and the
  download-while-playing `Switch` are always `disabled`, still show the persisted value, and each
  has a visible `<p>` under it with `t('module.downloads.settings.queueUnavailable')` (testids
  `downloads-settings-concurrency-reason` / `downloads-settings-while-playing-reason`), linked via
  `aria-describedby` (mirror the reason text pattern in
  `src/renderer/src/modules/config/components/AutorecordSetting.tsx`). Add the key to
  `src/renderer/src/i18n/locales/en.json`: "Not available yet: downloads run one at a time". The
  cache budget and clear-cache controls stay live. Update
  `DownloadsSettingsSection.test.tsx` › "concurrency and download-while-playing are disabled and
  show the reason"; update `scripts/flows/settings-downloads-section.mjs`: drop the change/revert
  steps for those two controls, add step "concurrency and download-while-playing are disabled and
  say why" (asserts `disabled` and the visible reason text), keep the cache-budget steps. Rewrite
  `docs/systems/install-module.md` §9: downloads run one at a time, no pause/resume, the two
  settings are shown disabled with that reason. Fix the stale `concurrentJobs` comment in
  `DownloadsView.tsx:91`. `CHANGELOG.md` under `## Unreleased` → `### Changed`: one line, e.g.
  "Downloads settings now say which options are not available yet."
- **D3 — a bleeding-edge download is as hardened as a pinned one.** In
  `src/main/modules/downloads/fetcher.ts` add `verify?: 'sha256' | { sizeOnly: true }` to
  `DownloadPackageOptions` (default `'sha256'`); in size-only mode the source may omit `sha256`,
  and verification (`verify.ts`'s `verifyAndPromote`) checks size only — stall timer, retry/mirror
  loop and size-overrun abort run unchanged. Extend `stagePackage` (`stage-package.ts`): input
  `verify` (forwarded), `extractDir?` (overrides the `<jobId>-<index>` default),
  `onExtractProgress?: (ratio: number | null) => void` (forwarded to the extractor's `onProgress`);
  failure result gains `stage: 'download' | 'prepare' | 'extract'`, `reason: string` and, for
  download failures, `attempts` + last `url`; success gains `url` and `sizeBytes`. Use
  `asExtractionErrorKey` from `bootstrap/errors.ts` instead of its local `asErrorKey`. Keep the
  existing byte `onProgress` signature (mods calls it). In `engine/update-job.ts` replace the
  download + mkdir + extract block of `runUpdate` with one `stagePackage` call (`extractDir:
getExtractDir(userDataPath, jobId)`, `verify: target.sha256 ? 'sha256' : { sizeOnly: true }`,
  `download`/`extract` from deps, `onExtractor: setExtractor`); delete `downloadEngineArchive`,
  `downloadUnpinnedAsset` and the `EngineArchiveDownload*` types — `EngineUpdateDeps.download`
  becomes a `downloadPackage`-shaped seam; a size-only failure whose every attempt is
  `verification-failed` maps to `downloads.error.bleedingEdgeSizeMismatch`. Adapt
  `src/main/modules/downloads/index.ts`'s `engineUpdateDepsFor` and `engine/update-job.test.ts`.
  Tests: `fetcher.test.ts` › "a size-only download that stalls fails on the stall timeout and leaves
  no file" (reuse `stallsAfter`) and › "a size-only download accepts any hash and refuses a wrong
  size"; `engine/update-job.test.ts` › "a bleeding-edge update downloads through downloadPackage in
  size-only mode"; `stage-package.test.ts` › "a failed extraction reports stage extract with the
  download's url". One line in `install-module.md` §10 that bleeding edge uses the same downloader
  with a size-only check. `CHANGELOG.md` `### Fixed`: "Bleeding-edge engine downloads now time out,
  retry and refuse oversized files."
- **D4 — bootstrap and repair stage through `stagePackage`.** In
  `src/main/modules/downloads/bootstrap/job.ts` (package loop, ~lines 1240–1380) replace the
  `deps.fetcher.fetch` → `mkdir` → `deps.extractor.extract({ archive: markVerified(...) })`
  sequence with one `stagePackage` call: `download: deps.fetcher.fetch`, `extract:
deps.extractor.extract`, `extractDir: getBootstrapExtractDir(...)`, `resolveExtractor`,
  `onExtractor: (h) => { extractor = h }`, byte `onProgress` and `onExtractProgress` mapped to the
  same `packagesProgress(...)` ratios as today. Each of today's exits stays: cancel → cancelled
  outcome (check `cancelled` before reading the result), `stage: 'download'` → `recordPackage(last
attempt url ?? pkg.url, pkg.sizeBytes, false, false)`, `stage: 'prepare'`/`'extract'` →
  `recordPackage(url, sizeBytes, true, false)`, success → `listExtraction` + `recordPackage(...,
true, true, listing)`; failure keys and reason strings unchanged. Same in
  `src/main/modules/downloads/repair/job.ts` (loop ~lines 418–476, `onExtractor: setExtractor`).
  Drop the now-unused `markVerified`/`mkdir` imports. Existing `bootstrap/job.test.ts` and
  `repair/job.test.ts` must pass with at most mechanical fixture changes (they inject
  `fetcher`/`extractor` ports, which stay). Test in `src/main/layering.test.ts` ›
  "only the staging routine calls markVerified" — walks `src/main` non-test files; the only files
  containing `markVerified(` are `extractor.ts` and the staging file.
- **D5 — the extras pass copies only the extras.** In
  `src/main/modules/downloads/bootstrap/assemble.ts` replace `includeVideoAndPlayers` in
  `BuildAssemblePlanInput` and `AssembleInstallationInput` with `scope: 'core' | 'extras'`: `core`
  plans and copies the allowlist (today's entries), `extras` plans and copies only `GLOB_DIRS` (as
  plan entries with `from`/`to`), never an allowlist file. Update callers: `bootstrap/job.ts` step 6
  (`scope: 'core'`) and step 8 (`scope: 'extras'`, still only when the toggle is on), delete the doc
  comment about recording entries twice; `bootstrap/retail-source.ts` `copyRetailGameData` calls
  core, then extras when its own `includeVideoAndPlayers` is on, concatenating results;
  `repair/job.ts` and `engine/update-job.ts` (`buildAssemblePlan`) use `scope: 'core'`. Tests:
  `bootstrap/assemble.test.ts` › "core and extras plans are disjoint" (for every engine and data
  source: no extras `to` equals or prefixes a core `to`, and vice versa);
  `bootstrap/job.test.ts` › "a run with the extras on records each file once" (assembly entries'
  `to` values and `copiedFiles` are unique).
- **D6 — shared helpers live once in `src/main/lib/`.** New `src/main/lib/math.ts` exporting
  `clamp01` (from `bootstrap/job.ts:720`, `engine/update-job.ts:828`); in
  `src/main/lib/fs-utils.ts` add `removeDir(dir, log?)` (best-effort, from `bootstrap/job.ts:753`),
  `hashFile(path)` → `{ sha256, sizeBytes }` (from `mods/install-job.ts:206`; `mods/remove.ts`'s
  `sha256Of` uses it too) and `listFilesRecursive(dir)` → `{ rel, abs, isFile }[]` with
  forward-slash `rel`, replacing `engine/rollback-job.ts:346` `listFilesRecursive` and
  `mods/install-job.ts:219` `collectFiles` (each keeps its own policy: rollback skips nothing and
  tolerates a missing dir, mods returns `null` on a non-file). Grep for a third recursive
  `readdir`/walk (the review counted three) and fold it in; if story 199 already put a lister in
  fs-utils, use it instead of adding one. Tests in `src/main/lib/fs-utils.test.ts` ›
  "listFilesRecursive lists nested files with forward slashes" and › "hashFile returns sha256 and
  size", and a `src/main/lib/math.test.ts` › "clamp01 clamps and maps NaN to 0"; plus a test in
  `src/main/layering.test.ts` › "clamp01, removeDir and hashFile are defined only
  in src/main/lib" (no `function clamp01|removeDir|hashFile` outside `src/main/lib`).
- **D7 — one cached-document routine behind both content services.** In
  `src/main/lib/content-repo.ts` add `CachedContentDocument<T>`: constructor `{ filePath, freshnessMs,
cacheVersion, schema (zod for T), log, fetch: () => Promise<T> }`; `get({ refresh })` answers a
  fresh in-memory value (only a live fetch in this process counts as fresh), else a live fetch
  persisted through `JsonStore` as `{ cacheVersion, fetchedAt, data }`, else the persisted cache
  (`fromCache: true`), else unavailable; a wrong `cacheVersion` or failed envelope parse discards
  the cache with a warning. Rewrite `src/main/modules/downloads/manifest-service.ts` and
  `src/main/modules/mods/catalog-service.ts` as thin wrappers over it (their public API, file paths
  and cache shapes unchanged). Tests: `src/main/lib/content-repo.test.ts` › "a cache read off disk
  is never fresh", › "a cacheVersion mismatch discards the cache"; existing
  `manifest-service.test.ts` and `catalog-service.test.ts` pass unchanged.
- **D8 — one `ManifestService` per app.** Move `ManifestService` (+ `manifest-parse.ts` and the
  schemas/`DownloadSource` it needs) to `src/main/services/content/` unless story 209 already
  hoisted them — grep `class ManifestService`; fix importers (`bootstrap/ports.ts`, `cache.ts`,
  `index.ts`, `mods/index.ts`, tests). Add `content: { manifest: ManifestService }` to
  `AppContext` in `src/main/context.ts`, constructed once with the resolved download source (the
  harness gate as context.ts/story 209 resolves it). `downloads/index.ts` and `mods/index.ts` use
  `app.content.manifest` and no longer call `new ManifestService`. Extend the shared fake app
  context in `src/test-support/` with `content`. Test in `src/main/modules/mods/index.test.ts` ›
  "mods reads the app's one ManifestService" (the fake context's instance is the one used) and in
  `src/main/layering.test.ts` › "new ManifestService appears only in context.ts".

## Model Hints

- D4 → deliverable-hard: bootstrap's package loop has four distinct exits that each write a
  different diagnostics record and must check `cancelled` before the result, and the extractor
  handle must reach `onCancel` with no `await` in between — collapsing them into one
  `stagePackage` call can silently regress a bug-report record or a cancel race that the 2784-line
  test only partially pins.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/downloads/index.test.ts` › "the dead download pipeline is gone"
- AC1 → unit `src/renderer/src/modules/downloads/DownloadsSettingsSection.test.tsx` › "concurrency
  and download-while-playing are disabled and show the reason"
- AC1 → e2e `scripts/flows/settings-downloads-section.mjs` › "concurrency and
  download-while-playing are disabled and say why" (run: `npm run ui:flow --
settings-downloads-section`); §9 doc match checked by the default review against D2's text.
- AC2 → unit `src/main/modules/downloads/fetcher.test.ts` › "a size-only download that stalls fails
  on the stall timeout and leaves no file"
- AC2 → unit `src/main/modules/downloads/fetcher.test.ts` › "a size-only download accepts any hash
  and refuses a wrong size"
- AC2 → unit `src/main/modules/downloads/engine/update-job.test.ts` › "a bleeding-edge update
  downloads through downloadPackage in size-only mode"
- AC2 → unit `src/main/layering.test.ts` › "only the staging routine calls
  markVerified"
- AC2 → unit `src/main/modules/downloads/stage-package.test.ts` › "a failed extraction reports
  stage extract with the download's url"
- AC3 → unit `src/main/layering.test.ts` › "clamp01, removeDir and hashFile are
  defined only in src/main/lib"
- AC3 → unit `src/main/lib/fs-utils.test.ts` › "listFilesRecursive lists nested files with forward
  slashes"; › "hashFile returns sha256 and size"; `src/main/lib/math.test.ts` › "clamp01 clamps and
  maps NaN to 0"
- AC4 → unit `src/main/lib/content-repo.test.ts` › "a cache read off disk is never fresh"; › "a
  cacheVersion mismatch discards the cache"
- AC4 → unit `src/main/modules/mods/index.test.ts` › "mods reads the app's one ManifestService";
  `src/main/layering.test.ts` › "new ManifestService appears only in context.ts"
- AC5 → unit `src/main/modules/downloads/bootstrap/assemble.test.ts` › "core and extras plans are
  disjoint"
- AC5 → unit `src/main/modules/downloads/bootstrap/job.test.ts` › "a run with the extras on records
  each file once"
- AC6 → unit `src/main/modules/downloads/index.test.ts` › "every exported job starter is reachable
  from a handler"
- AC6 → unit `npx vitest run src/main/modules/downloads src/main/modules/mods` (whole suites green)
- AC6 → e2e `scripts/flows/bootstrap-wizard.mjs`, `bootstrap-r1q2.mjs`, `bootstrap-failure.mjs`,
  `bootstrap-incomplete-package.mjs`, `repair.mjs`, `engine-update.mjs`, `mods-install.mjs`,
  `mod-update.mjs` (run: `npm run ui:flow -- bootstrap-wizard` etc.) — each flow green as a whole.

## Done

Dead download pipeline/queue and `startDownload` deleted; bootstrap, repair and engine update stage through one `stagePackage` (bleeding-edge now via `downloadPackage` size-only: stall timer, retry, size cap); `clamp01`/`removeDir`/`hashFile`/`listFilesRecursive` live once in `lib`; one `ManifestService` on `AppContext.content`, `ManifestService`/`CatalogService` wrap `CachedContentDocument`; assemble takes `scope: 'core' | 'extras'`; the two queue settings are shown disabled with a visible reason.

Commit message: `220: one package-staging path, dead download queue removed, bleeding-edge downloads hardened, one ManifestService, assemble scope core/extras`

Verification (narrow gate: `npx vitest run --changed HEAD` 2690 passed; src/main 3179 passed; build, typecheck, lint green; `npm run ui:flow -- <name>`): green flows settings-downloads-section (after `npm run ui:seed`), bootstrap-r1q2, bootstrap-failure, bootstrap-incomplete-package, repair, engine-update, mods-install, mod-update, downloads-tab. Every AC maps to its named test (all ran and passed; the apostrophe-less name "...with the download url" is the real package-staging test title). Review: default tier, PASS; findings fixed (starter-reachability regex, layering const/let, stale comments/doc, staging cancel + sync-handle tests), second review over the fix PASS with minor notes (one stale comment fixed).
- Pre-existing, not caused here: `bootstrap-wizard` red on bare HEAD (verified in a HEAD worktree: Program Files warning never appears at step AC2). `settings-downloads-section`/`downloads-tab` "N archives" mismatch is a polluted `.ui-verify` fixture cache (count varies with earlier flow runs); green after `npm run ui:seed`.
- Decisions: queue settings disabled with reason, no migration (User); `CachedContentDocument` cache file stays flat `{cacheVersion, fetchedAt, ...body}` (existing cache shape and tests); job-level extras test asserts unique assembly `to` values (`copiedFiles` is not exposed at job level); bleeding-edge transport failure now ends `allMirrorsFailed` (was `network`), as pinned downloads; bootstrap/repair/engine gain the lone-`.tar` second pass; `Switch` got an optional `describedBy`; `downloads.job.download` key removed, fixtures use `downloads.job.bootstrap`; persistence labels `downloads-manifest`/`mods-manifest` became `content-manifest`; historical install-module.md rows annotated "superseded".
- Manual residue: none.

tiers: D 8 / hard 1 · review default · cycles 1 · agents 13
