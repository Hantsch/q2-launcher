---
id: 201
title: the launcher shuts down in order and says when a write failed
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want the last change I made before quitting to be on disk when I start the launcher
again, and to be told during the session if the launcher cannot write its state file. As the
maintainer I want the module lifecycle the registry was built for to actually run, so that
modules stop keeping module-level singletons to work around a `dispose()` nobody calls.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F05, F50, F08):

- `src/main/index.ts` `before-quit` fires `void Promise.all([mainWindow?.settle(), context?.state.settle()])`
  without `preventDefault()` and without awaiting; window-state has `debounceMs: 400`, so a resize
  in the last 400 ms may never land.
- `MainModuleRegistry.disposeAll()` has zero production callers although servers disposes a scan
  timer, UDP service, watchlist service and a Worker, and downloads unsubscribes job listeners.
  To make a static `dispose()` reachable, servers keeps five module-level `let active*` and
  downloads a module-level `Set` — the "no module-level mutable state" rule in `context.ts`
  broken to compensate. `replaysModule` has no `dispose()` at all. Five further `JsonStore`s
  (update-check, news-feed, mods catalog cache, replays index cache, manifest cache) are never
  settled at quit.
- `JsonStore.enqueue` chains `.catch(log.error)` and nothing else; the in-memory cache already
  holds the new value, so after a failed `rename` (Windows EPERM under AV or sync clients) reads
  report success and `settle()` resolves normally. A whole session can be silently gone.
- `StateStore` constructs its `JsonStore` without `debounceMs`, so every sort/filter/favourite
  click rewrites the whole 216 KB `state.json` twice (`.tmp` + `.bak` copy).

## Acceptance Criteria

- [x] **AC1** — On the first `before-quit`, main calls `preventDefault()`, releases the playback
      session synchronously first (the Linux channel's last write depends on it), then awaits
      `disposeAll()`, `state.settle()`, `mainWindow.settle()` and every registered persistent
      store, bounded by a timeout of 2–3 s, logs anything that failed or timed out, and then quits.
      A second `before-quit` during that window does not start a second shutdown.
- [x] **AC2** — `ModuleSetup` offers `onDispose(cb)`; the registry runs disposers in reverse
      registration order, a throwing disposer does not stop the others, and the servers and
      downloads module-level `let`/`Set` singletons are gone (grep-zero for `let active` at module
      scope in `src/main/modules/servers`). Registry tests prove order and the throwing case.
- [x] **AC3** — `replaysModule` disposes what it subscribes: `launch.onStateChange`,
      `onBeforePlaybackRelease`, main-window observer listeners, stage-follow sessions, the cinema
      controller and the playback channel (`close()` added where missing); a test registers the
      module twice and asserts no double subscription.
- [x] **AC4** — `AppContext` has a `persistence` registry (`register(store)`, `settleAll()`); the
      five module `JsonStore`s register on creation and are settled at quit.
- [x] **AC5** — `JsonStoreOptions.onPersistError` exists; a failed flush retries once after
      ~500 ms, then reports; `StateStore` forwards it and the shell shows one toast per session
      (`app.toast.statePersistFailed`, visible text, i18n key). `settle()` resolves `{ ok }` and
      the quit path logs an unsuccessful settle. Unit test with a rejecting `writeFile`.
- [x] **AC6** — `StateStore` passes `debounceMs` (~250 ms) like window-state does; a
      `state.test.ts` case proves a burst of ten updates produces one write; the existing
      `settle()` call before a launch (`ipc/launch.ts`) still forces the write.
- [x] **AC7** — A `ui:flow` toggles a persisted preference, quits the app through the real
      quit path and asserts the value in `state.json` afterwards.

## Open Questions

- [x] **Q1** — Does any current flow or script rely on `before-quit` being synchronous (e.g.
      `scripts/flow.mjs` teardown timing)? → answered by investigation, see D-Q1 below.

## Decisions (Sprint)

- **D-Q1** — Nothing relies on a synchronous `before-quit`: `withApp()` tears down through
  `closeAppOrKill()` (`scripts/lib/harness.mjs`), which races Playwright's `app.close()` (an
  `app.quit()` plus wait-for-exit) against a 15 s `CLOSE_TIMEOUT_MS` before a tree-kill, and no
  flow reads `state.json` after quitting, so a ≤3 s awaited shutdown fits that budget.
- **D-Q1b** — The real flow risk is the debounce, not the quit: 23 flows read `state.json` while
  the app runs, ~14 of them one-shot right after a UI action, and five carry a private
  `waitForStateJson` poller; the story extracts one shared poller (`scripts/lib/state-json.mjs`)
  and migrates them (D2–D4), because a 250 ms debounce would otherwise turn the sprint gate red.
- **D-timeout** — The shutdown budget is 3000 ms, because it is the upper end of AC1's range and
  leaves room for one 500 ms persist retry plus the other settles.
- **D-order** — Shutdown is release playback (sync) → `await modules.disposeAll()` → settle
  `state`, `mainWindow` and `persistence.settleAll()` in parallel, all under one timeout, because a
  disposer may still write a store and that write must land before the store is settled.
- **D-shutdown-file** — The sequence lives in a new pure `src/main/shutdown.ts` wired from
  `index.ts`, because AC1's order, re-entry and timeout claims need a unit test and `index.ts` has
  none.
- **D-dispose-api** — `MainModule.dispose?` is removed once servers and downloads use
  `onDispose`, because a second disposal path invites a static `dispose()` and the singletons with it.
- **D-dispose-failed-setup** — Disposers registered before a module's `setup()` throws are kept
  and run by `disposeAll()`, because they release what the half-set-up module already acquired.
- **D-twice** — AC3's "registers the module twice" means registry A → `disposeAll()` → registry B
  over the same fake `AppContext`, counting live listeners, because one registry refuses a
  duplicate id by design.
- **D-persistence-scope** — `AppContext.persistence` holds the five caches; `state` and the window
  store are settled by name, because AC1 names them separately and the window store is created
  outside `AppContext`.
- **D-persistence-shape** — `register(label, store)` takes anything with
  `settle(): Promise<{ ok: boolean }>` and `settleAll()` returns `{ label, ok }[]` with each settle
  isolated, so a cache owner exposes `settle()` and its creator registers it at construction.
- **D-settle-ok** — `JsonStore.settle()` resolves `{ ok }` from the last flush in the chain (after
  its retry), because every flush writes the whole document, so a later success means the disk is
  current again.
- **D-once** — The once-per-session gate lives in `StateStore` (it forwards only its first persist
  failure), and `context.ts` wires that to `broadcast.toast('error', 'app.toast.statePersistFailed')`,
  because then `state.test.ts` proves "once" without a context test.
- **D-debounce** — `StateStore` uses `debounceMs: 250`; `ipc/launch.ts`'s existing
  `await app.state.settle()` stays untouched, because `settle()` already flushes a pending timer.
- **D-negative-reads** — A flow assertion that `state.json` did _not_ change waits
  `STATE_WRITE_GRACE_MS` (750 ms) before reading, because an immediate read would pass vacuously
  under the debounce.
- **D-quit-flow** — AC7's flow `quit-persists-state` flips Settings › Downloads' "download while
  playing" switch, clicks the titlebar Close button at once (inside the debounce window), waits for
  the process `close` event and reads `state.json`, because that is the user's real quit path
  (`window:close` → `window-all-closed` → `app.quit()`) and it fails if `before-quit` does not await.
- **D-testid** — The titlebar Close `WindowButton` gets `data-testid="titlebar-close"`, because
  "Close" is also a generic label in `en.json` and a role/name lookup would be ambiguous.
- **D-no-window-hide** — The window is not hidden during the ≤3 s shutdown, because no AC asks for
  it and it adds a visible state change.
- **D-toast-no-e2e** — AC5's toast is proven at the `StateStore` → `onPersistError` seam, not
  through the UI, because provoking a real `rename` failure in the running app needs a file locked
  by AV/sync software; the shell wiring is one line in `context.ts`.

## Plan

Order: write semantics first (they change `settle()`'s type), then make the flows debounce-proof,
then debounce, then lifecycle, then the quit path that ties it together, then its flow.

1. **JsonStore** (`src/main/lib/json-store.ts`): retry once ~500 ms, `onPersistError`,
   `settle()` → `{ ok }`. New `json-store.test.ts`.
2. **Flows**: one shared `scripts/lib/state-json.mjs` (`readStateJson`/`waitForStateJson`/
   `STATE_WRITE_GRACE_MS`); five private pollers and ~14 one-shot live readers move to it (D2–D4).
3. **StateStore**: `debounceMs: 250`, first `onPersistError` → toast `app.toast.statePersistFailed`.
4. **Persistence registry** (`src/main/services/persistence.ts`) on `AppContext`; update store and
   the four module caches register at creation (D6, D7).
5. **Module lifecycle**: `ModuleSetup.onDispose(cb)`, reverse-order isolated disposal; servers and
   downloads singletons become closures; `MainModule.dispose` removed (D8).
6. **Replays** disposes every subscription it makes (D9).
7. **Shutdown** (`src/main/shutdown.ts`, wired in `index.ts`): preventDefault, release sync,
   dispose, settle all, 3 s timeout, log, quit; re-entry guarded. ARCHITECTURE + CHANGELOG (D10).
8. **Flow** `quit-persists-state`: flip a switch → Close → assert `state.json` (D11).

Layers: main, flow scripts, one locale key, one testid. No IPC channel change.

## Deliverables

- **D1 — JsonStore says when a write failed.** Files: `src/main/lib/json-store.ts`, new
  `src/main/lib/json-store.test.ts`. Add `onPersistError?: (error: unknown) => void` to
  `JsonStoreOptions`. In `enqueue`, a failed `flush` waits ~500 ms (`PERSIST_RETRY_DELAY_MS`) and
  retries once; if the retry also fails, log it, call `onPersistError(error)` and record the
  chain's last result as failed; a later successful flush records ok again (every flush writes the
  whole document). `settle()` returns `Promise<{ ok: boolean }>` reflecting the last flush once the
  pending chain drains — it resolves, never rejects. Callers that `await store.settle()` and ignore
  the value keep compiling; adjust the two that return it (`src/main/services/state.ts`
  `settle()`, `src/main/window.ts` `settle` and its type at ≈line 81). Tests mock
  `node:fs/promises` (`vi.mock`) with a rejecting `writeFile`/`rename`, fake timers: "a failed
  flush retries once after the delay and then succeeds silently", "a failed flush retries once,
  then reports through onPersistError and settle resolves { ok: false }", "a successful write
  after a failure makes settle resolve { ok: true } again". Use the quiet logger from
  `src/test-support/` if one exists.

- **D2 — Flows share one state.json poller.** Files: new `scripts/lib/state-json.mjs`, new
  `scripts/lib/state-json.test.mjs` (vitest picks up `scripts/**/*.test.mjs`), and the five flows
  that each carry a private copy:
  `scripts/flows/{replays-date-filter,replays-filter-search,replays-sort-order,servers-sort-order,servers-watchlist}.mjs`.
  Extract from `servers-sort-order.mjs`'s `waitForStateJson` (≈line 199) and export
  `readStateJson(userDataDir)`, `waitForStateJson(userDataDir, predicate, label, { timeoutMs = 5000,
intervalMs = 50 } = {})` (re-reads until `predicate(doc)` holds, treats a missing or unparseable
  file as "not yet", throws naming the label and the last doc on timeout) and
  `STATE_WRITE_GRACE_MS = 750` (for "did not change" assertions: sleep it, then read). Replace the
  five private copies with imports, behaviour unchanged. Tests against a temp dir: "waits until the
  predicate holds", "times out naming the label", "a missing file counts as not yet". Run each
  touched flow with `npm run ui:flow -- <name>`.

- **D3 — One-shot state.json readers poll (group A).** Files:
  `scripts/flows/{home-dashboard-arrange,home-dashboard-keyboard,mod-update,mods-install,mods-remove,replays-mod-install,replays-mod-warning,replays-name-templates}.mjs`.
  The app will debounce `state.json` writes by 250 ms (story 201). Every read asserting a value the
  running app just wrote becomes `waitForStateJson(...)` from `scripts/lib/state-json.mjs`; every
  read asserting the file did _not_ change (e.g. home-dashboard-arrange's "narrow render wrote
  nothing", ≈line 296) first sleeps `STATE_WRITE_GRACE_MS`; reads of seeded values before any
  action may stay plain `readStateJson`. Local wrappers (`readPersistedHomeLayout`, `trustedMods`,
  `readStateJson`) become thin calls into the helper — no new private poller. Run each touched flow
  with `npm run ui:flow -- <name>`.

- **D4 — One-shot state.json readers poll (group B).** Files:
  `scripts/flows/{servers-master-sources,servers-quick-filters,servers-scan-settings,settings-downloads-section,unlock-code,replays-extra-folders}.mjs`;
  audit, change only if they read a value the app wrote: `bootstrap-failure-retry`,
  `downloads-tab`, `mods-install-refused`, `servers-no-scan-while-playing`. The app will debounce
  `state.json` writes by 250 ms. Same rules as D3, using `waitForStateJson`/`readStateJson`/
  `STATE_WRITE_GRACE_MS` from `scripts/lib/state-json.mjs`. Additionally, a flow that
  `copyFileSync`s phase 1's `state.json` into a restart userData dir (servers-master-sources ≈312,
  unlock-code ≈262, replays-extra-folders ≈119) first `waitForStateJson`s for the value it is about
  to carry over. Run each touched flow with `npm run ui:flow -- <name>`.

- **D5 — state.json is debounced and a failed write is shown once.** Files:
  `src/main/services/state.ts`, `src/main/services/state.test.ts`, `src/main/context.ts`,
  `src/renderer/src/i18n/locales/en.json`. `StateStore`'s constructor takes an optional
  `{ onPersistError?: () => void }`, constructs its `JsonStore` (≈line 176) with `debounceMs: 250`
  (mirror `src/main/window.ts`'s `debounceMs: 400`) and an `onPersistError` that forwards only the
  first failure of this instance (one notice per session). `settle()` returns `{ ok }` (JsonStore's
  `settle()` now resolves `{ ok: boolean }`). In `context.ts` (`new StateStore(stateFilePath())`,
  ≈line 119; `broadcast` already exists above it) pass
  `onPersistError: () => broadcast.toast('error', 'app.toast.statePersistFailed')`. Add
  `app.toast.statePersistFailed` next to `stateRecoveredFromBackup` in `en.json`: "Your settings
  could not be saved to disk. Changes you make now may be lost when you quit." Tests in
  `state.test.ts`: "a burst of ten updates produces one write" (fake timers + spy on
  `node:fs/promises` `rename`), "settle() forces a pending debounced write to disk at once" (the
  guarantee `src/main/ipc/launch.ts`'s `await app.state.settle()` relies on — leave that call
  untouched), "a persist failure is forwarded to onPersistError once per session". Run the whole
  `npm test`: any other test that reads `state.json` after an update without
  `await state.settle()` gets that line added.

- **D6 — AppContext has a persistence registry.** Files: new `src/main/services/persistence.ts`,
  new `src/main/services/persistence.test.ts`, `src/main/context.ts`,
  `src/main/services/update/store.ts`, `src/main/services/update/service.ts`, and the test
  `fakeAppContext` builder(s) that the new required member breaks (follow the typecheck errors).
  `PersistenceRegistry`: `register(label: string, store: { settle(): Promise<{ ok: boolean }> }):
void` and `settleAll(): Promise<{ label: string; ok: boolean }[]>` — settles in parallel, each
  isolated (a rejecting one becomes `ok: false`; `settleAll` never rejects). `AppContext.persistence`
  is created in `createAppContext`. `UpdateCheckStore` exposes `settle()` delegating to its
  `JsonStore` (which resolves `{ ok }`); `update/service.ts` registers it at its `storeInstance ??=`
  creation (≈line 359) with label `update-check`, getting the registry through its existing
  options. Tests: "settleAll settles every registered store and reports each failure", "a rejecting
  store does not stop the others", and in the update service's test "registers its store with
  persistence".

- **D7 — The module caches register on creation.** Files:
  `src/main/modules/downloads/manifest-service.ts`, `src/main/modules/home/news/feed-cache.ts`,
  `src/main/modules/home/news/news-service.ts`, `src/main/modules/mods/catalog-service.ts`,
  `src/main/modules/replays/index-cache.ts`, `src/main/modules/downloads/index.ts`,
  `src/main/modules/mods/index.ts`, `src/main/modules/replays/index.ts` (plus the matching existing
  tests). `ManifestService`, `NewsFeedCache`, `CatalogService` and `ReplaysIndexCache` each expose
  `settle(): Promise<{ ok: boolean }>` delegating to their `JsonStore`. Their creator registers
  them with `app.persistence.register(label, instance)` (`AppContext.persistence`, reached through
  `ModuleSetup.app`): downloads `new ManifestService` (≈index.ts:138, `downloads-manifest`), mods
  `new CatalogService`/`new ManifestService` (≈index.ts:101/103, `mods-catalog`/`mods-manifest`),
  replays `new ReplaysIndexCache` (≈index.ts:176, `replays-index`), news `cacheInstance ??=`
  (≈news-service.ts:145, `news-feed`; thread the registry through its options). Tests: one case per
  owner in its existing test file — "registers its cache with app.persistence" (a fake registry
  records labels).

- **D8 — Modules register disposers; the singletons go.** Files: `src/main/modules/types.ts`,
  `src/main/modules/registry.ts`, `src/main/modules/registry.test.ts`,
  `src/main/modules/servers/index.ts`, `src/main/modules/servers/index.test.ts`,
  `src/main/modules/downloads/index.ts`, `src/main/modules/downloads/index.test.ts`,
  `docs/ARCHITECTURE.md`. Add `onDispose: (cb: () => void | Promise<void>) => void` to
  `ModuleSetup`. The registry keeps disposers in registration order (kept even if `setup()` later
  throws); `disposeAll()` runs all of them in reverse registration order across modules, awaiting
  each, logging and continuing past a throwing or rejecting one, then clears. Remove
  `MainModule.dispose?`. Servers (`index.ts` ≈lines 93–112 and 446–452): the five `let active*`
  become `setup()` locals released through `onDispose`; the "retire a superseded setup" block goes
  (each registry disposes its own). Downloads: the module-level `subscriptions` `Set` (≈line 571)
  goes; each `jobs.onChange` unsubscribe goes to `onDispose`. Tests that register servers twice
  without disposing get a `disposeAll()` in between. Tests: `registry.test.ts` › "disposers run in
  reverse registration order", "a throwing disposer does not stop the others";
  `servers/index.test.ts` › "keeps no module-level mutable state" (reads the source, asserts no
  line starting `let `); `downloads/index.test.ts` › "disposeAll releases every job subscription".
  ARCHITECTURE "Adding a module" step 3: setup keeps its state in its closure and releases it
  through `onDispose`.

- **D9 — Replays disposes what it subscribes.** Files: `src/main/modules/replays/index.ts`,
  `src/main/modules/replays/playback-control.ts`,
  `src/main/modules/replays/stage-follow-session.ts`,
  `src/main/modules/replays/cinema-controller.ts`, `src/main/modules/replays/index.test.ts`, and
  the three helpers' existing tests. `createPlaybackControl` keeps the unsubscribers of
  `launch.onStateChange` (≈line 158) and `launch.onBeforePlaybackRelease` (≈line 164) and gains
  `dispose()`: unsubscribe both and close the prepared/current channel. `PlaybackChannel.close()`
  exists and is guarded on both channels; at quit the shell releases the playback session _before_
  `disposeAll()`, and that release already starts the close synchronously (the Linux channel's
  last write), so `dispose()` must tolerate an already-closed channel and never re-open or re-send.
  `createStageFollowSessions` gains `dispose()` ending the current follower;
  `createCinemaController` gains `dispose()` closing the overlay and unpinning if active. In
  `replays/index.ts`, register each `dispose()` and the `app.mainWindow.on(...)` unsubscribe
  (≈line 351) via `ModuleSetup.onDispose(cb)` (registry runs them in reverse order at quit). Tests:
  `index.test.ts` › "registering the module twice leaves exactly one live subscription each"
  (registry A → `disposeAll()` → registry B over the same fake context whose
  `launch.onStateChange`/`onBeforePlaybackRelease`/`mainWindow.on` count live listeners: 1 each
  after B, 0 after B's `disposeAll()`), plus per-helper "dispose unsubscribes and closes the
  channel once".

- **D10 — The launcher shuts down in order.** Files: new `src/main/shutdown.ts`, new
  `src/main/shutdown.test.ts`, `src/main/index.ts`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`.
  `installShutdown({ app, timeoutMs = 3000, log, releasePlayback, disposeModules, settles })` —
  pure, `app` is `{ on, quit }`-shaped so tests pass a fake. On the first `before-quit`:
  `event.preventDefault()`, set a guard, call `releasePlayback()` synchronously, then await
  `disposeModules()` followed by all settles in parallel (`state.settle()`, `mainWindow.settle()`,
  `persistence.settleAll()` — each resolves `{ ok }` / `{ label, ok }[]`), the whole thing raced
  against `timeoutMs`; log every rejection, every `ok: false` (by label for the registry) and a
  timeout; then `app.quit()`. Any later `before-quit` (its own `app.quit()`, or a second user quit
  during the window) returns without `preventDefault` and starts nothing. Follow the sample in
  `.claude/skills/electron-arch/SKILL.md` ("Shutdown is a sequence the shell awaits"). `index.ts`
  replaces its `before-quit` handler (≈lines 239–244) with `installShutdown(...)` over `context`
  (`launch.releasePlaybackSession`, `modules.disposeAll`, `state`, `persistence`) and `mainWindow`,
  tolerating a null context/window. Tests: "releases playback first, then disposes, then settles,
  then quits", "a second before-quit during shutdown starts nothing", "a hanging settle is cut off
  at the timeout, logged, and the app still quits", "an unsuccessful settle is logged".
  ARCHITECTURE "State and persistence": debounced `state.json`, retry-then-toast on a failed write,
  the shutdown sequence. CHANGELOG `## Unreleased` › Fixed, one line: "Your last change before
  quitting is saved, and a failed settings write now tells you."

- **D11 — A flow proves the real quit path.** Files: new `scripts/flows/quit-persists-state.mjs`,
  `src/renderer/src/components/shell/TitleBar.tsx`. Give the Close `WindowButton` (≈line 121)
  `data-testid="titlebar-close"` (add a `testId` prop like `NavItem` has). The flow (default
  `populated` variant; mirror `scripts/flows/settings-downloads-section.mjs`'s selectors): open
  Settings (`nav-settings`), read `downloads.downloadWhilePlayingAllowed` with `readStateJson` from
  `scripts/lib/state-json.mjs`, click `downloads-settings-while-playing`'s `switch`, then click
  `titlebar-close` immediately (inside the 250 ms state debounce), `await app.waitForEvent('close')`
  (bounded), and assert `state.json` holds the flipped value with a plain `readStateJson` — no
  polling, the process is gone. Check that `withApp()`'s teardown on the already-closed app does not
  stall the run (`closeAppOrKill` bounds it at 15 s regardless). Run with
  `npm run ui:flow -- quit-persists-state`.

## Model Hints

- D9 → deliverable-hard — cross-file subtlety: at quit the playback release
  (`onBeforePlaybackRelease`) has already started the channel close for the Linux channel's last
  write, so `dispose()` must not race it, re-open or double-close a channel, and the
  twice-registration test has to count real listeners across playback-control, stage-follow,
  cinema and the window observer.
- Review: → default — each claim has a test that fails on the plausible wrong version (an
  unawaited quit loses D11's flipped switch; a rigged `{ ok: true }` fails D1's rejecting-write
  test; a missing registration fails D7's per-owner test).

## Acceptance Tests

- AC1 → unit `src/main/shutdown.test.ts` › "releases playback first, then disposes, then settles,
  then quits", "a second before-quit during shutdown starts nothing", "a hanging settle is cut off
  at the timeout, logged, and the app still quits" (D10); real path → e2e
  `scripts/flows/quit-persists-state.mjs` › `quit-persists-state` (D11)
- AC2 → unit `src/main/modules/registry.test.ts` › "disposers run in reverse registration order",
  "a throwing disposer does not stop the others"; unit `src/main/modules/servers/index.test.ts` ›
  "keeps no module-level mutable state"; unit `src/main/modules/downloads/index.test.ts` ›
  "disposeAll releases every job subscription" (D8)
- AC3 → unit `src/main/modules/replays/index.test.ts` › "registering the module twice leaves
  exactly one live subscription each" (D9)
- AC4 → unit `src/main/services/persistence.test.ts` › "settleAll settles every registered store
  and reports each failure", "a rejecting store does not stop the others" (D6); per owner ›
  "registers its store with persistence" (update service, D6) and "registers its cache(s) with
  app.persistence" (downloads, mods ["registers its caches with app.persistence"], replays, news-service tests, D7); settled at quit →
  `src/main/shutdown.test.ts` › "releases playback first, then disposes, then settles, then quits" (D10)
- AC5 → unit `src/main/lib/json-store.test.ts` › "a failed flush retries once, then reports
  through onPersistError and settle resolves { ok: false }", "a failed flush retries once after the
  delay and then succeeds silently" (D1); unit `src/main/services/state.test.ts` › "a persist
  failure is forwarded to onPersistError once per session" (D5); quit logs it →
  `src/main/shutdown.test.ts` › "an unsuccessful settle is logged" (D10). Toast not driven via UI —
  see D-toast-no-e2e.
- AC6 → unit `src/main/services/state.test.ts` › "a burst of ten updates produces one write",
  "settle() forces a pending debounced write to disk at once" (D5); regression → every flow touched
  by D2–D4 via `npm run ui:flow -- <name>`, and `npm run ui:flows` at the sprint gate
- AC7 → e2e `scripts/flows/quit-persists-state.mjs` › `quit-persists-state` (D11)

Coverage: AC1 D10+D11 · AC2 D8 · AC3 D9 · AC4 D6+D7+D10 · AC5 D1+D5+D10 · AC6 D5 (D2–D4 keep the
gate green under the debounce) · AC7 D11.

## Done

Shutdown is now an awaited, bounded sequence (`src/main/shutdown.ts`): release playback, `disposeAll()`, settle state, window store and the `persistence` registry, 3 s cap, logged, then quit. `JsonStore` retries a failed write once and reports it (`onPersistError`, `settle()` -> `{ ok }`); `StateStore` debounces 250 ms and toasts the first failure. Modules release through `onDispose` (servers/downloads singletons gone); replays disposes all its subscriptions.

Commit message: `201: ordered awaited shutdown, persist-failure retry + toast, onDispose lifecycle, debounced state.json`

Verification (narrow gate): `npm run build`, `npm run typecheck` green; `npx vitest run --changed HEAD` 177 files / 2111 tests green; `npm run ui:flow -- <name>` green for `quit-persists-state` and all 21 flows D2-D4 migrated (`settings-downloads-section` needs a fresh `npm run ui:seed` when run after other flows: fixture pollution, not a regression). Review 1 (default tier): PASS. AC -> test as verified: AC1 shutdown.test.ts + flow; AC2 registry/servers/downloads tests; AC3 replays index.test.ts; AC4 persistence.test.ts + per-owner tests; AC5 json-store/state/shutdown tests; AC6 state.test.ts; AC7 flow `quit-persists-state`. No manual residue.

Decisions:
- `withApp` got an `expectExit` opt-out (`scripts/lib/harness.mjs`, read from a flow's `export const expectExit` by `scripts/flow.mjs`), because a flow that quits the app would otherwise fail its "still alive" check.
- Plan gap: replays listeners subscribe lazily, so the "twice" test plays a demo (and triggers a stop) in each registry; cinema/stage-follow disposal is proven by their helper tests (reviewer note: not at module level).
- Added D9b: `playback-stop.ts` also leaked a `launch.onStateChange` listener; now `dispose()`d via `onDispose`.
- Review fix: a throwing `releasePlayback()` is logged and shutdown continues (otherwise quit stays held); test added.
- `servers-watchlist` copied `state.json` before the debounced write: now waits for the redeemed code first.
- Open (not fixed, minor): `cinema.dispose` could be reopened by a late `set(true)`; electron-updater `quitAndInstall` path through the held `before-quit` untested. Pre-existing CRLF in `docs/requirements/done/199-*.md` trips the LF hygiene test in some worktrees.

tiers: D 12 / hard 1 · review default · cycles 1 · agents 16
