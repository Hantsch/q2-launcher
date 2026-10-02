---
id: 225
title: tests share a quiet logger and one test-support kit
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a test run to print only failures, and a new test to get its temp dir,
fake `AppContext`, installation/job/profile builders and typed client mocks from one place, so
that a shape change costs one edit instead of five to sixteen and mocks cannot silently drift
from the real client.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F53, F54, F71):
`src/main/lib/logger.ts` runs `log.initialize()` and sets `console.level = 'debug'` at import;
50 main files import it and only 4 tests mock it; vitest has no `setupFiles`/`silent`; a
dot-reporter run prints 622 `stdout |`/`stderr |` blocks and every test touching a module loads
`electron-log` + `electron`, which is why all four CI workflows carry the "Install Electron
binary" race workaround. `src/test-support/` has two files used by 12 of 444 tests; `mkdtemp`
is inlined 73–96 times with matching `rm` hooks; `fakeAppContext()` is hand-written 5 times,
`fakeState()` byte-identical in five job tests, `fakeLaunch` five times, `makeInstallation(overrides)`
in 10 renderer tests (one with a POSIX root), `makeJob` 6 times; 38 renderer tests
`vi.mock('./client')` hand-listing exports. Five test files exceed 2,000 lines as story-ordered
append logs (`round-trip.test.ts` 3,613 with 36 of 38 describes named after stories and helpers
re-invented 2,000 lines apart).

## Acceptance Criteria

- [ ] **AC1** — `src/test-support/setup.ts` is wired as `test.setupFiles` and silences the
      logger (mock `electron-log/main` or `console.level = false` under `VITEST`); a guard
      asserts the dot run emits zero `stdout |` blocks; main tests no longer need the Electron
      binary installed (CI workaround removed where it only served tests).
- [ ] **AC2** — `src/test-support/` provides `useTempDir(prefix)` with automatic cleanup,
      `fakeAppContext(overrides)`, and `fixtures.ts` with `makeInstallation`, `makeJob`,
      `makeConfigProfile`; `src/main/modules/downloads/test-support.ts` provides `fakeState`,
      `fakeLaunch`, `fakeExtractor`, `fakeManifest`, `fakeFetcher`; the builder sites are
      migrated (grep-zero for `function makeInstallation(` outside test-support).
- [ ] **AC3** — `src/renderer/src/test-support/mockClient(path, overrides)` uses
      `importOriginal` so a renamed client export fails typecheck in every test that mocks it;
      the 38 hand-listed mocks use it.
- [ ] **AC4** — `round-trip.test.ts` is split into `round-trip/` with a `helpers.ts` and
      behaviour-named files; story numbers appear only in `it()` names; no test file exceeds
      1,500 lines (soft cap in story 208's architecture test).
- [ ] **AC5** — docs/ARCHITECTURE.md gains a short "Testing" section: conventions, where the
      kit lives, real temp dirs over fs mocks, the size cap.
- [ ] **AC6** — Full `npm test` green with the same test count (minus deliberately merged
      duplicates, listed in Done).

## Open Questions

- [ ] **Q1** — Migrate the 73–96 `mkdtemp` sites now or opportunistically? Recommendation:
      builders now, temp dirs when a file is next touched.

## Plan

<!-- Filled by /refine 225. -->

## Deliverables

<!-- Filled by /refine 225. -->

## Model Hints

<!-- Filled by /refine 225. -->

## Acceptance Tests

<!-- Filled by /refine 225. -->

## Done

<!-- Filled by /build 225. -->
