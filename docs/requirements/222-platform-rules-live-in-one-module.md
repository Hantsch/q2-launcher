---
id: 222
title: platform rules live in one module
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want "is the filesystem case-insensitive here", "what is the executable
name", "are we on Windows/Linux" to be answered by one module, so that the same product question
is not answered in several spellings that can drift, and new platform code has a home.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F32, F64; the scatter is
a roadmap follow-up): `process.platform`/`'win32'`/`'linux'` appear in 29 non-test main files
(~50 reads). Four places decide case-insensitivity and disagree: `pathKey` folds unless linux;
`ipc/app.ts` re-implements it inline; `steam.ts` folds only on win32; `diagnostics.ts` likewise —
so on darwin `findByRootPath` folds while `readSteamAppId` does not. Some code injects `platform`
as an option, services read the global, and 12 test files stub it. Smaller twins: the "Set of
listeners, copy before iterate, try/catch, log listener threw" emitter is hand-written in ten
sites, and `looksLikeQuake2`/`qualifies` are byte-identical copies with a comment claiming they
"agree".

## Acceptance Criteria

- [ ] **AC1** — `src/main/lib/platform.ts` exports `isWindows()`, `isLinux()`,
      `isCaseInsensitiveFs()`, `foldPathCase()` and `executableFileName()`, read at call time so
      `stubPlatform` keeps working; one unit test covers win32, linux and darwin.
- [ ] **AC2** — The four case-folding re-derivations use `foldPathCase`/`pathKey`; `ipc/app.ts`
      calls `pathKey`; direct `process.platform` reads in `src/main/services` and
      `src/main/modules` drop below 10, each remaining one with a one-line reason.
- [ ] **AC3** — `src/main/lib/listeners.ts` exports `createListenerSet<T>(log, label)` and the
      ten hand-written emitters use it (grep-zero for `listener threw` outside the helper).
- [ ] **AC4** — `looksLikeQuake2` lives once in `services/inspector.ts` and both callers import
      it.
- [ ] **AC5** — Full `npm test` green; the roadmap follow-up is removed.

## Open Questions

- none

## Plan

<!-- Filled by /refine 222. -->

## Deliverables

<!-- Filled by /refine 222. -->

## Model Hints

<!-- Filled by /refine 222. -->

## Acceptance Tests

<!-- Filled by /refine 222. -->

## Done

<!-- Filled by /build 222. -->
