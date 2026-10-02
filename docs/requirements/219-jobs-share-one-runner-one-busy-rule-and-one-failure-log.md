---
id: 219
title: jobs share one runner, one busy rule and one failure log
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want two jobs never to write into the same installation at once, the Library to show
the real state of an installation after a job failed half-way, and a failed mod install to be
explained in the Downloads failure log like a failed engine update. As the maintainer I want the
job lifecycle — cancel wiring, settled promise, local-failure catch, write-guard mapping,
revalidation — to exist once, so that a lifecycle fix is one change instead of nine.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F11, F44, F55, F46):
`JobsService` (227 lines) offers create/progress/finish/cancel; every one of nine job files
re-implements `new AbortController()` + `onCancel`, the `settled = (async () => { try … catch { finish LOCAL_FAILURE } })()`
IIFE, four identical closures (`isCancelled`/`report`/`failed`/`cancelledOutcome`, line-for-line
in `engine/update-job.ts` and `repair/job.ts`), the `writePhase[0]` + `isWriteCancelled` trick,
26 `jobs.finish(` calls, three `LOCAL_FAILURE` constants and 34 `*Host|*Deps` interfaces of which
six `*WriteGuardHost` are byte-identical. Admission control sees one module: `mods/update-job.ts`
checks only `moduleId === 'mods'`, downloads never reads `jobs.list()`, and `write-guard.ts`
says "nothing stops two jobs from targeting one installation". The stale-status bug the roadmap
tracks for two jobs (write phase fails → `installations.validate()` only on the success path) is
in six. Mods jobs keep three process-global `inFlight` registries with string-literal busy kinds
and an install that ignores a running update. `observeFailedJobs` skips every job whose
`moduleId !== 'downloads'`, so a failed mod job never reaches the failure log or diagnostics;
`missingChecks` are stored without params so `{{path}}` renders literally.

Depends on story 220 (staging) landing first so the runner wraps the final staging shape.

## Acceptance Criteria

- [ ] **AC1** — `src/main/services/job-runner.ts` (or `JobsService.run`) takes
      `spec = { moduleId, kind, labelKey, installationId?, exclusive?: 'installation' }` and a
      `body(ctx)` where `ctx` provides `jobId`, `signal`, `report`, `fail`, `cancelled`,
      `write(installationId, fn)` and `setExtractor`; it owns the AbortController, settled
      promise, local-failure catch and write-guard cancel mapping; one `JobOutcome<K>` type and
      one set of host interfaces are exported from `src/main/modules/ports.ts`. Unit tests cover
      success, local failure, cancel before write, cancel during write.
- [ ] **AC2** — With `exclusive: 'installation'`, starting a job while any active job of any
      module targets the same installation refuses with `jobs.error.installationBusy` (i18n key,
      visible in the dialogs); a test starts a mod update and asserts a mod install and an engine
      update are refused.
- [ ] **AC3** — The runner revalidates the installation in a `finally` once the write phase was
      entered, before `jobs.finish`; one shared test "a failing write still revalidates"; the
      two roadmap follow-up lines are removed.
- [ ] **AC4** — All nine jobs run on the runner; `git grep -n 'LOCAL_FAILURE =\|new AbortController' src/main/modules`
      returns only the runner; the mods `inFlight` sets and `BUSY_KINDS` literals are deleted.
- [ ] **AC5** — The failure log and diagnostics record jobs of every `moduleId` (Downloads tab
      filters by module if needed); `missingChecks` carry `params` (paths reduced to basename per
      story 075); a renderer test renders each `validation.*` key with params and finds no `{{`.
- [ ] **AC6** — docs/ARCHITECTURE.md's Jobs paragraph describes the runner and the exclusivity
      rule (and no longer says "No module produces jobs yet"); every downloads and mods flow
      passes.

## Open Questions

- [x] **Q1** — Migrate all nine jobs in one story or runner + three (rollback, mods remove,
      download) here and the rest one per sprint as the judge suggests? Decide by diff size at
      refine. → decided at refine: all of them, see D-S1.

## Decisions (Sprint)

- **D-S1 (Q1)** — All job starters move onto the runner in this story: the eight in
  `src/main/modules` (bootstrap, engine update, engine rollback, repair, retail upgrade, mods
  install/update/remove) plus `dev:simulateJob`; the ninth, `pipeline.ts`, is deleted by 220. Reason:
  AC2's cross-module refusal only holds when every writing job admits through the runner (the
  "runner + three" cut leaves engine update and mods install/update outside it, which is exactly
  F11's gap), and each migration is a mechanical ≤4-file D with one hard D for the runner itself.
- **D-S2** — The runner is a standalone `src/main/services/job-runner.ts` (`JobRunner`, on
  `AppContext` as `jobRunner`), not a method on `JobsService`. Reason: it needs `writeGuard` and
  `installations`, and `JobsService` is constructed before both (`context.ts`); keeping
  `JobsService` a registry avoids a construction cycle.
- **D-S3** — The body returns a `JobOutcome` and the runner calls `jobs.finish` exactly once from
  it; jobs never call `jobs.finish` themselves. Reason: AC4's "lifecycle exists once" — 26 finish
  calls collapse to one, and the runner can skip `finish` when `jobs.cancel()` already ended the job
  (`JobsService.finish` would otherwise overwrite `cancelled`).
- **D-S4** — `JobOutcome<K extends string = string, S extends object = {}>` is
  `({status:'succeeded'} & S) | {status:'failed'; key: K; params?} | {status:'cancelled'}`; each job's
  existing outcome type becomes an alias of it. Reason: keeps every caller's `settled` typing intact
  while making the shape one type.
- **D-S5** — `ctx.write(installationId, fn)` resolves `'done' | 'cancelled'` (cancel-before-write and
  cancel-during-write both map to `'cancelled'`); any other error propagates to the runner's
  local-failure catch. Reason: replaces the `writePhase[0]` + `isWriteCancelled` trick with one
  explicit value.
- **D-S6** — `ctx` additionally offers `revalidate(installationId)` (returns the
  `installations.validate` outcome) and `markPlayable(ratio)`; the runner's `finally` revalidates
  every installation passed to `ctx.write` unless the body already revalidated it after its last
  write, then finishes. Errors from that revalidation are logged, never change the outcome. Reason:
  remove/bootstrap/engine update read the validate result on success, and a second validate on the
  success path would double the disk walk.
- **D-S7** — The busy rule: `exclusive: 'installation'` refuses when _any_ active job
  (`isJobActive`, any `moduleId`, any kind) in `jobs.list()` carries the same `installationId`; the
  check and `jobs.create` run synchronously with no `await` between. `JobRunner.isInstallationBusy(id)`
  is exported for preview paths (mods update/remove previews). Reason: the job list becomes the only
  registry, so the three `inFlight` sets have nothing left to guard.
- **D-S8** — Every per-installation job (engine update/rollback, repair, retail upgrade, mods
  install/update/remove, `dev:simulateJob` `writing`) is `exclusive: 'installation'`; bootstrap is
  exclusive only when it targets an existing installation id. Reason: the requirement is "two jobs
  never write into one installation"; a bootstrap into a new folder has no installation yet.
- **D-S9** — A second start that previously answered `mods.error.alreadyInstalled` (same folder
  in flight) or `mods.remove.refused.busy` now answers `jobs.error.installationBusy`; the
  `already installed` refusal for a _recorded_ mod stays. Reason: one busy rule, one key; the old
  keys described the in-flight registries being deleted.
- **D-S10** — The Downloads failure log records failed jobs of every module with no module filter.
  Reason: entries already render their own `labelKey` ("Installing <mod>"), so the module is visible
  in the entry, and the AC makes the filter optional.
- **D-S11** — `missingChecks` entries gain an optional `params`, every string param value reduced
  to `path.basename` at the `recordTarget` call (bootstrap job) and the zod schema in
  `src/main/lib/schemas.ts` accepts `params` as `.optional().catch(undefined)`; old persisted entries
  parse unchanged. Reason: story 075's redaction boundary forbids full paths in the report, and the
  basename is what the user needs to recognise the folder.
- **D-S12** — "The two roadmap follow-up lines" are the `PACKAGE_INCOMPLETE` stale-status entry and
  the `missingChecks` unfilled-`{{path}}` entry in docs/ROADMAP.md. Reason: they are the two
  roadmap follow-ups this story's AC3 and AC5 close.
- **D-S13** — Builds after 220: the migrations wrap whatever staging shape 220 leaves
  (`stagePackage`) and must not re-touch staging. Reason: the requirement's own dependency note and
  the sprint order (220 → 219).

## Plan

Depends on 220 being built (pipeline.ts gone, staging unified).

1. **Runner (D1, hard).** `src/main/services/job-runner.ts` owns create + busy check, the
   `AbortController`/`onCancel` (+ extractor kill), the settled promise, the local-failure catch
   (`downloads.error.diskWrite` as the one `LOCAL_FAILURE`), `ctx.write` → `writeGuard.runWrite`
   with cancel mapping, revalidation in `finally`, and the single `jobs.finish`. Types and host
   interfaces in new `src/main/modules/ports.ts`. Wired on `AppContext.jobRunner`; test helper in
   `src/test-support/`.
2. **Migrate jobs (D2–D6)**, smallest first so the runner API is proven before bootstrap: rollback +
   mods remove → engine update + repair → retail upgrade → mods install + update (delete `inFlight`,
   `BUSY_KINDS`) → bootstrap. Each D swaps `jobs`+`writeGuard` deps for `runner: JobRunnerHost`,
   deletes its own closures/IIFE/`*WriteGuardHost`/`*JobsHost`, and keeps its existing test file
   green (adapted to the runner helper).
3. **Busy refusal on the real surface (D7):** `dev:simulateJob` `writing` goes through the runner;
   a new flow proves a held job makes mods install and engine update refuse visibly.
4. **Failure log (D8 main, D9 renderer):** `observeFailedJobs` drops the `downloads` filter; `missingChecks` carry
   basename params; `FailureCauseDetail` passes them to `t()`.
5. **Docs (D10):** ARCHITECTURE Jobs paragraph, install-module.md, roadmap lines, write-guard comment.

Order: D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8 → D9 → D10 (D8–D9 independent of D2–D7).

## Deliverables

- **D1 — the job runner** _(hard)_. New `src/main/services/job-runner.ts` exporting
  `class JobRunner` (constructed with `{ jobs: JobsService, writeGuard: InstallationWriteGuard,
installations: { validate(id): Promise<Outcome<Installation>> } }`) with
  `run<K, S>(spec, body): Outcome<{ jobId: string; settled: Promise<JobOutcome<K, S>> }>` and
  `isInstallationBusy(installationId): boolean`. `spec = { moduleId, kind, labelKey, labelParams?,
installationId?, playableAtRatio?, cancellable?, exclusive?: 'installation' }`. `run` is
  synchronous: with `exclusive` it refuses `fail('jobs.error.installationBusy')` (no job created)
  when any `isJobActive` job in `jobs.list()` of any module has that `installationId`; the check and
  `jobs.create` have no `await` between them. It creates one `AbortController`, `onCancel` aborts it
  and kills the handle registered via `ctx.setExtractor`. `body(ctx)` gets `ctx = { jobId, signal,
report(progress) /* no-op once aborted */, fail(key, reason, params?) /* logs reason, returns
{status:'failed', key, params} */, cancelled(), write(installationId, fn): Promise<'done' |
'cancelled'> /* writeGuard.runWrite; isWriteCancelled or aborted → 'cancelled', other errors
rethrow */, setExtractor(handle), markPlayable(ratio), revalidate(installationId) }`. A throw from
  `body` → `{status:'failed', key:'downloads.error.diskWrite'}` (the one `LOCAL_FAILURE`). In a
  `finally`: every installation passed to `ctx.write` whose write was entered (the guard's `fn`
  started, or the write threw after acquiring) and not revalidated by the body after its last write
  is revalidated via `installations.validate` (errors logged, outcome unchanged); then `jobs.finish`
  is called once from the outcome — skipped when the job is already terminal (cancelled by
  `jobs.cancel`). `settled` never rejects. New `src/main/modules/ports.ts` exports `JobOutcome<K
extends string = string, S extends object = {}>` (`({status:'succeeded'} & S) | {status:'failed';
key: K; params?: Record<string, string|number>} | {status:'cancelled'}`), `JobRunnerHost` (`run`,
  `isInstallationBusy`), `JobContext`, `RunJobSpec`, and the shared module host interfaces the jobs
  will need (`InstallationsHost` with `find`/`validate`/`setModuleData`, `ToastHost`, `JobLogHost`).
  Wire `jobRunner` into `AppContext` in `src/main/context.ts` after `writeGuard`. Add
  `jobs.error.installationBusy` ("Another job is changing this installation. Try again when it has
  finished.") under `jobs.error` in `src/renderer/src/i18n/locales/en.json`. New
  `src/test-support/job-runner.ts`: `makeJobRunner(overrides?)` returning `{ runner, jobs,
writeGuard, installations, launch }` built from real `JobsService` + `InstallationWriteGuard` with
  a controllable fake launch host and a spy `validate`. Tests in
  `src/main/services/job-runner.test.ts`: "a succeeding body finishes the job once as succeeded",
  "a throwing body finishes as local failure", "cancel before write never calls fn and settles
  cancelled", "cancel during write settles cancelled and does not overwrite the cancelled status",
  "a failing write still revalidates", "an exclusive job is refused while any module's job targets
  the installation", "a body that revalidated after its write is not revalidated again".
- **D2 — rollback and mods remove on the runner.** `src/main/modules/downloads/engine/rollback-job.ts`
  and `src/main/modules/mods/remove-job.ts` start through `deps.runner.run(spec, body)` (type
  `JobRunnerHost` from `src/main/modules/ports.ts`) with `exclusive: 'installation'`; delete their
  `new AbortController`, settled IIFE, local-failure catch, `failed`/`cancelledOutcome` closures,
  `phase[]`/`writePhase` arrays, every `jobs.finish(` call, `*WriteGuardHost`/`*JobsHost`
  interfaces, remove-job's `LOCAL_FAILURE`, `BUSY_KINDS` and `inFlight`; outcome types become
  `JobOutcome<…>` aliases. Body uses `ctx.write` (returns `'cancelled'` → `return ctx.cancelled()`),
  `ctx.fail`, `ctx.report`, and `ctx.revalidate` where it reads the validate result today; the
  remove preview uses `deps.runner.isInstallationBusy` and refuses with `jobs.error.installationBusy`.
  Update the callers' deps wiring in `src/main/modules/downloads/index.ts` / `src/main/modules/mods/index.ts`
  (pass `app.jobRunner`). Adapt `rollback-job.test.ts` and `remove-job.test.ts` to
  `makeJobRunner()` from `src/test-support/job-runner.ts`; assertions about outcomes stay; add
  remove-job test "a removal is refused while another job targets the installation".
- **D3 — engine update and repair on the runner.** Same migration as D2 for
  `src/main/modules/downloads/engine/update-job.ts` and `src/main/modules/downloads/repair/job.ts`
  (both carry the identical `isCancelled`/`report`/`failed`/`cancelledOutcome` closures — delete
  them in favour of `ctx`), `exclusive: 'installation'`, extractor via `ctx.setExtractor`, wiring in
  `src/main/modules/downloads/index.ts`; leave staging (`stagePackage`) calls as 220 left them.
  Adapt `update-job.test.ts` and `repair/job.test.ts` to `makeJobRunner()`; add to repair's test
  "a repair whose write fails leaves the installation revalidated" (the 093 roadmap case).
- **D4 — retail upgrade on the runner.** Same migration for
  `src/main/modules/downloads/retail/upgrade-job.ts` (`exclusive: 'installation'`; its own pre-create
  busy refusal from 090 is replaced by the runner's) and `upgrade-job.test.ts` (to
  `makeJobRunner()`); add "a mid-copy PACKAGE_INCOMPLETE failure leaves the installation
  revalidated". Wiring in `src/main/modules/downloads/index.ts`.
- **D5 — mods install and update on the runner; one busy rule.** Migrate
  `src/main/modules/mods/install-job.ts` and `src/main/modules/mods/update-job.ts` as in D2
  (`exclusive: 'installation'`); delete both `inFlight` sets, `slot` reservation/`handedOver`,
  `isBusy`, `BUSY_KINDS`, both `LOCAL_FAILURE` constants; update's preview uses
  `deps.runner.isInstallationBusy` → `jobs.error.installationBusy`. A concurrent second install now
  refuses with `jobs.error.installationBusy` (a _recorded_ mod still answers already-installed).
  Wiring in `src/main/modules/mods/index.ts`. Adapt `install-job.test.ts`/`update-job.test.ts` to
  `makeJobRunner()`, and add to `update-job.test.ts` "a running mod update refuses a mod install and
  an engine update" (start a held update via the shared runner, then call `startModInstall` and
  `startEngineUpdate` from `downloads/engine/update-job.ts` with the same runner and assert both
  answer `jobs.error.installationBusy`).
- **D6 — bootstrap on the runner.** Migrate `src/main/modules/downloads/bootstrap/job.ts` (its
  `controller`, IIFE, closures, `jobs.finish` calls; `markPlayable` → `ctx.markPlayable`, extractor
  → `ctx.setExtractor`; `exclusive: 'installation'` only when the request targets an existing
  installation id) and wiring in `src/main/modules/downloads/index.ts`; adapt `bootstrap/job.test.ts`
  to `makeJobRunner()` without weakening assertions. After this D,
  `git grep -n 'LOCAL_FAILURE =\|new AbortController' src/main/modules` lists only non-job network
  code (`fetcher.ts`, `servers/*`) and tests — add a test in `src/main/services/job-runner.test.ts`
  "no module job builds its own lifecycle" that reads every `*job*.ts` under `src/main/modules`
  (excluding tests) and asserts none contains `new AbortController`, `LOCAL_FAILURE =`,
  `jobs.finish(`, `inFlight` or `BUSY_KINDS`.
- **D7 — the busy refusal on the real surface.** `src/main/ipc/dev.ts`'s `writing` scenario runs
  through `app.jobRunner.run` with `exclusive: 'installation'` and `ctx.write` holding until cancel
  (the `stall`/`failure` scenarios stay). New flow `scripts/flows/jobs-installation-busy.mjs`
  (mirror `scripts/flows/mods-install.mjs` for setup via `modsInstallLifecycle`, and
  `scripts/flows/job-waits-for-running-game.mjs` for `dev:simulateJob` `writing`): hold a write job on
  `MODS_INSTALL_R1Q2_ID`, click install on a catalog mod and assert the refusal text "Another job is
  changing this installation" is visible on the mods surface and no new job exists; then start an
  engine update for the same installation from its dialog (mirror `scripts/flows/engine-update.mjs`'s
  trigger) and assert the same visible text; cancel the held job.
- **D8 — one failure log for every module.** `src/main/modules/downloads/index.ts`
  `observeFailedJobs`: remove the `moduleId !== 'downloads'` skip (diagnostics drop also runs for
  all). `src/shared/modules/downloads.ts` `DownloadDiagnosticsTarget.missingChecks` items gain
  `params?: Record<string, string | number>`; `src/main/lib/schemas.ts` accepts it
  (`.optional().catch(undefined)`); `src/main/modules/downloads/bootstrap/job.ts`'s `recordTarget`
  copies `check.params` with every string value reduced to `path.basename`. Tests:
  `src/main/modules/downloads/index.test.ts` › "a failed mods job is recorded in the failure log";
  `src/main/modules/downloads/bootstrap/job.test.ts` › "missingChecks carry basename params".
- **D9 — the failure detail renders check params.**
  `src/renderer/src/modules/downloads/components/FailureCauseDetail.tsx` renders
  `t(check.messageKey, check.params ?? {})` (the `missingChecks` item type in
  `src/shared/modules/downloads.ts` already carries `params?` after D8);
  `src/renderer/src/modules/downloads/report.ts` does the same where it renders the keys. Test
  `src/renderer/src/modules/downloads/components/FailureCauseDetail.test.tsx` › "every validation key
  renders with its params and no placeholder" (iterate every `validation.*` leaf string in
  `src/renderer/src/i18n/locales/en.json` except `validation.fix.*`, give a param for each
  `{{name}}`, render it as a missing check, assert the rendered text contains no `{{`).
- **D10 — docs.** `docs/ARCHITECTURE.md` `### Jobs`: replace "No module produces jobs yet…" with the
  runner (`JobRunner.run`, what `ctx` owns, finish-once, revalidate-after-write) and the exclusivity
  rule (any module, one installation, `jobs.error.installationBusy`). `docs/systems/install-module.md`:
  note the failure log covers every module's jobs and that writing jobs are exclusive per
  installation. `docs/ROADMAP.md`: delete the `PACKAGE_INCOMPLETE` stale-status follow-up and the
  `missingChecks` `{{path}}` follow-up. `src/main/services/write-guard.ts`: drop "nothing … stops two
  jobs from targeting one installation" in favour of a pointer to the runner's rule. Test
  `src/main/services/job-runner.test.ts` › "the architecture doc describes the runner" (reads
  ARCHITECTURE.md: no "No module produces jobs yet", mentions `installationBusy`; reads ROADMAP.md:
  neither follow-up text remains).

## Model Hints

- D1 → deliverable-hard: the runner is new concurrent lifecycle code under the write guard — cancel
  racing a deferred write, `jobs.cancel()` already having finished the job (a naive `finish` would
  overwrite `cancelled`), and the synchronous check-then-create that replaces three registries are
  each a regression no single job test would catch.
- Review: → story-review-hard — a migration that keeps a job's tests green while silently dropping
  `exclusive`, or calling `ctx.write` but bypassing the runner's revalidation by catching inside the
  body, passes every per-job test and reads as a clean refactor; the second pass checks each of the
  eight starters against D-S7/D-S8 and the finish-once rule.

## Acceptance Tests

- AC1 → unit `src/main/services/job-runner.test.ts` › "a succeeding body finishes the job once as
  succeeded", "a throwing body finishes as local failure", "cancel before write never calls fn and
  settles cancelled", "cancel during write settles cancelled and does not overwrite the cancelled
  status" (D1)
- AC2 → unit `src/main/modules/mods/update-job.test.ts` › "a running mod update refuses a mod install
  and an engine update" (D5); unit `src/main/services/job-runner.test.ts` › "an exclusive job is
  refused while any module's job targets the installation" (D1); e2e
  `scripts/flows/jobs-installation-busy.mjs` › `jobs-installation-busy` (D7)
- AC3 → unit `src/main/services/job-runner.test.ts` › "a failing write still revalidates" (D1);
  unit `src/main/modules/downloads/repair/job.test.ts` › "a repair whose write fails leaves the
  installation revalidated" (D3); unit `src/main/modules/downloads/retail/upgrade-job.test.ts` › "a
  mid-copy PACKAGE_INCOMPLETE failure leaves the installation revalidated" (D4); roadmap lines →
  unit `src/main/services/job-runner.test.ts` › "the architecture doc describes the runner" (D10)
- AC4 → unit `src/main/services/job-runner.test.ts` › "no module job builds its own lifecycle" (D6);
  existing per-job test files stay green after D2–D6
- AC5 → unit `src/main/modules/downloads/index.test.ts` › "a failed mods job is recorded in the
  failure log" (D8); renderer
  `src/renderer/src/modules/downloads/components/FailureCauseDetail.test.tsx` › "every validation key
  renders with its params and no placeholder" (D9); unit `src/main/modules/downloads/bootstrap/job.test.ts`
  › "missingChecks carry basename params" (D8)
- AC6 → unit `src/main/services/job-runner.test.ts` › "the architecture doc describes the runner"
  (D10); e2e every downloads/mods flow: `bootstrap-r1q2`, `bootstrap-wizard`, `bootstrap-failure`,
  `bootstrap-failure-retry`, `bootstrap-incomplete-package`, `bootstrap-existing-folder`,
  `bootstrap-retail-import`, `bootstrap-no-engine-for-platform`, `engine-update`, `repair`,
  `retail-upgrade`, `downloads-tab`, `job-waits-for-running-game`, `mods-install`,
  `mods-install-refused`, `mods-install-waits`, `mods-install-over-manual`,
  `mods-install-content-only`, `mod-update`, `mods-remove`, `replays-mod-install`,
  `jobs-installation-busy` (run per D2–D7 for the flows of the job migrated)

## Done

<!-- Filled by /build 219. -->
