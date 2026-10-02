---
id: 221
title: HTTP fetches share one timeout and size policy
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want a stalled or oversized server-list source never to hang a scan or fill memory.
As the maintainer I want one fetch wrapper with timeout, retry, byte cap and error
classification, so that the policy exists once and the path that most needs it (a
user-configurable URL) has it.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F20; the missing timeout is
a roadmap follow-up since S24): `resolveHttpListSource` fetches a user-configurable URL with only
the parent scan's abort signal — no `AbortSignal.timeout` — then `response.text()`/`arrayBuffer()`
with no content-length check or byte cap. `feed-fetcher.ts` and `fetch-image.ts` each contain a
byte-identical `describeError(error, timeoutMs)`, identical `discard(response)` and the same
retry loop; `AbortSignal.timeout` is wired by hand at five sites; external→internal abort
forwarding is duplicated in `http-list-source` and `scan-runner`; `delay(ms, signal)` is private
to `fetcher.ts`. Six wrappers, six policies.

## Acceptance Criteria

- [ ] **AC1** — `src/main/lib/http.ts` exports `fetchWithPolicy(url, { fetchImpl, timeoutMs,
      retries, maxBytes, signal, log })` composing `AbortSignal.any([signal, AbortSignal.timeout(ms)])`,
      `readBodyCapped`, `describeFetchError` and `delay`; unit tests cover timeout, external
      abort, retry-then-succeed, body over cap, and error classification.
- [ ] **AC2** — `feed-fetcher.ts` and `fetch-image.ts` use it; their existing tests (367 + 251
      lines) pass as the regression suite; `describeError` exists once.
- [ ] **AC3** — `http-list-source.ts` uses it with a per-source budget (~10 s) and a cap
      (~2 MiB), mapped to the existing `transport-error`/`truncated` source states; a test proves
      a hanging source ends the fetch while the scan continues.
- [ ] **AC4** — `content-repo.ts`, the bleeding-edge download (after story 220) and `scan-runner`
      reuse the classifier and the abort composition; `downloads/fetcher.ts` keeps streaming but
      imports `delay` and `describeFetchError` from `http.ts`.
- [ ] **AC5** — The roadmap follow-up about `resolveHttpListSource` is removed.

## Open Questions

- none

## Plan

<!-- Filled by /refine 221. -->

## Deliverables

<!-- Filled by /refine 221. -->

## Model Hints

<!-- Filled by /refine 221. -->

## Acceptance Tests

<!-- Filled by /refine 221. -->

## Done

<!-- Filled by /build 221. -->
