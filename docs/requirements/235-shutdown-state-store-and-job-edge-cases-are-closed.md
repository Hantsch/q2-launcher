---
id: 235
title: shutdown, state-store and job edge cases are closed
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

The S32 reviews left a handful of lifecycle edges that no test pins and a few fragile seams:

- [[201]]: a late `cinema.set(true)` after `dispose` could reopen the overlay; the electron-updater
  `quitAndInstall` path through the held `before-quit` is untested; cinema and stage-follow disposal
  is proven only by helper tests, not at module level.
- [[207]]: `new StateStore(path)` without a `migrations` option runs no migration (production passes
  them, but the footgun is open); `withEngineState` is a prototype view of the installations service
  that breaks if the service gains `#private` fields.
- [[219]]: a throw in `commitAdoption` after the failure is cleared sits outside bootstrap's catch;
  the debounce-race fix (`state.settle` before `jobs.finish`) is inferred, not measured against the
  pre-fix code.
- [[220]]: a bleeding-edge transport failure now ends as `allMirrorsFailed` where it used to end as
  `network`; whether the user-facing cause should differ was not decided.

The maintainer wants each edge either closed or pinned by a test, so the shutdown, state and job
foundations of S32 carry no silent assumptions.

## Acceptance Criteria

- [ ] **AC1** — After `dispose`, a cinema `set(true)` does nothing, and a module-level test proves
      that cinema and stage-follow listeners are released on dispose.
- [ ] **AC2** — A test drives the `quitAndInstall` update path through the held `before-quit` and
      shows state is settled before the app exits.
- [ ] **AC3** — A `StateStore` cannot be constructed without stating its migrations (required option),
      and the installations service exposes engine-state writes without a prototype view.
- [ ] **AC4** — A throw in `commitAdoption` ends the bootstrap job as a failure with a cause and
      frees the installation.
- [ ] **AC5** — A test fails when `state.settle` is removed before `jobs.finish` (the debounce race).
- [ ] **AC6** — A bleeding-edge transport failure shows the cause the user can act on (decided in
      refine: `network` or `allMirrorsFailed`), pinned by a test and a failure-log rendering.

## Open Questions

None. The AC6 question was deferred to refine and is decided below.

## Decisions (Sprint)

- **AC6 cause is `downloads.error.allMirrorsFailed`, unchanged.** Pinned downloads already end a
  transport failure with this key, and its sentence ("Every download source failed. Check your
  connection and try again.") tells the user what to do. `downloads.error.network` does not.
- **A late `cinema.set(true)` after `dispose` answers `ok` and does nothing.** No pin, no
  subscription, no overlay. The module is going away, so no refusal reason is shown to anyone.
- **StateStore's `migrations` becomes a required option: `readonly MigrationStep[] | 'none'`.**
  Tests that never read an older file write `'none'` explicitly. That keeps ~150 test call sites to
  a one-token change, and a forgotten option becomes a type error.
- **A test pins `'none'` to tests.** Only `*.test.ts`, `*.test-helpers.ts` and `src/test-support/`
  may pass it, because the type alone would let production opt out silently.
- **The StateStore change is one mechanical D, even though it touches ~45 files.** Every edit is
  the same literal edit, so splitting it would only add hand-offs and no reviewable seams.
- **Engine-state writes become `InstallationsService.setEngineState(id, patch)`.**
  `record-engine-state.ts` (and its `withEngineState` prototype view) is deleted. The helpers it
  builds on already live in the shell (`services/engine-state.ts`), so this adds no layering edge.
- **A `commitAdoption` throw goes through bootstrap's own `failed()` with `LOCAL_FAILURE`.** The
  runner's generic catch is not enough, because it does not record `lastFailure`. Without that
  record the installation is left with no failure and stops being adoptable, which is the
  `installations.error.duplicate` dead end.
- **The debounce-race test uses a real `StateStore` and the real `JobRunner`.** The existing
  mocked-settle test stays. The build proves the new test fails with the `state?.settle()` call
  removed and records that in `## Done`, because "measured against the pre-fix code" is the AC.
- **The `quitAndInstall` test fakes electron-updater, not the installer.** The fake mirrors
  `BaseUpdater.quitAndInstall` (install, then `setImmediate` → `app.quit()`). The NSIS installer's
  own wait/kill timing belongs to electron-builder and is out of scope.
- **The AC2 and AC5 test Ds change no product code** unless their test exposes a defect. In that
  case the fix stays inside the D's named file.

## Plan

Seven small, independent edges, in this order. Each ships its own test.

1. **Cinema.** Add a `disposed` flag in `cinema-controller.ts`. A module-level test in the replays
   `index.test.ts` counts cinema `onClosed`, the stage-follow window listener and the follower, and
   checks all three are released on `disposeAll()`.
2. **quitAndInstall.** A test in `service.actions.test.ts` connects the real update service, the
   real `installShutdown`, a fake electron-like app and a real `StateStore` with a pending write.
3. **StateStore.** `migrations` becomes required (`MigrationStep[] | 'none'`). Every test call site
   gets the literal edit. A guard test keeps `'none'` out of production. One line in ARCHITECTURE.md.
4. **Engine state.** `InstallationsService.setEngineState` replaces `record-engine-state.ts` and
   `withEngineState`. Downloads and the tests use the service method directly.
5. **Bootstrap.** `commitAdoption` runs inside the body's failure path (`failed(LOCAL_FAILURE, …)`),
   so its throw records `lastFailure`, frees the installation and keeps it retryable.
6. **Debounce race.** A real-store test in `job-runner.test.ts` reads `state.json` from disk at the
   moment the job turns terminal. It is proven red with the settle call removed.
7. **Bleeding edge.** Pin `allMirrorsFailed` for a nightly transport failure in `update-job.test.ts`
   and in the `FailureLogEntry` rendering. One line in `install-module.md`.

The order is the safe one, not a dependency chain. D3 and D4 touch shared test fixtures, so they
run before D5–D7, which add tests in those areas. A CHANGELOG `### Fixed` line goes with D5, the
only user-visible fix: a crashed retry now shows its failure and can be retried.

## Deliverables

- **D1 — A disposed cinema stays closed, and replays releases cinema and stage-follow on dispose (AC1).**
  - In `src/main/modules/replays/cinema-controller.ts`, add a `disposed` flag set by `dispose()`.
  - After `dispose()`, `set(true)` returns `ok(undefined)` without calling `pin`, `subscribe` or
    `window.open`. `set(false)` stays harmless.
  - The existing `subscribed = true` trick in `dispose()` may stay or be folded into the flag. Keep
    one mechanism, not two.
  - Unit test in `src/main/modules/replays/cinema-controller.test.ts` ›
    "set(true) after dispose opens nothing and pins nothing".
  - Module-level test in `src/main/modules/replays/index.test.ts`. Extend the existing
    `countingContext()` (≈line 880): count `cinemaWindow.onClosed` subscribers and the followers
    the stage follower created (live = created − disposed). Then add
    "disposing the module releases cinema and stage-follow listeners":
    1. Register and play with a `stage` rect (`registerAndPlay(app, stage)`).
    2. Enter cinema through the `playback.cinema` handler (the handler around `index.ts:502`).
    3. Expect: one cinema `onClosed` subscriber, main-window listeners = observer + stage-follow,
       one live follower.
    4. Call `await registry.disposeAll()` and expect all three counts at 0.
  - Use the module's real wiring, not the helpers. Find the follower factory through the
    `AppContext` port `createStageFollowSessions` gets in `index.ts:355`.
  - If `docs/systems/replays-module.md` describes cinema teardown, add one line saying a late enter
    after dispose is a no-op.

- **D2 — The `quitAndInstall` path runs through the held `before-quit` and settles state first (AC2).**
  - Test-only, in `src/main/services/update/service.actions.test.ts`. Reuse that file's fake
    backend helper (≈line 56) and its way of reaching stage `'downloaded'`.
  - Override the backend's `quitAndInstall` to mirror electron-updater's `BaseUpdater.quitAndInstall`:
    record `'install'`, then `setImmediate(() => app.quit())`.
  - Build the fake app as a small emitter satisfying `ShutdownApp` (`src/main/shutdown.ts`).
    `quit()` emits `before-quit` with an event whose `preventDefault()` marks it held. A quit that
    was not held records `'exit'`.
  - Install the real `installShutdown({ app, log, releasePlayback, disposeModules, settles })` with
    one settle `{ label: 'state', run: () => store.settle() }`. `store` is a real `StateStore` on a
    temp file (`{ migrations: 'none' }` if D3 is in, else no option) with a debounced write made
    just before `installAndRestart()`.
  - Test "quitAndInstall's quit runs through the held before-quit and state is on disk before the
    app exits":
    - `installAndRestart()` resolves ok.
    - Wait for `'exit'`.
    - The first `before-quit` was held.
    - When `'exit'` was recorded, the temp file already contained the write (read it synchronously
      inside the `'exit'` recording).
    - `'exit'` happened exactly once.
  - If the test exposes a defect, fix it in `src/main/shutdown.ts` only.

- **D3 — A `StateStore` cannot be built without stating its migrations (AC3, first half).**
  - In `src/main/services/state.ts`, the constructor's options object becomes required, with
    `migrations: readonly MigrationStep[] | 'none'` required and `onPersistError` still optional.
  - `'none'` keeps today's "taken as current, no step runs" branch. Update the doc comment.
  - `src/main/context.ts` already passes `MODULE_MIGRATIONS` and stays unchanged.
  - Mechanical edit of every other `new StateStore(` call site under `src/`, ~150 sites in ~45 test
    files (find them with `rg "new StateStore\(" src`):
    - `new StateStore(p)` becomes `new StateStore(p, { migrations: 'none' })`.
    - `{ onPersistError }` gains `migrations: 'none'`.
    - Sites already passing `MODULE_MIGRATIONS` stay as they are.
  - Tests in `src/main/services/state.test.ts`:
    - "a StateStore without migrations does not compile" (`// @ts-expect-error` on
      `new StateStore(path)` and on `new StateStore(path, {})`)
    - "migrations 'none' is stated only by tests". This one scans `src/` for `migrations: 'none'`
      and allows it only in `*.test.ts`, `*.test-helpers.ts` and `src/test-support/**`. Use the
      `readdirSync` walk shape from `src/main/services/job-runner.test.ts` (≈line 290).
  - `docs/ARCHITECTURE.md` ≈line 158: say `migrations` is a required option, with `'none'` only in
    tests.

- **D4 — Engine-state writes are a method of the installations service (AC3, second half).**
  - Add `setEngineState(id: string, patch: Partial<InstallationEngineState>): Outcome<Installation>`
    to `InstallationsService` in `src/main/services/installations.ts`.
  - Move the body of `setEngineState` from `src/main/modules/downloads/engine/record-engine-state.ts`
    as it is: `find` → `fail('installations.error.notFound')`, `writeEngineState`/`readEngineState`
    from `./engine-state`, then one `this.patch(id, { moduleData, detectedVersion })`.
  - Delete `record-engine-state.ts` and move its tests from `record-engine-state.test.ts` into
    `src/main/services/installations.test.ts` (same names, `describe('setEngineState')`).
  - In `src/main/modules/downloads/index.ts`:
    - `setEngineState(app.installations, id, p)` (≈line 359) becomes
      `app.installations.setEngineState(id, p)`.
    - `withEngineState(app.installations)` (≈lines 651, 768, 794) becomes plain `app.installations`.
  - Same change in `src/main/modules/downloads/bootstrap/job.test-helpers.ts` (≈line 381),
    `engine/update-job.test.ts` (≈lines 26, 232, 243) and `engine/rollback-job.test.ts`
    (≈lines 12, 112, 124): call the service method.
  - Fix the stale pointer comment in `src/main/services/engine-state.test.ts` line 6 if needed.
  - Acceptance:
    - `rg "withEngineState|record-engine-state" src` is empty.
    - The moved tests pass.
    - The existing update/rollback/bootstrap suites stay green.
    - `src/main/shell-layering.test.ts` stays green.

- **D5 — A throw in `commitAdoption` ends the bootstrap as a recorded failure (AC4).**
  - In `src/main/modules/downloads/bootstrap/job.ts`, the body (≈line 971) currently runs
    `await commitAdoption?.()` (with `markAdoptionCommitted()` in a `finally`) **before** the
    `try { return await run() } catch → failed(LOCAL_FAILURE, …)` at ≈line 1615. A throw there
    reaches only the runner's generic catch. The job fails, but no `lastFailure` is written, and
    the record was just cleared.
  - Move the call inside that failure path:
    - A throw ends through `failed(LOCAL_FAILURE, \`adopting ${installation.id} failed: …\`)`
      (or `cancelledOutcome()` when `ctx.signal.aborted`).
    - `markAdoptionCommitted()` still always runs, so `startBootstrap`'s `await adoptionCommitted`
      can never hang.
    - The order inside `failed()` (clean up, record, validate, then fail) is untouched.
  - Test in `src/main/modules/downloads/bootstrap/job.failure-and-retry.test.ts` (mirror
    "AC3: an adopted retry that fails again records a new failure on the same installation",
    ≈line 454) › "a throw in commitAdoption ends the job failed with a cause and frees the
    installation". Make the adopted retry's `installations.update` (the rename) or `setLastFailure`
    throw, then assert:
    - The job ends `failed` with `error.key === LOCAL_FAILURE`.
    - The installation carries `lastFailure.errorKey === LOCAL_FAILURE`.
    - `runner.isInstallationBusy(id)` is false.
    - A second retry on the same folder is admitted (adopted, not `installations.error.duplicate`).
  - Add a `CHANGELOG.md` `### Fixed` line under `## Unreleased`, ≤15 words: a retry that broke
    while starting now shows its failure and can be retried.
  - If `docs/systems/install-module.md` describes adoption, add one line: a failed adoption is
    recorded like any other failure.

- **D6 — The debounce race is measured, not inferred (AC5).**
  - Test-only, in `src/main/services/job-runner.test.ts` › "a job's state write is on disk when the
    job turns terminal".
  - Use a real `StateStore` on a temp file (`{ migrations: 'none' }` after D3) as
    `makeJobRunner({ state: store })` (`src/test-support/job-runner.ts`), with real timers.
  - The body's `ctx.write(INSTALLATION, …)` changes the store (any section or settings write that
    lands in `state.json`).
  - Subscribe to the jobs service's change notification. On the first terminal status, read the
    file with `readFileSync` and capture it.
  - Assert the captured content contains the write.
  - The existing mocked test "a job that wrote waits for state to settle before it shows as
    finished" stays.
  - **Build proof:** temporarily delete the `await state?.settle()` call
    (`src/main/services/job-runner.ts` ≈line 216), run the test and see it fail, then restore.
    Record "red without settle, green with it" in `## Done`.

- **D7 — A bleeding-edge transport failure reads as `allMirrorsFailed`, pinned (AC6).**
  - Test-only plus docs.
  - Test in `src/main/modules/downloads/engine/update-job.test.ts`, next to "a bleeding-edge update
    downloads through downloadPackage in size-only mode" (≈line 440): "a bleeding-edge transport
    failure ends as downloads.error.allMirrorsFailed".
    - Use the same fixture, but the asset URL answers 5xx or refuses the connection on every
      request, through the file's existing fetch double.
    - Assert the job fails with `downloads.error.allMirrorsFailed`, not
      `downloads.error.bleedingEdgeSizeMismatch` and not `downloads.error.network`.
  - Rendering test in `src/renderer/src/modules/downloads/components/FailureLogEntry.test.tsx`.
    Extend the `describe('FailureLogEntry failure reasons')` pattern (≈line 214) with
    "a failed bleeding-edge update shows the all-sources-failed sentence".
    - Use the engine-update job's `labelKey` and `error: { key: 'downloads.error.allMirrorsFailed' }`.
    - Assert the en sentence is shown and `downloads.error.unknown` is not.
  - In `docs/systems/install-module.md` ≈line 344, after "size-only check instead of sha256", add:
    a transport failure ends as "every download source failed", like a pinned download.

## Model Hints

- D5 → deliverable-hard. Moving `commitAdoption` into `failed()`'s path crosses three fragile
  invariants in `job.ts`:
  - `markAdoptionCommitted` must always resolve, or `startBootstrap` hangs.
  - A cancel must restore `previousFailure` instead of recording a new one.
  - `failed()`'s clean-up/record/validate order must hold for a run that copied nothing yet.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/cinema-controller.test.ts` › "set(true) after dispose opens
  nothing and pins nothing" (D1); unit `src/main/modules/replays/index.test.ts` › "disposing the
  module releases cinema and stage-follow listeners" (D1)
- AC2 → unit `src/main/services/update/service.actions.test.ts` › "quitAndInstall's quit runs
  through the held before-quit and state is on disk before the app exits" (D2)
- AC3 → unit `src/main/services/state.test.ts` › "a StateStore without migrations does not compile",
  "migrations 'none' is stated only by tests" (D3); unit `src/main/services/installations.test.ts` ›
  `setEngineState` tests moved from `record-engine-state.test.ts`, plus the D4 acceptance
  `rg "withEngineState|record-engine-state" src` empty (D4)
- AC4 → unit `src/main/modules/downloads/bootstrap/job.failure-and-retry.test.ts` › "a throw in
  commitAdoption ends the job failed with a cause and frees the installation" (D5)
- AC5 → unit `src/main/services/job-runner.test.ts` › "a job's state write is on disk when the job
  turns terminal", proven red with `await state?.settle()` removed and recorded in Done (D6)
- AC6 → unit `src/main/modules/downloads/engine/update-job.test.ts` › "a bleeding-edge transport
  failure ends as downloads.error.allMirrorsFailed" (D7); component
  `src/renderer/src/modules/downloads/components/FailureLogEntry.test.tsx` › "a failed bleeding-edge
  update shows the all-sources-failed sentence" (D7)
- No AC describes a user action on the real surface: all six are lifecycle and main-process
  behaviour, so `ui:flow` is not the level. The existing flows stay the regression net.

## Done
