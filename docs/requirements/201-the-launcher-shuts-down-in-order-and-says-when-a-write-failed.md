---
id: 201
title: the launcher shuts down in order and says when a write failed
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — On the first `before-quit`, main calls `preventDefault()`, releases the playback
      session synchronously first (the Linux channel's last write depends on it), then awaits
      `disposeAll()`, `state.settle()`, `mainWindow.settle()` and every registered persistent
      store, bounded by a timeout of 2–3 s, logs anything that failed or timed out, and then quits.
      A second `before-quit` during that window does not start a second shutdown.
- [ ] **AC2** — `ModuleSetup` offers `onDispose(cb)`; the registry runs disposers in reverse
      registration order, a throwing disposer does not stop the others, and the servers and
      downloads module-level `let`/`Set` singletons are gone (grep-zero for `let active` at module
      scope in `src/main/modules/servers`). Registry tests prove order and the throwing case.
- [ ] **AC3** — `replaysModule` disposes what it subscribes: `launch.onStateChange`,
      `onBeforePlaybackRelease`, main-window observer listeners, stage-follow sessions, the cinema
      controller and the playback channel (`close()` added where missing); a test registers the
      module twice and asserts no double subscription.
- [ ] **AC4** — `AppContext` has a `persistence` registry (`register(store)`, `settleAll()`); the
      five module `JsonStore`s register on creation and are settled at quit.
- [ ] **AC5** — `JsonStoreOptions.onPersistError` exists; a failed flush retries once after
      ~500 ms, then reports; `StateStore` forwards it and the shell shows one toast per session
      (`app.toast.statePersistFailed`, visible text, i18n key). `settle()` resolves `{ ok }` and
      the quit path logs an unsuccessful settle. Unit test with a rejecting `writeFile`.
- [ ] **AC6** — `StateStore` passes `debounceMs` (~250 ms) like window-state does; a
      `state.test.ts` case proves a burst of ten updates produces one write; the existing
      `settle()` call before a launch (`ipc/launch.ts`) still forces the write.
- [ ] **AC7** — A `ui:flow` toggles a persisted preference, quits the app through the real
      quit path and asserts the value in `state.json` afterwards.

## Open Questions

- [ ] **Q1** — Does any current flow or script rely on `before-quit` being synchronous (e.g.
      `scripts/flow.mjs` teardown timing)? Check before changing the quit path.

## Plan

<!-- Filled by /refine 201. -->

## Deliverables

<!-- Filled by /refine 201. -->

## Model Hints

<!-- Filled by /refine 201. -->

## Acceptance Tests

<!-- Filled by /refine 201. -->

## Done

<!-- Filled by /build 201. -->
