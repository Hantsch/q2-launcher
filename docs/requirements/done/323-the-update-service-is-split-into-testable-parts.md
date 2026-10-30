---
id: 323
title: The update service is split into testable parts
status: in-progress # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

`createUpdateService` is a 480-line closure factory with 20 inner functions (TD-001); its keep and
cancel paths are untested, a LAN-mode watchlist recheck stays pending and concurrent catalog
fetches fetch twice (TD-020). Updates must behave exactly as today, with those gaps closed.

## Acceptance Criteria

- [x] **AC1** — No function in the update service is longer than 80 lines, and the factory has no
      more than five inner functions (TD-001).
- [x] **AC2** — The update job's keep and cancel paths each have a unit test (TD-020).
- [x] **AC3** — In LAN mode a watchlist recheck resolves instead of staying pending (TD-020).
- [x] **AC4** — Two catalog fetches started together cause one network fetch (TD-020).
- [x] **AC5** — The existing update flows pass unchanged.
- [x] **AC6** — Rows TD-001 and TD-020 are removed from `docs/TECH-DEBT.md`.

## Open Questions

## Decisions (Sprint)

- **TD-020 is fixed where it lives**, not in the update service: the "update job" is
  `src/main/modules/mods/update-job.ts`, the recheck is `servers/watchlist-service.ts`, the catalog
  fetch is `lib/content-repo.ts` — the S31 review's "unfixed minor points" name exactly those builds.
- **"Keep" and "cancel" are the backup-slot keep path and the abort path** of the mod update job,
  because the `keep` _policy_ already has a test ("keep leaves a changed file byte-for-byte…") while
  the slot kept after an incomplete rollback (`keepSlot`) and an aborted signal have none.
- **A LAN-mode recheck queries the online list** (`ScanStartOptions` gains `mode`, the watchlist
  passes `'online'`), because the watchlist only follows online servers and a LAN `'server'` round
  never feeds `onStage2Row` — a refusal would not make the recheck "resolve".
- **Concurrent fetches are joined in `CachedContentDocument.get()`**, because it is the one place
  both the mod catalog and the engines manifest fetch through; a `refresh: true` call joins a fetch
  already in flight, since that fetch is no older than the one it would start.
- **The split uses classes in their own files**, matching `CatalogService`/`CachedContentDocument`,
  because a second big closure factory would only move TD-001.
- **AC1 is enforced by oxlint `max-lines-per-function` (80, blank lines and comments skipped) plus a
  unit test counting the factory's inner functions**, because a code rule stays in `npm test`
  (story 279) and skipping comments keeps the invariant comments CLAUDE.md asks for.
- **The lint scope is `service.ts` and its new parts**, because `checker.ts` and `store.ts` are
  adapters TD-001 does not name.
- **The public surface is unchanged and the existing update tests are not edited**, because they
  are the regression proof for AC5.
- **Only the LAN recheck gets a changelog line**, because the split and the fetch join change
  nothing a user sees.

## Plan

1. **Split the update service (D1).** `createUpdateService` keeps signature and exports. Mutable
   state + `compose/publish/emit` → `UpdateStateCell` (`state.ts`); restore-once, 24h window,
   checker-with-timeout, attempt/join, persist → `UpdateChecks` (`check.ts`); download, cancel,
   install-and-restart, dismiss → `UpdateDownloads` (`download.ts`); `simulate` → `simulate.ts`.
   The factory builds these and returns their bound methods. oxlint override + structure test pin
   AC1.
2. **Mod update job tests (D2):** slot kept after an incomplete rollback; abort ends `cancelled`
   with old files and record intact. Tests only.
3. **Fetch join (D3):** single-flight in `CachedContentDocument.get()`; catalog-level test; one
   line in `docs/systems/mods-module.md`.
4. **LAN recheck (D4):** `ScanStartOptions.mode`; watchlist recheck passes `'online'`; unit tests,
   a step in the `servers-watchlist` flow, `servers-module.md`, changelog line.
5. **Tech debt (D5):** remove rows TD-001 and TD-020.

Order: D1–D4 are independent; D5 last.

## Deliverables

- **D1 — The update service is split into four parts.** Files:
  `src/main/services/update/service.ts` (keeps every current export — types, error/refusal keys,
  `resolveUpdatePhase`, `UpdateServiceOptions`, `UpdateService`, `createUpdateService`; importers
  `src/main/context.ts`, `src/main/error-keys.test.ts`, `src/main/ipc/update.test.ts`,
  `src/main/ipc/dev.test.ts` stay untouched), new `src/main/services/update/state.ts` (class
  `UpdateStateCell`: `facts`, `stage`, `progress`, `dismissed`, `downloadGeneration`,
  `cancelRequested`, `state`, `compose()`, `publish()`, `emit()`; plus `describeError`), new
  `check.ts` (class `UpdateChecks`: lazy default store, `ensureRestored`, 24h window test, checker
  race against the timeout, `runAttempt`, join-in-flight `beginAttempt`, `persist`, `getState`,
  `checkNow`, `scheduleStartupCheck`), new `download.ts` (class `UpdateDownloads`: `runDownload`,
  `startDownload`, `cancelDownload`, `installAndRestart`, `dismiss`), new `simulate.ts` (the six
  scenarios against the cell; it must still mark the restore as done before writing, as
  `restoring ??= Promise.resolve()` does today). Move existing comments with their code;
  `autoInstallOnAppQuit = false` is still set at construction and again in `startDownload`.
  `createUpdateService` has at most five inner functions and returns the parts' bound methods.
  Behaviour is identical: `service.test.ts` and `service.actions.test.ts` pass **without edits**.
  Enforcement: in `.oxlintrc.json` add an override, placed before the `**/*.test.ts` one, for
  exactly `service.ts`, `state.ts`, `check.ts`, `download.ts`, `simulate.ts` under
  `src/main/services/update/` with
  `"max-lines-per-function": ["error", { "max": 80, "skipBlankLines": true, "skipComments": true }]`;
  new `src/main/services/update/service.structure.test.ts` › "the update service factory has at
  most five inner functions" — reads `service.ts`, slices from `export function createUpdateService`
  to the next line that is exactly `}`, counts `function` keywords and `=>` tokens in the slice (all
  depths, so a nested closure counts too) and expects at most 5.
- **D2 — The mod update job's slot-keep and cancel paths are tested.** File:
  `src/main/modules/mods/update-job.test.ts` only, using its `harness()`, `slotLeft()`, `readTree()`,
  `records()`, `stagingLeft()` helpers and the `h.writeGuard.runWrite.mockImplementationOnce`
  pattern of "a mid-copy failure restores the backup and keeps the old record". New tests: "a
  rollback that cannot put a file back keeps the backup slot" (make one restore move fail so
  `onRestoreIncomplete` fires; expect `failed`, the slot still on disk holding that file, the old
  record kept) and "an update aborted mid-write ends cancelled with the old files and record"
  (abort the job's signal inside `runWrite`; expect `status: 'cancelled'`, the game dir equal to
  `OLD_FILES`, the record unchanged, slot and staging removed). If a path is unreachable as written,
  report it instead of changing `update-job.ts`.
- **D3 — Two catalog reads started together fetch once.** Files: `src/main/lib/content-repo.ts`
  (`CachedContentDocument.get()`: the fresh-cache early return stays first; the store-load + fetch
  - cache-fallback part runs as one in-flight promise that a second `get()` — with or without
    `refresh` — awaits instead of fetching; cleared in `finally`), test in
    `src/main/modules/mods/catalog-service.test.ts` › "two catalog reads started together cause one
    network fetch" (mirror the file's existing fetch stub; `Promise.all` of two `getCatalog()` on a
    cold service; one fetch, equal snapshots), `docs/systems/mods-module.md` (one sentence where the
    catalog is described: concurrent reads share one fetch).
- **D4 — A watchlist recheck in LAN mode resolves.** Files: `src/main/modules/servers/scan-service.ts`
  (`ScanStartOptions.mode?: ServersBrowseMode`; `start()` uses `options.mode ?? mode` as
  `sweepMode`, so the round runs, reports and writes on that list; update the header comment's
  "Two lists" paragraph), `src/main/modules/servers/watchlist-service.ts` (`recheck` passes
  `mode: 'online'`; widen the scan-service surface type it declares), tests
  `src/main/modules/servers/scan-service.lan-mode.test.ts` › "a server round started with mode
  online while LAN is active queries the online list and feeds the watchlist" and
  `src/main/modules/servers/watchlist-service.test.ts` › "a recheck asks for an online round
  whatever the active mode", `scripts/flows/servers-watchlist.mjs` (one step after the existing
  re-check steps: switch the browser to LAN, re-check the "rock" entry, its row leaves the pending
  state and shows its online match; switch back to Online), `docs/systems/servers-module.md`
  (a watchlist recheck always queries the online list), `CHANGELOG.md` `## Unreleased` ›
  `### Fixed`: "A watchlist re-check started while browsing LAN no longer stays pending."
- **D5 — Tech-debt rows closed.** File: `docs/TECH-DEBT.md` — delete rows TD-001 and TD-020,
  nothing else.

## Model Hints

- D1 → deliverable-hard: the shared mutable state (the restore-once promise `simulate` must
  pre-settle, the join-in-flight attempt, the download generation guard that drops late progress)
  is split across four files, and a reordering silently breaks a race the existing tests reach only
  through the public API.
- Review: → default

## Acceptance Tests

- AC1 → lint `npm run lint` (D1's oxlint `max-lines-per-function` override) + unit
  `src/main/services/update/service.structure.test.ts` › "the update service factory has at most
  five inner functions".
- AC2 → unit `src/main/modules/mods/update-job.test.ts` › "a rollback that cannot put a file back
  keeps the backup slot" and › "an update aborted mid-write ends cancelled with the old files and
  record".
- AC3 → unit `src/main/modules/servers/watchlist-service.test.ts` › "a recheck asks for an online
  round whatever the active mode" and `src/main/modules/servers/scan-service.lan-mode.test.ts` › "a
  server round started with mode online while LAN is active queries the online list and feeds the
  watchlist"; e2e `scripts/flows/servers-watchlist.mjs` › flow `servers-watchlist` (D4's LAN
  re-check step).
- AC4 → unit `src/main/modules/mods/catalog-service.test.ts` › "two catalog reads started together
  cause one network fetch".
- AC5 → existing unit `src/main/services/update/service.test.ts` and
  `src/main/services/update/service.actions.test.ts` (unedited by D1); e2e
  `scripts/flows/app-update.mjs` › flow `app-update` and `scripts/flows/mod-update.mjs` › flow
  `mod-update` (D3 changes the catalog read it uses).
- AC6 → doc check by D5: `grep -n "TD-001\|TD-020" docs/TECH-DEBT.md` returns nothing (recorded in
  Done).

## Done

Split `createUpdateService` into `UpdateStateCell` / `UpdateChecks` / `UpdateDownloads` / `simulate` (factory: one inner function); oxlint `max-lines-per-function` override plus a structure test pin AC1. TD-020 fixed where it lives: slot-keep and abort tests for the mod update job, LAN recheck queries the online list (`ScanStartOptions.mode`), `CachedContentDocument.get()` single-flights concurrent fetches.

Commit message: `323: update service split into state/checks/downloads/simulate, update-job keep/cancel tests, LAN watchlist recheck resolves, concurrent catalog fetches joined, TD-001/TD-020 closed`

Verification (narrow gate): typecheck, lint, build + build:dev, `npx vitest run --changed HEAD` (38 files / 543 tests), `npm run check:docs` green; e2e `npm run ui:flows -- --affected scripts/flows/servers-watchlist.mjs scripts/flows/app-update.mjs scripts/flows/mod-update.mjs --parallel=4 --shard=1/2` and `2/2` green (30/30 flows). Review (default stage): PASS.
AC → test: AC1 lint + `service.structure.test.ts`; AC2 the two `update-job.test.ts` tests; AC3 `watchlist-service.test.ts`, `scan-service.lan-mode.test.ts`, flow `servers-watchlist`; AC4 `catalog-service.test.ts`; AC5 `service.test.ts` + `service.actions.test.ts` unedited, flows `app-update`, `mod-update`; AC6 `grep -n "TD-001\|TD-020" docs/TECH-DEBT.md` returns nothing. No manual residue.

Decisions:

- The abort test cancels through `h.jobs.cancel(jobId)` inside `runWrite` (the job's signal is not reachable from `runWrite`'s args); `update-job.ts` untouched.
- The flow's LAN step resets "rock" to `found` first, because the preceding step leaves it `left`.
- Unfixed minor findings: service.ts and the part files import values from each other (lazy, method-only use; no cycle lint rule guards it); moved comments keep their `Story 097/098:` prefixes from before the split; D3 has no test for `refresh: true` joining an in-flight fetch or a shared failed fetch.

tiers: D 5 / hard 1 · review default · cycles 0 · agents 7
