---
id: 210
title: the config module's main side is handlers, not business logic
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want the config module's most delicate invariants — never overwrite unread
bytes, only `save` writes a dirty canonical file, raw-save bytes are never re-rendered — to live
in a service with an explicit dependency interface that a unit test can drive directly, so that
they are no longer testable only by booting the whole module with a full `AppContext`, and so
that the next config story does not add another hundred lines to one closure.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F07, confirmed by an
independent re-count): `src/main/modules/config/index.ts` is 2,035 lines; `setup()` spans lines
593–2035 and registers 35 handlers of 41–58 lines each (replays' are one-liners); `save` is ~152
lines, `saveRawText` ~166, `refreshFromFiles` ~176 with a 143-line loop body; ~480 lines of
orchestration (`syncAndPersist`, `authoriseContentWrite`, `canonicalFileNameFor`,
`readSyncFileStatus`) sit above `setup()` unexported; the file imports `node:fs/promises` and
`electron.shell` directly; `userDataDir()` 12x, `fail('config.error.profileNotFound')` 12x,
`withLiveAssignments(` 16x inside the closure. `index.test.ts` (3,231 lines, 103 tests) boots the
module 13 times and shares three `vi.mock`s of sibling modules across all tests. 26 of 430
commits since August touched this file — ten different stories in the last ten commits.
`downloads/index.ts` (933 lines, 21 handlers) repeats the shape at a smaller scale. replays and
servers already follow the thinner "setup registers one-line delegations" pattern.

## Acceptance Criteria

- [ ] **AC1** — The write-path orchestration (`syncAndPersist`, `authoriseContentWrite`,
      `canonicalFileNameFor`, `readSyncFileStatus`, and the bodies of `save`, `saveRawText`,
      `refreshFromFiles`) lives in `src/main/modules/config/profile-writes.ts` (name at refine)
      behind an explicit deps interface in the style of `sync.ts#SyncProfileDeps`
      (`readFileState`, `writeTargetFile`, state access, logger).
- [ ] **AC2** — The save / raw-save / refresh `describe` blocks are ported to
      `profile-writes.test.ts` driving the service with injected deps and no `configModule.setup()`
      boot; the three invariants above each have a named test there.
- [ ] **AC3** — `index.ts` registers each handler as one `handle(X, schema, (input) => service.x(input))`
      line or a short adapter; it has no `node:fs` or `electron` import; its length is ≤ 600 lines
      (a soft cap recorded in story 208's architecture test once both have landed).
- [ ] **AC4** — `index.test.ts` keeps registration completeness, schema rejection and one happy
      path per handler; the story-numbered `describe` names are renamed to behaviours.
- [ ] **AC5** — The startup sequence (`runFileSourceStartup` + the sync retry loop) lives in
      `startup.ts`; whether it must still block boot is recorded as a decision (see F49 in the
      review).
- [ ] **AC6** — `round-trip.test.ts`, `file-source-pipeline.test.ts` and every config flow pass
      unchanged.

## Decisions (Sprint)

- **(User)** Q1: One `profile-writes.ts` for the write path, incremental, no rewrite.
- **(User)** Q2: downloads/index.ts is NOT cut here; separate story later.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — One `profile-writes.ts` or several handler groups (`handlers/profiles.ts`,
      `handlers/editing.ts`, `handlers/raw-files.ts`, `handlers/import.ts`, `handlers/cleanup.ts`)?
      The value judge recommends one incremental story around the write path only, not a
      rewrite.
- [x] answered → Decisions (Sprint) — **Q2** — Apply the same cut to `downloads/index.ts` here or as its own small story?

## Plan

<!-- Filled by /refine 210. -->

## Deliverables

<!-- Filled by /refine 210. -->

## Model Hints

<!-- Filled by /refine 210. -->

## Acceptance Tests

<!-- Filled by /refine 210. -->

## Done

<!-- Filled by /build 210. -->
