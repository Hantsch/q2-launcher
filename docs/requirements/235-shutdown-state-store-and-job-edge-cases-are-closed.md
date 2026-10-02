---
id: 235
title: shutdown, state-store and job edge cases are closed
status: draft # draft -> ready -> in-progress -> done
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

<!-- AC6: which cause key is right for a bleeding-edge transport failure? -->

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
