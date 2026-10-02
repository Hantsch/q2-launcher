---
id: 206
title: a refusal is one shape with a full i18n key and one toast path
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a handler's "no, because …" answer to have one shape across modules,
carry the full i18n key, and reach the user through one toast helper, so that a caller can tell
from the type how a refusal arrives, a generic refusal-to-toast path exists, and no key is
assembled by string template where a key-coverage test cannot see it.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F04 part 3–4): 43
non-test files declare their own `{ ok: false … }` union — field named `reason` 31x, `reasonKey`
11x, `error` 3x, `code` 2x; `ReplaysStageResult` uses `placed`; seven local `fail`/`refuse`
helpers re-implement `@shared/types.fail`; the renderer assembles keys like
`servers.sources.reject.${reason}` and `replays.extraFolders.error.${reason}`. `toastError` is
private to `useLauncher.ts` while 12 sites re-spell
`{ level: 'error', messageKey: result.error.key, timeoutMs: 0, …params }` (some omit params).

Depends on story 204 (single `Outcome` envelope).

## Acceptance Criteria

- [ ] **AC1** — `src/shared/types/common.ts` exports `Refusal<R> = { ok: false; reasonKey: R; params? }`,
      `DomainResult<T, R>` and `refuse()`; the five to seven local `fail`/`refuse` copies are
      deleted.
- [ ] **AC2** — The servers and replays in-band result types (`ManualServerAddResult`,
      `MasterSourcesResult`, `ScanStartResult`, `QuickFiltersResult`, `WatchlistMutationResult`,
      `ExtraFoldersResult`, `DemoFileActionResult`, `ReplaysStageResult`) are expressed as
      `DomainResult` and main sends full i18n keys; no renderer file builds a key from a
      `${reason}` template (grep-zero for `` `.*\.\${reason`` in `src/renderer`).
- [ ] **AC3** — `src/renderer/src/lib/toast.ts` exports `toastOutcomeError`/`toastRefusal`;
      the 12 inline toast literals use them; params are never dropped.
- [ ] **AC4** — Story 204's error-key test also scans `reasonKey` literals in main and the keys
      are all present in `en.json`.
- [ ] **AC5** — docs/ARCHITECTURE.md documents the two shapes (`Outcome` for transport/unexpected,
      `Refusal` for a domain "no") in one paragraph.
- [ ] **AC6** — The affected flows (`servers-master-sources`, `servers-quick-filters`,
      `replays-extra-folders`, watchlist and demo file actions) stay green or are fixed inside
      this story.

## Open Questions

- [ ] **Q1** — Should `Refusal` carry `params` typed per key, or stay `Record<string, string | number>`
      like toasts do today?

## Plan

<!-- Filled by /refine 206. -->

## Deliverables

<!-- Filled by /refine 206. -->

## Model Hints

<!-- Filled by /refine 206. -->

## Acceptance Tests

<!-- Filled by /refine 206. -->

## Done

<!-- Filled by /build 206. -->
