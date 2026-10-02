---
id: 202
title: state slices are mutated in place, never replaced from a snapshot
status: ready # draft -> ready -> in-progress -> done
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

- [x] **Q1** — Generic `updateSlice(key, fn)` keyed on the document type, or one named mutator per
      slice (consistent with story 207's per-module section API)? Prefer whatever 207 will keep.
      → Generic `updateSlice`, see Decisions (Sprint) S1.

## Decisions (Sprint)

- **S1 (Q1)** — One generic `StateStore.updateSlice(key, fn)`, no named per-slice mutators: story 207
  AC2 keeps a generic per-section `{ get(), update(fn) }`, which becomes a thin wrapper over
  `updateSlice(key, fn)` — named mutators would only be deleted again in 207.
- **S2** — `updateSlice`'s key type is an explicit union `'servers' | 'replays' |
'configWriteFailures' | 'installations'`: slices with a write invariant (`settings` via
  `patchSettings`, `downloadFailures` pruning, write-once `configFileSourceMigratedAt`) keep their
  own setter so the generic path cannot bypass that invariant.
- **S3** — A callback that returns the identical reference it received schedules no write: refusal
  paths can run their op on the live value inside the callback and keep "written only on real
  changes" (ARCHITECTURE.md) true.
- **S4** — The callback is synchronous by type (`(live: T) => T`); async work (stat, canonicalize,
  inspect) happens _before_ the mutator and only its pure result is applied to the live value.
- **S5** — `replays` `extraFoldersAdd`: `addExtraFolder` is split into an async
  `resolveExtraFolder(rawPath)` (absolute/stat/canonicalize) and a pure
  `appendExtraFolder(live, canonical, now, id)` (dedupe + append) run inside the mutator, because the
  dedupe check must see the live list, not the pre-await one.
- **S6** — `setConfigWriteFailures` is deleted too (AC1 names a write-failures mutator); the
  `writeFailures` fix is mutator-based, not serialised: `syncAndPersist` keeps its pre-sync snapshot
  and applies only the keys `syncProfile` added/changed/removed against that snapshot onto the live
  map, so `sync.ts` stays untouched and no new lock can deadlock nested callers.
- **S7** — `InstallationsService.patch(id, patch)` takes `Omit<Partial<Installation>, 'id'>`; a key
  present with value `undefined` deletes the field (needed for `writeDirPath: null`, the dropped
  `executablePath`, `steamAppId`), and an unknown id returns `fail('installations.error.notFound')`.
- **S8** — `applyInspection` is split into the awaited `inspectInstallation` call and a pure
  `applyInspectionResult(live, result)` that runs inside the commit mutator, so every concurrent
  field change (icon, playtime, last failure, module data) is the base the verdict is merged onto.
- **S9** — `validate(id)` gets the same rewrite as `validateAll()`: identical race shape, and leaving
  it would keep one of the two revalidation paths stale-snapshot based.
- **S10** — In `validateAll`/`validate`, a verdict is dropped for an entry whose `rootPath`,
  `executablePath` or `writeDirPath` changed during the await (the inspection was of another folder;
  the `update()` that changed it ran its own), and an entry removed meanwhile is skipped.
- **S11** — The synchronous `commit(list)` sites in `InstallationsService` (`setIcon`,
  `recordPlaySession`, `reorder`, …) stay as they are: they have no `await` between read and write,
  and touching them is collateral churn.
- **S12** — The servers watchlist's `setEntries(list)` is converted mechanically to
  `updateSlice('servers', s => ({ ...s, watchlist: list }))`; any snapshot race inside the watchlist
  service itself is not one of F09's four sites and stays out of scope.
- **S13** — `setOrClearListSort` lives in `src/main/lib/list-sort.ts`: servers and replays may not
  import each other, and a pure helper in the main lib is a module → shell import, the allowed
  direction.
- **S14** — No e2e flow: every AC is main-process internal with no user action, so unit tests are
  the real surface (`ui-acceptance-required` covers user actions only).

## Plan

1. **D1** — `StateStore.updateSlice(key, fn)` + `setOrClearListSort` helper + ARCHITECTURE.md rule.
   Additive only; nothing is deleted yet, so the tree stays green.
2. **D2** — servers: every `setServersState` site → `updateSlice('servers', …)`; delete
   `setServersState`.
3. **D3** — replays + name-templates: same, plus the `extraFoldersAdd` race (S5); delete
   `setReplaysState`.
4. **D4** — installations: `patch()`, `applyInspectionResult`, rewrite `update`/`validate`/
   `validateAll` with interleaving tests.
5. **D5** — config: `writeFailures` delta merge in `syncAndPersist` + removal path; delete
   `setConfigWriteFailures`; concurrency test.

D2–D5 depend only on D1 and are independent of each other. Files: `src/main/services/state.ts`,
`src/main/services/installations.ts`, `src/main/modules/{servers,replays,config}/index.ts`,
`src/main/modules/replays/{name-templates,extra-folders}.ts`, `src/main/lib/list-sort.ts` (new),
their tests, `docs/ARCHITECTURE.md`.

## Deliverables

- **D1 — the slice mutator and the shared sort helper.**
  - `src/main/services/state.ts`: add
    `updateSlice<K extends MutableSliceKey>(key: K, fn: (live: LauncherStateDocument[K]) => LauncherStateDocument[K]): LauncherStateDocument[K]`
    with `type MutableSliceKey = 'servers' | 'replays' | 'configWriteFailures' | 'installations'`
    (export the type). It reads `this.store.get()[key]`, calls `fn` with that live value; if the
    result is the identical reference, it returns it without calling `store.update` (no write);
    otherwise `this.store.update((doc) => ({ ...doc, [key]: next }))` and returns the stored value.
    Do **not** delete any existing setter in this D.
  - `src/main/lib/list-sort.ts` (new): pure
    `setOrClearListSort<S extends { listSort?: T }, T>(slice: S, sort: T | null): S` — `null` returns
    the slice with the `listSort` key destructured away (absent on disk, not `undefined`), otherwise
    `{ ...slice, listSort: sort }`. Plus `src/main/lib/list-sort.test.ts`.
  - `docs/ARCHITECTURE.md` "State and persistence": add a short paragraph stating the rule — a
    slice is changed through its mutator (`updateSlice`, `patchSettings`, `InstallationsService.patch`),
    whose synchronous callback receives the live value; never read → spread → set, and async work
    happens before the mutator, never between a read and its write.
  - Tests: `src/main/services/state.test.ts` › "updateSlice hands the callback the live value and
    keeps sibling keys", › "updateSlice schedules no write when the callback returns the same
    reference", › "ARCHITECTURE.md states the slice-mutator rule" (reads `docs/ARCHITECTURE.md`,
    asserts the "State and persistence" section names `updateSlice` and forbids read-spread-set);
    `src/main/lib/list-sort.test.ts` › "setOrClearListSort clears to an absent key and sets
    otherwise".
- **D2 — servers use the mutator.** Needs D1.
  - `src/main/modules/servers/index.ts`: replace every `const current = app.state.serversState(); …
app.state.setServersState({ ...current, X })` with `app.state.updateSlice('servers', (live) => …)`
    — sites: watchlist `setEntries` (mechanical, S12), `scanPatchSettings`, the sources `mutate()`,
    favourites add/remove, `manualAdd`/`manualRemove`, the history `onStateChange` subscription,
    `listSetSort` (use `setOrClearListSort` from `src/main/lib/list-sort.ts`), `mutateQuickFilters`.
    Refusal paths run the op on `live` inside the callback, capture the result in a local, and return
    `live` unchanged on refusal (no write). Return values stay "what was persisted" (the
    `updateSlice` return). Update the doc comments that name `setServersState`.
  - Delete `setServersState` from `src/main/services/state.ts`; migrate test seeding in
    `src/main/services/state.test.ts`, `src/main/modules/servers/index.test.ts`,
    `src/main/modules/servers/scan-integration.test.ts` to `updateSlice('servers', …)`.
  - Acceptance: `git grep -n 'setServersState' src/main` is empty; existing servers tests pass.
  - Test: `src/main/modules/servers/index.test.ts` › "a refused sources mutation writes nothing and
    keeps a concurrent favourite".
- **D3 — replays and name templates use the mutator; extraFoldersAdd is race-free.** Needs D1.
  - `src/main/modules/replays/extra-folders.ts`: split `addExtraFolder` into async
    `resolveExtraFolder(rawPath): Promise<{ ok: true; canonical: string } | { ok: false; reason }>`
    (isAbsolute → stat → isDirectory → `canonicalizePath`, same reasons as today) and pure
    `appendExtraFolder(current, canonical, now, id): ExtraFoldersResult` (pathKey dedupe →
    `'alreadyListed'`, append). Keep the doc comment's four checks, now split across the two.
    Update its existing tests accordingly.
  - `src/main/modules/replays/index.ts`: `extraFoldersAdd` awaits `resolveExtraFolder` first, then
    runs `appendExtraFolder` on `live` inside `app.state.updateSlice('replays', …)`. Convert every
    other `setReplaysState({ ...current, … })` site (`extraFoldersRemove`, `listSetSort` via
    `setOrClearListSort` from `src/main/lib/list-sort.ts`, `listSetFilter`, the three `modWarning*`
    handlers) the same way; update doc comments naming `setReplaysState`.
  - `src/main/modules/replays/name-templates.ts`: the read-spread-set at its `nameTemplates` write
    → `updateSlice('replays', …)`.
  - Delete `setReplaysState` from `src/main/services/state.ts`; migrate seeding in
    `src/main/services/state.test.ts` and `src/main/modules/replays/demo-play.test.ts`.
  - Acceptance: `git grep -n 'setReplaysState' src/main` is empty.
  - Test: `src/main/modules/replays/index.test.ts` (exists; boots the module) › "a sort change during extraFoldersAdd's await survives" — gate the
    `stat`/`canonicalize` await (e.g. a deferred via `vi.mock` of `node:fs/promises` or of
    `../../lib/fs-utils` with `importOriginal`), call `listSetSort` while it is pending, then release;
    assert both `listSort` and the new folder are persisted.
- **D4 — installations merge at commit time.** Needs D1.
  - `src/main/services/installations.ts`:
    - private `mutateOne(id, fn: (live: Installation) => Installation)` over
      `this.state.updateSlice('installations', …)` + `this.onChange(this.list())`; returns the
      committed record or `undefined` if the id is gone.
    - public `patch(id, patch: Omit<Partial<Installation>, 'id'>): Outcome<Installation>` — merges
      onto the live record inside the mutator; a key present with value `undefined` deletes the
      field; unknown id → `fail('installations.error.notFound')`.
    - split `applyInspection` into the awaited `inspectInstallation(...)` call and a pure
      `applyInspectionResult(live: Installation, result: ValidationResult): Installation` carrying
      every existing rule unchanged (status/checks/gameDirs/lastValidatedAt/updatedAt, lastFailure
      clear on playable, `preserveKnownEngine` + `custom` guard, executable adoption,
      executableKind, steamAppId set-or-delete, activeGameDir reset).
    - `update()`: build the user-field patch (incl. `undefined` for cleared `writeDirPath`/dropped
      `executablePath`) after its awaits; keep the duplicate-root check against the live list; if
      revalidating, inspect the candidate (live snapshot + patch) and commit
      `mutateOne(id, live => applyInspectionResult({ ...live, ...patch }, result))` (undefined keys
      removed), else `patch(id, userPatch)`. An entry removed during the await → `notFound`.
    - `validate(id)` and `validateAll()`: inspect from the snapshot, then commit inside one mutator
      over the **live** list: apply `applyInspectionResult(live, result)` only where the entry still
      exists and its `rootPath`/`executablePath`/`writeDirPath` equal the inspected ones; entries
      added meanwhile pass through untouched. `validateAll` keeps one write + one `onChange`.
    - Leave the synchronous `commit(list)` sites (`setIcon`, `recordPlaySession`, `reorder`, …) as
      they are.
  - Tests in `src/main/services/installations.test.ts`, gating `inspectInstallation` with a deferred
    via `vi.mock('./inspector', async (importOriginal) => …)` (and `canonicalizePath` where needed):
    › "an installation added during validateAll survives", › "a play session recorded during
    validateAll is kept", › "setIcon during an awaited update() is not clobbered", › "patch merges
    onto the live record and an undefined key deletes the field". Existing applyInspection tests
    (lastFailure, engineKind) must stay green unchanged.
- **D5 — config write failures merge instead of replace.** Needs D1.
  - `src/main/modules/config/write-failures.ts` (new): pure
    `mergeWriteFailureChanges(live, before, after)` — for every key whose value in `after` differs
    from `before` (added/changed) set it on a copy of `live`; for every key in `before` missing from
    `after` delete it from the copy; return `live` itself if nothing changed. Plus
    `write-failures.test.ts`.
  - `src/main/modules/config/index.ts` `syncAndPersist`: capture
    `const before = app.state.configWriteFailures()` and pass it as `writeFailures` (as today);
    replace `app.state.setConfigWriteFailures(outcome.writeFailures)` with
    `app.state.updateSlice('configWriteFailures', (live) => mergeWriteFailureChanges(live, before, outcome.writeFailures))`.
    The profile-removal path that filters `${id}|` keys → `updateSlice` with the filter on `live`
    (return `live` when nothing was dropped). `src/main/modules/config/sync.ts` is not changed.
  - Delete `setConfigWriteFailures` from `src/main/services/state.ts`; migrate seeding in
    `src/main/modules/config/index.test.ts` and `src/main/modules/config/file-source-pipeline.test.ts`.
  - Tests: `src/main/modules/config/write-failures.test.ts` › "a key added by an overlapping run is
    kept"; `src/main/modules/config/index.test.ts` › "concurrent syncAndPersist runs keep each
    other's write failures" — two saves on profiles assigned to different installations, the mocked
    `writeTargetFile` failing for both with the first held on a deferred until the second has
    persisted; assert both failure keys are in `state.configWriteFailures()`.

## Model Hints

- D4 → deliverable-hard — splitting `applyInspection` into inspect + apply-on-live moves its subtle
  field rules (lastFailure scoping, engineKind preservation, steamAppId delete, executable adoption)
  under a new merge order, and a wrong order silently reverts a concurrent `setIcon`/
  `recordPlaySession` or the user's own edit while every existing test still passes.
- D1, D2, D3, D5 → default.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/services/state.test.ts` › "updateSlice hands the callback the live value and
  keeps sibling keys" + › "updateSlice schedules no write when the callback returns the same
  reference" (D1); setter deletion proven by `npm run typecheck` plus the AC2 grep (D2, D3, D5).
- AC2 → unit `src/main/modules/servers/index.test.ts` › "a refused sources mutation writes nothing
  and keeps a concurrent favourite" (D2) + `src/main/modules/replays/index.test.ts` › "a sort change
  during extraFoldersAdd's await survives" (D3); the grep `git grep -n
'setServersState\|setReplaysState' src/main` returning nothing is checked in D2/D3 acceptance.
- AC3 → unit `src/main/services/installations.test.ts` › "an installation added during validateAll
  survives", › "a play session recorded during validateAll is kept", › "setIcon during an awaited
  update() is not clobbered", › "patch merges onto the live record and an undefined key deletes the
  field" (D4).
- AC4 → unit `src/main/modules/config/index.test.ts` › "concurrent syncAndPersist runs keep each
  other's write failures" + `src/main/modules/config/write-failures.test.ts` › "a key added by an
  overlapping run is kept" (D5).
- AC5 → unit `src/main/lib/list-sort.test.ts` › "setOrClearListSort clears to an absent key and
  sets otherwise" (D1), used by both `listSetSort` handlers (D2, D3; existing list-sort handler
  tests stay green).
- AC6 → unit `src/main/services/state.test.ts` › "ARCHITECTURE.md states the slice-mutator rule"
  (D1).

## Done

<!-- Filled by /build 202. -->
