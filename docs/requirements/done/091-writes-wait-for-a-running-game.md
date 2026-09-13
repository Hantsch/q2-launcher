---
id: 091
title: Writes wait for a running game
status: done
created: 2026-09-12
---

## Requirement

The [install-module concept](../concepts/install-module.md) fixes INST-J7: while an
installation's own Quake II process is running, no job may write into that installation's
files — the job reports why it is waiting and continues by itself once the process exits.
Nothing in the codebase implements this wait-then-continue mechanism today. The gap is
already visible: [[090]]'s retail-upgrade job can copy into an installation's folder while
that installation's game is running, and the update/rollback and repair stories about to be
built ([[092]], [[093]]) would inherit the same hole if this is not built first. This story
gives the job pipeline the one guard every writing job shares, and retrofits it onto the
existing retail-upgrade job so that pre-existing gap closes too.

## Acceptance Criteria

- [x] **AC1** — Starting (or resuming into) the write phase of a job that targets an
      installation whose Quake II process is currently running does not touch that
      installation's files; the job instead enters a visible waiting state.
- [x] **AC2** — The waiting state names the reason (the game is running) in the Downloads tab
      and wherever else that job's progress is shown, not just as a generic "queued" status.
- [x] **AC3** — When the installation's process exits, a job waiting on it resumes its write
      phase on its own, without any user action.
- [x] **AC4** — A job may still download/verify/extract into the cache while the target
      installation's game is running (per the existing "downloading while playing" setting);
      only the write into the installation's own folder is gated.
- [x] **AC5** — [[090]]'s retail-upgrade job is retrofitted onto this guard: launching that
      installation's game while an upgrade job is copying into its folder is no longer
      possible, closing the gap the S19 review flagged.
- [x] **AC6** — Cancelling a job that is in the waiting state removes its partial files exactly
      as cancelling any other job does; waiting is not a special case for cancel.

## Decisions (Sprint)

- **The guard is a shell service, not a downloads-module file.** `InstallationWriteGuard` lands in
  `src/main/services/write-guard.ts`, next to `jobs.ts` and `launch.ts`. Reason: it arbitrates
  between two shell-owned services (jobs and launch) and is consumed by three more stories
  ([[092]], [[093]], [[094]]) plus the mods/assets `game-lifecycle` guard the roadmap already
  reserves — that is shell infrastructure of the same class as `JobsService`, not a feature, so
  CLAUDE.md's "a feature is a module" is not bent (same reasoning the concept's §12.1 used for
  module-contributed settings sections).
- **The waiting state is a new `JobStatus` member, not a re-used `queued`.** AC2 explicitly rejects
  "just a generic queued status", and `queued` already means "admitted but not started" for the
  concurrency limit (INST-J2). `'waiting'` counts as active in `isJobActive`, so the titlebar badge
  and the action bar keep showing it.
- **The reason travels as an i18n key on the job, not as a renderer-side constant.** `Job` gains
  `waitingReason?: { key; params? }` (same shape as `Job.error`). Reason: CLAUDE.md forbids prose
  across IPC, and later waits ([[093]]'s repair, [[094]]'s removal) will name different reasons —
  hardcoding "the game is running" in the renderer would put main-process semantics in a string.
- **`Job.writeLock?: boolean` carries the inverse direction to the renderer.** Set while a job holds
  the lock, cleared on release. Reason: AC5's Play button has to be disabled in the renderer, and
  the renderer already receives the full job list over `jobs:changed` — a second broadcast channel
  for guard state would be a parallel mechanism INST-J1 rules out. Main's `LaunchService` still asks
  the guard itself, so the authoritative refusal is never derived from renderer-visible data.
- **The seam is `guard.runWrite(installationId, jobId, signal, fn)`, wrapped around the write phase
  only.** Download, verification and extraction into `userData/cache/downloads/` stay outside it.
  Reason: that is exactly AC4 / INST-J8 — the download-while-playing setting governs the transfer,
  the guard governs the installation folder.
- **Cancel is an `AbortSignal`, so waiting is not a special case (AC6).** The job's existing
  `onCancel` aborts the controller; `runWrite` rejects with the module's normal cancellation error
  and the already-built cleanup path runs unchanged. Reason: AC6 demands cancel behave identically,
  and the cheapest way to guarantee that is to reach the same `catch` block.
- **`LaunchService` gains an additive `onStateChange` observer list**, mirroring `JobsService.onChange`
  (story 073 D2). Reason: the guard must learn when the process exits, and the single constructor
  callback is already taken by the `launch:state` broadcast, which must stay first and unhindered.
- **[[090]]'s refusal is replaced by a wait, including on the renderer.** `upgrade-job.ts`'s
  pre-`jobs.create` `INSTALLATION_RUNNING` refusal goes away, and the three triggers (library card,
  action bar, rail hover card) stop being disabled while the game runs. Reason: 091 AC1 is general —
  one job kind refusing while every other waits is precisely the inconsistency this story removes;
  090's AC7 ("rather than overwriting files out from under a running game") is satisfied strictly
  better by waiting. Consequence: `scripts/flows/retail-upgrade.mjs`'s "the action is disabled while
  running" assertion must be rewritten to "the action starts a job that waits" — that edit is part
  of D5, not a regression.
- **The bootstrap job's two assemble passes are retrofitted too.** Reason: `playableAtRatio` lights
  the Play button at step 7, while step 8 still writes `video`/`players` into the installation — a
  real, already-shipped instance of the hazard, and the wrap is the same one call. It is also the
  only job with a download phase, which makes it the natural place to prove AC4.
- **`dev:simulateJob` gains an `installationId` and a `'writing'` scenario that acquires the real
  lock and holds it until cancelled.** Reason: AC5's user action (pressing Play while a job copies)
  needs a deterministic write phase on the real surface; a fixture copy finishes too fast to click
  against. Same dev-only affordance class as `dev:simulateLaunch` ([[090]] D5), behind the same
  `DEV_ONLY_CHANNELS` allowlist, and it takes the *real* lock so main's refusal is exercised, not
  faked.
- **No concurrency/queue work here.** `JobsService` still has no admission control (INST-J2 is
  unbuilt); this story only adds waiting, not queueing. Reason: keeping the guard orthogonal to the
  concurrency limit means [[092]]–[[094]] can ride it without waiting for that separate mechanic.

## Open Questions

None.

## Plan

1. **Job model** — `src/shared/types/jobs.ts`: `JobStatus` gains `'waiting'` (active in
   `isJobActive`); `Job` gains `waitingReason?: { key; params? }` and `writeLock?: boolean`.
   `src/main/services/jobs.ts` gains `setWaiting(id, reason)` and `setWriteLock(id, holding)`
   (the latter clears `waitingReason` and restores `status: 'running'`). i18n:
   `jobs.status.waiting`, `jobs.waiting.gameRunning`.
2. **The guard** — new `src/main/services/write-guard.ts`. `isBlockedFor(installationId)` reads
   `LaunchService.getState()` (`installationId` match + phase `starting`/`running`);
   `runWrite(installationId, jobId, signal, fn)` waits (marking the job `waiting` with its reason),
   resumes on the launch observer, takes the lock (`writeLock: true`), runs `fn`, releases in
   `finally`; `isWriting(installationId)` answers the inverse direction. `LaunchService` gets the
   additive observer seam and refuses `start()` with `launch.error.installationBusy` when the guard
   reports a write in flight. Wired in `src/main/context.ts`.
3. **Renderer** — the waiting reason and status render in the three job surfaces
   (`ActionBar.tsx`'s `JobReadout`, `modules/downloads/components/JobRow.tsx`,
   `modules/downloads/bootstrap/RunningStep.tsx`); `resolvePrimaryAction` in `ActionBar.tsx`
   disables Play while a job with `writeLock` targets that installation.
4. **Retrofit** — `retail/upgrade-job.ts` drops its pre-job refusal and wraps the copy+promote in
   `runWrite`; `bootstrap/job.ts` wraps its two `assembleInstallation` passes (steps 6 and 8) in
   `runWrite`, leaving steps 5's download/extract outside it. The three renderer triggers stop
   being disabled; `scripts/flows/retail-upgrade.mjs`'s running-state assertion is rewritten.
5. **Dev surface + e2e** — `dev:simulateJob` gains `installationId` + scenario `'writing'`;
   `scripts/flows/job-waits-for-running-game.mjs` drives the whole story on the real surface.

Order: D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8. D3 may start once D1 exists; D6 is independent of
D4/D5 once D2 lands.

## Deliverables

- [x] **D1 — The job model learns to wait.** `src/shared/types/jobs.ts`,
  `src/main/services/jobs.ts`, `src/main/services/jobs.test.ts`,
  `src/renderer/src/i18n/locales/en.json`. Mirror `markPlayable()` (`jobs.ts:118`) for the shape of
  a non-progress mutator. *Acceptance:* `setWaiting` puts a job into `'waiting'` with its reason and
  `setWriteLock(id, true)` clears the reason and returns it to `'running'`; `isJobActive`/
  `countActiveJobs` count `'waiting'`; typecheck green across every exhaustive `JobStatus` switch.
  Test in `jobs.test.ts` — "a waiting job names its reason and still counts as active".
- [x] **D2 — `InstallationWriteGuard` + the inverse launch refusal.**
  `src/main/services/write-guard.ts` (new) + `write-guard.test.ts` (new),
  `src/main/services/launch.ts` (+ new `launch.test.ts`), `src/main/context.ts`,
  `src/renderer/src/i18n/locales/en.json`. Mirror `JobsService.onChange` (`jobs.ts:65`) for the
  additive observer and `LaunchService.start`'s `fail('launch.error.alreadyRunning')`
  (`launch.ts:76`) for the refusal shape. *Acceptance (with a fake launch host and a fake jobs
  service):* `runWrite` calls `fn` immediately when nothing runs; defers it and marks the job
  `waiting` when that installation runs; calls `fn` exactly once after the process exits; releases
  the lock and unsubscribes on success, failure and abort alike; an abort while waiting rejects
  without ever calling `fn`; `isWriting` is true only between acquire and release, and
  `LaunchService.start()` then fails with `launch.error.installationBusy`. Proves AC1, AC3, AC5
  (main half) and AC6 (main half).
- [x] **D3 — The waiting state is visible.** `src/renderer/src/components/shell/ActionBar.tsx`,
  `src/renderer/src/modules/downloads/components/JobRow.tsx`,
  `src/renderer/src/modules/downloads/bootstrap/RunningStep.tsx`,
  `src/renderer/src/modules/downloads/DownloadsView.test.tsx`, plus a test for `JobReadout`.
  Mirror `RunningStep.tsx:35-59`'s `t(job.error.key, job.error.params ?? {})` rendering.
  *Acceptance:* a job with `status: 'waiting'` renders its `waitingReason` (not a bare "queued")
  in the Downloads tab row, the action-bar readout and the bootstrap running step; a job with
  `writeLock` on installation X makes `resolvePrimaryAction` return a disabled Play with a reason;
  no colour-only status indication. Proves AC2 and AC5's renderer half.
- [x] **D4 — The retail-upgrade job waits instead of refusing.**
  `src/main/modules/downloads/retail/upgrade-job.ts`, `upgrade-job.test.ts`. The pre-`jobs.create`
  guard at `upgrade-job.ts:213-224` is removed; the copy+promote block (`runUpgrade`, `:371-430`)
  runs inside `runWrite`, with the job's existing `onCancel` also aborting the controller.
  *Acceptance:* with the installation running the job is created, enters `waiting`, and no byte is
  written; on exit it copies and promotes exactly as before; cancelling while waiting removes the
  staging dir and finishes the job `cancelled`, same path as cancelling mid-copy. Proves AC5's
  retrofit and AC6.
- [x] **D5 — The triggers stop being disabled.** `src/renderer/src/views/LibraryView.tsx`,
  `src/renderer/src/components/shell/ActionBar.tsx`,
  `src/renderer/src/components/shell/InstallationRail.tsx`, `scripts/flows/retail-upgrade.mjs`.
  *Acceptance:* the import-retail action is enabled on all three surfaces while that installation's
  game runs; `npm run ui:flow -- retail-upgrade` passes again with its running-state assertion
  rewritten to "the action starts a job that waits" (every other assertion of [[090]] untouched).
- [x] **D6 — The bootstrap's assemble passes ride the guard.**
  `src/main/modules/downloads/bootstrap/job.ts`, `job.test.ts` (or the nearest existing bootstrap
  job test). Wrap step 6 (`ASSEMBLE_CORE_RATIO`, `job.ts:225-245`) and step 8 (`ASSEMBLE_AUX_RATIO`)
  in `runWrite`; leave step 5's download/extract loop outside it. *Acceptance:* with a blocked
  guard the download and extract steps still run to completion and only the assemble call is
  deferred; once unblocked, assembly runs once and the job finishes normally. Proves AC4.
- [x] **D7 — A dev-only writing job.** `src/shared/ipc.ts` (payload + `DEV_ONLY_CHANNELS`),
  `src/shared/ipc-schemas.ts`, `src/main/ipc/dev.ts` + `dev.test.ts`, preload channel arrays.
  Mirror `dev:simulateLaunch` ([[090]] D5) exactly. *Acceptance:* `dev:simulateJob({ scenario:
  'writing', installationId })` creates a job that acquires the **real** write lock for that
  installation, reports `writeLock: true`, and holds until cancelled; the channel stays in
  `DEV_ONLY_CHANNELS` and is not registered outside dev.
- [x] **D8 — Offline end-to-end proof.** `scripts/flows/job-waits-for-running-game.mjs` (new),
  `scripts/lib/fixture.mjs` if a fixture is missing, `docs/UI-VERIFICATION.md`. Mirror
  `scripts/flows/retail-upgrade.mjs` (surface locators + on-disk assertions) and
  `scripts/flows/downloads-badge-count.mjs` (dev-channel seeding). *Acceptance:*
  `npm run ui:flow -- job-waits-for-running-game` passes with no network: with `dev:simulateLaunch`
  running, the import-retail action starts a job that shows the waiting reason in the Downloads tab
  and the action bar; simulating `idle` makes it finish on its own with the paks changed on disk;
  a second run cancels the waiting job and asserts nothing was written; and with a `'writing'` job
  held on that installation, Play is disabled and `launch:start` refuses with
  `launch.error.installationBusy`.

## Model Hints

- `D2 → deliverable-hard` — it is the only genuinely concurrent code in the repo: an async wait
  driven by an event listener that must fire exactly once, unsubscribe on all four exits (resume,
  success, failure, abort), and never leave a lock held or a job stuck in `waiting`; a leak here
  deadlocks every writing job for the rest of the session, and three later stories inherit it.
- `D4 → deliverable-hard` — it rewires the cancel and cleanup paths of a job that promotes ~197 MB
  over a live installation's `pak0.pak`/`pak1.pak`; a missed abort wiring means cancelling a waiting
  job leaves a staging dir or, worse, resumes a copy after cancellation.
- All other deliverables: default tier.
- `Review: → story-review-hard` — the story changes a shell-owned type consumed by every job
  surface, introduces the app's first lock, and deliberately relaxes an already-accepted guard from
  [[090]] (refusal → wait); a diff-blind reviewer would not notice a regression in either direction.

## Acceptance Tests

- AC1 → unit `src/main/services/write-guard.test.ts` › "a write into a running installation is
  deferred and the job is marked waiting, without calling the write function", plus e2e
  `npm run ui:flow -- job-waits-for-running-game` (`scripts/flows/job-waits-for-running-game.mjs`)
  › "starting the retail upgrade while the game runs writes nothing and shows a waiting job"
- AC2 → e2e `scripts/flows/job-waits-for-running-game.mjs` › "the waiting reason names the running
  game in the Downloads tab and the action-bar readout", plus unit
  `src/renderer/src/modules/downloads/DownloadsView.test.tsx` › "a waiting job renders its reason,
  not a generic queued status"
- AC3 → unit `src/main/services/write-guard.test.ts` › "the deferred write runs exactly once after
  the process exits", plus e2e `scripts/flows/job-waits-for-running-game.mjs` › "simulating the
  game's exit finishes the job with no user action and the paks changed on disk"
- AC4 → unit `src/main/modules/downloads/bootstrap/job.test.ts` › "download and extract run while
  the target installation is running; only the assemble pass waits"
- AC5 → e2e `scripts/flows/job-waits-for-running-game.mjs` › "while a job holds the write lock the
  Play button is disabled and launch:start refuses with launch.error.installationBusy" (write phase
  produced through the real surface via D7's `dev:simulateJob` `'writing'` scenario), plus unit
  `src/main/services/launch.test.ts` › "start() refuses while a job is writing into that
  installation" and `src/main/modules/downloads/retail/upgrade-job.test.ts` › "the upgrade job
  waits instead of refusing, and holds the write lock while copying"
- AC6 → e2e `scripts/flows/job-waits-for-running-game.mjs` › "cancelling a waiting job leaves no
  partial files behind", plus unit `src/main/modules/downloads/retail/upgrade-job.test.ts` ›
  "cancelling while waiting runs the same cleanup as cancelling mid-copy" and
  `src/main/services/write-guard.test.ts` › "an abort while waiting never calls the write function
  and releases nothing it never took"

No manual residue: every criterion has an automated test. The one dependency carried into the build
is that D5 rewrites an assertion [[090]] shipped green — that is intended by this story's own
Decisions section, not a regression to be "fixed" back.

## Done

Built the `InstallationWriteGuard` (`src/main/services/write-guard.ts`) as the one shared seam
between jobs and launch: a write into a running installation's folder is deferred, the job is
marked `'waiting'` with an i18n reason, and it resumes on its own once the game exits — via an
additive `LaunchService.onStateChange` observer. `LaunchService.start()` refuses with
`launch.error.installationBusy` while the guard reports a write in flight, closing the loop in
the other direction. The retail-upgrade job (090) and the bootstrap job's two assemble passes are
retrofitted onto it; the retail-upgrade job's own pre-job refusal is removed and its three
renderer triggers stay enabled while the game runs, since the job now waits instead. A dev-only
`dev:simulateJob({ scenario: 'writing' })` scenario takes the real lock for manual/e2e probing,
and a new offline flow (`job-waits-for-running-game.mjs`) proves the whole story end to end
alongside a rewritten `retail-upgrade.mjs`.

**Commit message:**
```
091: writes wait for a running game
```

**Verification:**
- `npm run build` — green.
- `npm test` — 205 files, 3718 passed / 1 skipped; one file
  (`config/core/import-reader.test.ts`'s 512-file fan-out test) times out only under full-suite
  load and passes 42/42 in isolation — pre-existing, unrelated to this story, not touched by it.
- `npm run typecheck` — green (node + web).
- `npm run ui:flow -- retail-upgrade` and `npm run ui:flow -- job-waits-for-running-game` — both
  OK. `npm run ui:verify` (full 43-screen/82-shot suite) — 0 axe violations.
- Review: a clean `story-review-hard` agent returned **PASS** on all six criteria, plus one
  plausible narrow finding and several minor/hygiene ones, all fixed directly (see Decisions
  below) and re-verified (typecheck/tests/both e2e flows re-run green after the fixes).

**AC → test mapping, as verified:**
- AC1 → `write-guard.test.ts` › "a write into a running installation is deferred and the job is
  marked waiting, without calling the write function" (pass) + e2e `job-waits-for-running-game`
  (pass).
- AC2 → e2e `job-waits-for-running-game` (waiting reason shown on both surfaces) +
  `DownloadsView.test.tsx` › "a waiting job renders its reason, not a generic queued status"
  (pass).
- AC3 → `write-guard.test.ts` › "the deferred write runs exactly once after the process exits"
  (pass) + e2e (pass).
- AC4 → `bootstrap/job.test.ts` › "download and extract run while the target installation is
  running; only the assemble pass waits" (pass).
- AC5 → e2e (Play disabled + `launch:start` refuses with `launch.error.installationBusy`, via
  D7's `dev:simulateJob('writing')`) + `launch.test.ts` › "start() refuses while a job is writing
  into that installation" + `upgrade-job.test.ts` › "the upgrade job waits instead of refusing,
  and holds the write lock while copying" (all pass).
- AC6 → e2e "cancelling a waiting job leaves no partial files behind" +
  `upgrade-job.test.ts` › "cancelling while waiting runs the same cleanup as cancelling
  mid-copy" + `write-guard.test.ts` › "an abort while waiting never calls the write function and
  releases nothing it never took" (all pass).

No manual residue — every criterion has an automated test, as planned.

**Decisions (post-review fixes):**
- Added a second `signal.aborted` re-check in `write-guard.ts`'s `runWrite`, right before
  `acquire()`, closing a narrow window where a cancel landing in the same microtask the wait
  resolved in could still take the lock and start a doomed write (cleaned up correctly either
  way, but wasted I/O — the reviewer's one plausible finding).
- Removed the now-dead `INSTALLATION_RUNNING` error contract
  (`bootstrap/errors.ts`, `downloads.error.installationRunning` in `en.json`) left over from
  090's refusal, which D4 replaced with a wait.
- Rewrote `retail-upgrade.mjs`'s closing summary line, which still described the removed
  "disabled while running" behaviour even though its assertions already tested the new
  "stays enabled, starts a job that waits" behaviour.
- Aligned `Job.waitingReason.params`'s type with `Job.error.params`
  (`Record<string, string | number>` instead of `Record<string, unknown>`), and fixed a stale
  doc comment on `countActiveJobs` that predated `'waiting'` joining the active set.
- Not touched: `useLauncher.ts`'s `useActiveJob` fallback that matches a job with no
  `installationId` (reviewer's informational, latent-only finding — no code path produces such a
  job today, in this story or its dependents).
