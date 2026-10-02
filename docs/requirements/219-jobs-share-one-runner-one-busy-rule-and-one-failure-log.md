---
id: 219
title: jobs share one runner, one busy rule and one failure log
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want two jobs never to write into the same installation at once, the Library to show
the real state of an installation after a job failed half-way, and a failed mod install to be
explained in the Downloads failure log like a failed engine update. As the maintainer I want the
job lifecycle — cancel wiring, settled promise, local-failure catch, write-guard mapping,
revalidation — to exist once, so that a lifecycle fix is one change instead of nine.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F11, F44, F55, F46):
`JobsService` (227 lines) offers create/progress/finish/cancel; every one of nine job files
re-implements `new AbortController()` + `onCancel`, the `settled = (async () => { try … catch { finish LOCAL_FAILURE } })()`
IIFE, four identical closures (`isCancelled`/`report`/`failed`/`cancelledOutcome`, line-for-line
in `engine/update-job.ts` and `repair/job.ts`), the `writePhase[0]` + `isWriteCancelled` trick,
26 `jobs.finish(` calls, three `LOCAL_FAILURE` constants and 34 `*Host|*Deps` interfaces of which
six `*WriteGuardHost` are byte-identical. Admission control sees one module: `mods/update-job.ts`
checks only `moduleId === 'mods'`, downloads never reads `jobs.list()`, and `write-guard.ts`
says "nothing stops two jobs from targeting one installation". The stale-status bug the roadmap
tracks for two jobs (write phase fails → `installations.validate()` only on the success path) is
in six. Mods jobs keep three process-global `inFlight` registries with string-literal busy kinds
and an install that ignores a running update. `observeFailedJobs` skips every job whose
`moduleId !== 'downloads'`, so a failed mod job never reaches the failure log or diagnostics;
`missingChecks` are stored without params so `{{path}}` renders literally.

Depends on story 220 (staging) landing first so the runner wraps the final staging shape.

## Acceptance Criteria

- [ ] **AC1** — `src/main/services/job-runner.ts` (or `JobsService.run`) takes
      `spec = { moduleId, kind, labelKey, installationId?, exclusive?: 'installation' }` and a
      `body(ctx)` where `ctx` provides `jobId`, `signal`, `report`, `fail`, `cancelled`,
      `write(installationId, fn)` and `setExtractor`; it owns the AbortController, settled
      promise, local-failure catch and write-guard cancel mapping; one `JobOutcome<K>` type and
      one set of host interfaces are exported from `src/main/modules/ports.ts`. Unit tests cover
      success, local failure, cancel before write, cancel during write.
- [ ] **AC2** — With `exclusive: 'installation'`, starting a job while any active job of any
      module targets the same installation refuses with `jobs.error.installationBusy` (i18n key,
      visible in the dialogs); a test starts a mod update and asserts a mod install and an engine
      update are refused.
- [ ] **AC3** — The runner revalidates the installation in a `finally` once the write phase was
      entered, before `jobs.finish`; one shared test "a failing write still revalidates"; the
      two roadmap follow-up lines are removed.
- [ ] **AC4** — All nine jobs run on the runner; `git grep -n 'LOCAL_FAILURE =\|new AbortController' src/main/modules`
      returns only the runner; the mods `inFlight` sets and `BUSY_KINDS` literals are deleted.
- [ ] **AC5** — The failure log and diagnostics record jobs of every `moduleId` (Downloads tab
      filters by module if needed); `missingChecks` carry `params` (paths reduced to basename per
      story 075); a renderer test renders each `validation.*` key with params and finds no `{{`.
- [ ] **AC6** — docs/ARCHITECTURE.md's Jobs paragraph describes the runner and the exclusivity
      rule (and no longer says "No module produces jobs yet"); every downloads and mods flow
      passes.

## Open Questions

- [ ] **Q1** — Migrate all nine jobs in one story or runner + three (rollback, mods remove,
      download) here and the rest one per sprint as the judge suggests? Decide by diff size at
      refine.

## Plan

<!-- Filled by /refine 219. -->

## Deliverables

<!-- Filled by /refine 219. -->

## Model Hints

<!-- Filled by /refine 219. -->

## Acceptance Tests

<!-- Filled by /refine 219. -->

## Done

<!-- Filled by /build 219. -->
