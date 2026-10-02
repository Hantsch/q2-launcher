---
id: 202
title: state slices are mutated in place, never replaced from a snapshot
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a module handler that changes one field of its persisted state to be
unable to overwrite a sibling field with a stale value, so that correctness no longer depends on
"no `await` ever sneaks between the read and the write".

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F09): `StateStore` hands
out whole-section snapshots and whole-section setters. `setServersState` is called 11 times and
`setReplaysState` 9 times, each as `const current = app.state.X(); … setX({ ...current, key: next })`;
the `listSort` handler is byte-identical in servers and replays. Four sites already await between
read and write and lose concurrent changes silently:

- `replays/index.ts` `extraFoldersAdd` snapshots, awaits `stat`/`canonicalizePath`, then writes
  `{ ...current, extraFolders }` — a sort/filter/mod-warning change in between is reverted;
- `config/sync.ts` copies `writeFailures` before awaited writes and `config/index.ts` writes it
  back wholesale, with 13 unserialised `syncAndPersist` callers;
- `installations.validateAll()` builds its result across N awaited inspections then `commit`s —
  an installation added meanwhile is dropped;
- `installations.update()` derives `next` from a snapshot, awaits `canonicalizePath`, then
  replaces by id, clobbering a concurrent `recordPlaySession`/`setIcon`.

Config and downloads already got per-key setters, so the store API differs per slice.
`JsonStore.update(mutate)` and `patchSettings` already are the callback-based shape wanted here.

## Acceptance Criteria

- [ ] **AC1** — `StateStore` exposes synchronous section-scoped mutators (`updateServersState(fn)`,
      `updateReplaysState(fn)`, `updateConfigWriteFailures(fn)`, or one generic
      `updateSlice(key, fn)`) whose callback receives the live value; the whole-section
      `setServersState`/`setReplaysState` setters are deleted so a stale-snapshot write cannot
      compile.
- [ ] **AC2** — Every former `set*({ ...current, … })` call site in servers, replays and
      name-templates uses a mutator; `git grep -n 'setServersState\|setReplaysState' src/main`
      returns nothing.
- [ ] **AC3** — `InstallationsService` gets `patch(id, patch)` that merges at commit time, and
      `update()` and `validateAll()` are rewritten so an entry added or changed during their
      awaits survives; unit tests interleave two awaited handlers and assert both writes land.
- [ ] **AC4** — The config `writeFailures` path is serialised or mutator-based so concurrent
      `syncAndPersist` calls cannot revert each other's failures; a test proves it.
- [ ] **AC5** — The duplicated `listSetSort` handler bodies share one `setOrClearListSort`
      helper.
- [ ] **AC6** — docs/ARCHITECTURE.md's state section states the rule: a slice is changed through
      its mutator, never read-spread-set.

## Open Questions

- [ ] **Q1** — Generic `updateSlice(key, fn)` keyed on the document type, or one named mutator per
      slice (consistent with story 207's per-module section API)? Prefer whatever 207 will keep.

## Plan

<!-- Filled by /refine 202. -->

## Deliverables

<!-- Filled by /refine 202. -->

## Model Hints

<!-- Filled by /refine 202. -->

## Acceptance Tests

<!-- Filled by /refine 202. -->

## Done

<!-- Filled by /build 202. -->
