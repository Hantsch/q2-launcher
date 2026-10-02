---
id: 220
title: package staging is one path and the dead download queue is gone
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want the Downloads settings to do what they say — or to say visibly that they do
nothing yet — and a bleeding-edge engine download to be as robust (stall timeout, retry, size
cap) as a pinned one. As the maintainer I want download → verify → extract to be one routine and
the content manifest to be read by one service, so that a staging fix is applied once and two
modules stop writing the same cache file.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F12, F13, F43, F45):

- `startDownload(app, source)` is the only caller of `pipeline.start()` and has zero callers in
  main; `createPipelineFor` still runs at setup; `concurrentJobs` is consumed only by the dead
  `queue.ts` and `downloadWhilePlayingAllowed` by nothing — yet the Settings UI shows both as
  live controls and docs/systems/install-module.md §9 promises parallelism and pause/resume.
  ~450 lines plus 711 lines of tests maintain a path nothing runs.
- `stage-package.ts` (story 190) describes itself as "the download/extract section of
  engine/update-job.ts without the job", yet bootstrap, repair and engine update still inline
  their own fetch → `markVerified` → extract → list sequences. `downloadUnpinnedAsset` (~85
  lines) is a second streaming downloader beside `fetcher.ts` (534 lines of retries, stall timer,
  size-overrun, sha256) with none of that hardening. `clamp01` x2, `removeDir` x2, `hashFile`
  duplicated, three recursive listers.
- `new ManifestService` is constructed in downloads and again in mods, each with its own memory,
  freshness window and `JsonStore` on the same `manifest-cache.json`; `CatalogService` mirrors it
  almost line for line.
- `bootstrap/job.ts` step 8 re-runs `assembleInstallation({ includeVideoAndPlayers: true })`,
  re-planning and re-copying every core file written in step 6 (roadmap follow-up since S19).

## Acceptance Criteria

- [ ] **AC1** — `pipeline.ts`, `queue.ts`, their tests, `startDownload` and the `createPipelineFor`
      call are deleted (`getExtractDir` moves to staging); `concurrentJobs` and
      `downloadWhilePlayingAllowed` controls stay visible in Settings but disabled with a visible
      i18n reason ("Not available yet: downloads run one at a time") per the platform-parity
      rule, or are removed together with their persisted fields via a migration — decision
      recorded; install-module.md §9 matches.
- [ ] **AC2** — bootstrap, repair and engine update stage through `stagePackage` (extended with
      `onProgress` and `verify: 'sha256' | { sizeOnly: true }`); `downloadUnpinnedAsset` is
      deleted and the unpinned branch goes through `downloadPackage` in size-only mode, so stall
      timer, retry/mirror loop and size-overrun abort apply; a test proves a stalled unpinned
      download times out.
- [ ] **AC3** — `clamp01`, `removeDir`, `hashFile` live once in `src/main/lib/`; the three
      recursive listers are one (`fs-utils`, with story 199).
- [ ] **AC4** — One `ManifestService` lives on `AppContext` (or a `content` service) and is
      injected into downloads and mods; a generic `CachedContentDocument<T>` in
      `src/main/lib/content-repo.ts` carries path, freshness, `cacheVersion` and envelope
      validation, and both `ManifestService` and `CatalogService` are thin wrappers over it.
- [ ] **AC5** — `assembleInstallation`/`buildAssemblePlan` take `scope: 'core' | 'extras'`;
      `assemble.test.ts` asserts the two plans are disjoint; the bootstrap flow records each file
      once.
- [ ] **AC6** — Every downloads/mods unit test and flow (bootstrap, repair, engine update, mod
      install/update) passes; `index.test.ts` asserts every exported job starter is reachable
      from a handler.

## Open Questions

- [ ] **Q1** — Disable-with-reason or remove the two settings? Removing needs a migration step
      and drops a documented promise; disabling keeps the option to make the queue real later.
      Recommendation: disable with reason now.

## Plan

<!-- Filled by /refine 220. -->

## Deliverables

<!-- Filled by /refine 220. -->

## Model Hints

<!-- Filled by /refine 220. -->

## Acceptance Tests

<!-- Filled by /refine 220. -->

## Done

<!-- Filled by /build 220. -->
