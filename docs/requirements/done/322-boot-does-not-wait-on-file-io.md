---
id: 322
title: Boot does not wait on file I/O, and a failed module has no live handlers
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Overdue rows TD-002, TD-003, TD-012 and TD-016 concern how main starts and what modules can reach.
Boot blocks on config file I/O; a module whose setup throws still answers IPC; optional deps that
exist only for tests weaken production guards; a handler can see a mid-session unlock early; two
helpers have no caller.

## Acceptance Criteria

- [x] **AC1** — The window shows without waiting on config file reads; a slow config read does not
      delay first paint (TD-002).
- [x] **AC2** — A module whose setup throws has none of its invoke channels answering; a call
      returns the module-unavailable refusal (TD-002).
- [x] **AC3** — Production service factories take their dependencies as required; no production
      guard checks for an optional test-only dependency (TD-003).
- [x] **AC4** — Handlers read unlock state only through the frozen `features` gate; `AppContext`
      no longer exposes the live `unlock` service to them (TD-016).
- [x] **AC5** — `dedupeByKey` and `toastRefusal` have a production caller or are deleted (TD-012).
- [x] **AC6** — Rows TD-002, TD-003, TD-012 and TD-016 are removed from `docs/TECH-DEBT.md`.

## Open Questions

## Decisions (Sprint)

- AC1's "config file reads" are everything `createAppContext` awaits (`state.json`, `unlock.init()`, module setups); the window-state read in `createMainWindow` stays before `new BrowserWindow`, because it is the window's own geometry and tiny, not config.
- The window opens early by binding every contract channel to `ipcMain` at boot with a dispatcher that holds an invoke until `registerAllIpc` has run; the renderer is unchanged, because its invokes simply resolve later instead of failing with "no handler".
- If `createAppContext` rejects, held and later invokes reject with the existing `ipc.error.handlerFailed` and boot logs the error, because the window now exists and must not hang silently.
- AC2's refusal is a new key `modules.error.unavailable` with `{ moduleId }`, answered for every type of a module whose setup threw; handlers are staged and committed only when `setup()` resolves, because partial handlers are exactly the live-handler leak; disposers keep today's behaviour.
- AC3 covers the seven optional fields production always supplies: `InstallationsService` `userDataDir`/`homeDir`, config `sync.ts` `canonicalWriteAllowed`/`canonicalMoveAllowed`/`switchBindFor`, cinema-controller `raiseOverlay`, main-window-observer `onListenerError`; `demo-play` deps (`playback`, `cvarRestore`, ...) and `LaunchService.detectRunners` stay optional, because their absence is a documented behaviour or an injection seam, and playback overlaps story 326.
- The seven `new InstallationsService(` test sites go through one new builder in `src/test-support/installations.ts`, because adding two required fields to seven hand-written copies is the third-copy case refine forbids.
- AC4 removes `unlock` from `AppContext`; `createAppContext` returns the `UnlockService` beside the context and only `registerUnlockIpc` receives it, because the redeem panel is the one legitimate live reader and modules must see only the frozen `features` gate.
- AC5: `toastRefusal` already has a production caller (`DemoRowMenu.tsx`), so TD-012 is stale for it and it stays; `dedupeByKey` is deleted with its test, because no production site is a drop-in for it.
- `scripts/tech-debt.test.mjs` pins the first six rows to F34/F49/F63/F67/F69/F75, which this story and 324/326 all break; it becomes the invariant "every row sourced from the codebase review names a finding the review left out of stories", because that is what the pin meant and it survives row removals.
- No `docs/systems/` doc covers boot or the module host; `docs/ARCHITECTURE.md` (module host section, ~lines 75-107 and 336) is the doc D2/D3 update.
- CHANGELOG gets one `### Changed` line ("The launcher window appears right away, before settings finish loading."), because faster first paint is user-visible; the other items are internal.

## Plan

1. D1 — `src/main/ipc/index.ts`: bind every contract channel at boot; invokes wait for a ready gate.
2. D2 — boot reorder: window (harness/env/broadcast only) created concurrently with `createAppContext`;
   `registerAllIpc` then opens the gate. Orchestrator extracted to `src/main/boot.ts` so it is testable.
3. D3 — module registry stages handlers and refuses a failed module with `modules.error.unavailable`.
4. D4 — `InstallationsService` deps required + test-support builder.
5. D5 — remaining optional test-only deps required (config sync, cinema-controller, window observer).
6. D6 — `unlock` leaves `AppContext`; only the unlock registrar gets the service.
7. D7 — delete `dedupeByKey`; remove TD-002/003/012/016 rows; tech-debt test pin → invariant.

Order: D1 before D2; D6 after D2 (both touch `context.ts`/`index.ts`); D3, D4, D5, D7 independent.

## Deliverables

- [x] **D1 — IPC channels are bound before their handlers exist.** In `src/main/ipc/index.ts`, add
      `bindAllChannels()` (called once at boot, before the window loads) that calls `ipcMain.handle`
      for every invoke channel of the contract (`src/shared/ipc.ts`, the same list
      `assertContractFullyHandled()` uses) with a dispatcher; `register()` now fills a handler table
      instead of calling `ipcMain.handle`. Add `markIpcReady()` / `markIpcFailed(error)`: an invoke
      arriving before ready waits on the gate, then runs the registered handler; after ready, a
      channel with no handler (a dev-only channel in a prod build) rejects as an unhandled channel
      would; after failure every invoke rejects with `ipc.error.handlerFailed`. Keep the
      double-registration throw, payload validation and the startup count unchanged. Tests in
      `src/main/ipc/index.test.ts`: "an invoke sent before the handlers exist is answered once they
      are registered", "an invoke held at boot is refused with handlerFailed when boot fails".
- [x] **D2 — the window opens before the app context is built.** New `src/main/boot.ts` exporting
      `boot(steps)` with injected steps (`bindIpc`, `createShell` → `{ harness, env, broadcast }`,
      `createWindow(shell)`, `createContext(shell)`, `registerIpc(context)`, `markReady`,
      `markFailed`): binds IPC, builds the shell, then runs `createWindow` and
      `createContext → registerIpc → markReady` concurrently (context rejection → `markFailed` +
      `log.error`). `src/main/index.ts` `bootstrap()` calls it with the real steps (IPC functions from
      D1); revalidation and the 3 s update kick run after the context resolves; `activate` and
      `second-instance` keep working. `src/main/window.ts` `createMainWindow` takes
      `Pick<AppContext, 'env' | 'harness' | 'broadcast'>` instead of `AppContext`.
      `src/main/context.ts` `createAppContext` takes the `Broadcaster` and harness from the shell
      instead of creating them. Update the boot/IPC paragraphs of `docs/ARCHITECTURE.md` and add the
      CHANGELOG `### Changed` line "The launcher window appears right away, before settings finish
      loading." under `## Unreleased`. Tests in `src/main/boot.test.ts`: "the window is created
      before a slow state read finishes", "a failed context marks IPC failed and still leaves the
      window".
- [x] **D3 — a module whose setup throws has no live handlers.** `src/main/modules/registry.ts`:
      `handle` writes into a per-registration staging map, merged into `this.handlers` only after
      `setup()` resolves; on a throw the module id goes into a `failed` set and `invoke()` answers
      any request for that `moduleId` with `fail('modules.error.unavailable', { moduleId })`
      (checked before the unknown-type path). Disposers unchanged. Add the key to
      `src/renderer/src/i18n/locales/en.shell.json` next to `modules.error.notImplemented` and
      refresh `src/renderer/src/i18n/__snapshots__/en.bundle.json`. Update the module-host part of
      `docs/ARCHITECTURE.md` (failed setup → unavailable). Test in
      `src/main/modules/registry.test.ts` (reuse `fakeAppContext()` as 'disposers registered before
      setup() throws still run' does): "a module whose setup throws answers every invoke with
      modules.error.unavailable", including a handler it registered before the throw.
- [x] **D4 — `InstallationsService` takes its paths as required.**
      `src/main/services/installations.ts`: `userDataDir` and `homeDir` become required, the `?? ''`
      fallbacks go. New `src/test-support/installations.ts` exporting
      `makeInstallationsService(overrides)` (defaults for both paths plus whatever the call sites
      share); use it at the seven test sites: `src/main/services/installations.test.ts`,
      `src/main/services/installation-icons.test.ts`,
      `src/main/modules/downloads/bootstrap/job.test-helpers.ts`,
      `src/main/modules/downloads/engine/rollback-job.test.ts`,
      `src/main/modules/downloads/engine/update-job.test.ts`,
      `src/main/modules/downloads/repair/job.test.ts`,
      `src/main/modules/downloads/retail/upgrade-job.test.ts`. Proof: `npm run typecheck` and those
      tests green.
- [x] **D5 — the remaining test-only optional deps become required.** Make required and drop the
      guards: `src/main/modules/config/sync.ts` `canonicalWriteAllowed` (guard ~:283),
      `canonicalMoveAllowed` (~:301), `switchBindFor` (`?.` ~:460);
      `src/main/modules/replays/cinema-controller.ts` `raiseOverlay` (~:124);
      `src/main/main-window-observer.ts` `onListenerError` (~:58). Supply them in
      `src/main/modules/config/sync.test.ts`, `src/main/modules/config/profile-writes.sync.test.ts`,
      `src/main/modules/config/profile-writes.raw-save.test.ts`,
      `src/main/modules/replays/cinema-controller.test.ts`, `src/main/main-window-observer.test.ts`
      (one shared default deps object per file, no per-test copies). Do not touch `demo-play.ts` or
      `LaunchService`. Proof: `npm run typecheck` and those tests green.
- [x] **D6 — handlers cannot reach the live unlock service.** Remove `unlock` from `AppContext`
      (`src/main/context.ts`); `createAppContext` returns `{ context, unlock }`;
      `registerAllIpc(context, unlock)` in `src/main/ipc/index.ts` passes it only to
      `registerUnlockIpc(unlock)` (`src/main/ipc/unlock.ts`); `features` stays the only unlock view on
      the context. Update the wiring in `src/main/index.ts` / `src/main/boot.ts`,
      `src/test-support/app-context.ts`, `src/main/ipc/unlock.test.ts` (build the registrar with the
      service directly) and `docs/systems/unlock-codes.md` if it names the field. Proof:
      `npm run typecheck`; the existing `src/main/ipc/unlock.test.ts` cases green.
- [x] **D7 — dead helper gone, debt rows closed.** Delete `dedupeByKey` from
      `src/main/lib/forgiving.ts` and its test in `src/main/lib/forgiving.test.ts`; leave
      `toastRefusal` (it has a caller in `DemoRowMenu.tsx`). Remove rows TD-002, TD-003, TD-012 and
      TD-016 from `docs/TECH-DEBT.md` (touch no other row; other sprint stories remove theirs). In
      `scripts/tech-debt.test.mjs` replace the pinned first-six-rows assertion with "every row sourced
      from the codebase review names a finding the review left out of stories": parse the F-ids from
      the `Left out of stories on purpose:` paragraph of
      `docs/reviews/2026-10-01-codebase-review.md` and assert each review-sourced row's F-id is among
      them. Proof: `npx vitest run scripts/tech-debt.test.mjs`, `npm run lint`, `npm run typecheck`.

## Model Hints

- D2 → deliverable-hard: running window creation concurrently with context creation can break a late
  binding (`getMainWindow`, `activate`, `second-instance`, a broadcast before the window exists) or
  hold an invoke forever on a failed context — a regression on every launch that only the ui flows
  would show.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/boot.test.ts` › "the window is created before a slow state read finishes";
  unit `src/main/ipc/index.test.ts` › "an invoke sent before the handlers exist is answered once they
  are registered". The real boot stays covered by `npm run ui:verify`. There is no user action here,
  so no new flow.
- AC2 → unit `src/main/modules/registry.test.ts` › "a module whose setup throws answers every invoke
  with modules.error.unavailable"
- AC3 → `npm run typecheck`: the deps are required, so every construction site compiles only when it
  supplies them. The existing tests of D4/D5's files show behaviour is unchanged.
- AC4 → `npm run typecheck` (`AppContext` has no `unlock`); unit `src/main/ipc/unlock.test.ts` › "a
  valid code resolves with its features, expiry and label", run through the new registrar signature.
- AC5 → existing unit `src/renderer/src/lib/toast.test.ts` covers `toastRefusal`, whose production
  caller is `DemoRowMenu.tsx`. `npm run typecheck` + `npm run lint` with no remaining reference prove
  `dedupeByKey` is gone.
- AC6 → unit `scripts/tech-debt.test.mjs` › "checkTechDebt accepts a well-formed row and rejects a malformed one" (the invariant test named here was dropped: the pinned-rows assertion it replaced was already removed by story 279) and the row removal is read from `docs/TECH-DEBT.md` through `npm run check:docs`.
  finding the review left out of stories" and › "checkTechDebt accepts the real file and rejects a
  malformed row".

## Done

The window now opens while the app context is still being built: every contract channel is bound at boot and invokes wait on a ready gate (`src/main/boot.ts`, `ipc/index.ts`). A module whose setup throws answers `modules.error.unavailable` and none of its staged handlers go live. Seven test-only optional deps are required, `unlock` left `AppContext`, `dedupeByKey` is gone, TD-002/003/012/016 are closed.

Commit message: `322: window opens before app context (IPC gate), failed module refuses invokes, required deps, unlock off AppContext, dedupeByKey and TD rows removed`

Verification (narrow gate): `npm run build`, `typecheck`, `lint` green; `npx vitest run --changed HEAD` green (250 files, 2922 tests); `npm run ui:verify` green after `npm run build:dev` (116 shots, 0 unreachable, exit 0; the first run used a stale dev build). Review: clean agent, PASS, 1 cycle. AC1 boot.test.ts + ipc/index.test.ts; AC2 registry.test.ts; AC3/AC5 typecheck + lint; AC4 typecheck + unlock.test.ts; AC6 tech-debt.test.mjs + check:docs (green). No manual residue.

Decisions:

- AC6's invariant test was not written: story 279 already removed the pinned-rows assertion, so there was nothing to replace.
- `AppShell`/`createAppShell` added to `context.ts` so window and context share one harness/env/broadcaster.
- Six registrar tests in `src/main/ipc/` follow the new mechanism through `src/test-support/ipc.ts` (`bindRegisteredChannels`); `registerAllIpc` gets the unlock service as 2nd argument.
- Noted, not fixed: a failed context leaves the window open with refused invokes and only a log line (no user-visible message); a `handle()` after `setup()` resolves is dropped.

tiers: D 7 / hard 1 · review default · cycles 1 · agents 11
