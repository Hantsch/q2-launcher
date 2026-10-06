---
id: 221
title: HTTP fetches share one timeout and size policy
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want a stalled or oversized server-list source never to hang a scan or fill memory.
As the maintainer I want one fetch wrapper with timeout, retry, byte cap and error
classification, so that the policy exists once and the path that most needs it (a
user-configurable URL) has it.

Today ([review 2026-10-01](../../reviews/2026-10-01-codebase-review.md), F20; the missing timeout is
a roadmap follow-up since S24): `resolveHttpListSource` fetches a user-configurable URL with only
the parent scan's abort signal — no `AbortSignal.timeout` — then `response.text()`/`arrayBuffer()`
with no content-length check or byte cap. `feed-fetcher.ts` and `fetch-image.ts` each contain a
byte-identical `describeError(error, timeoutMs)`, identical `discard(response)` and the same
retry loop; `AbortSignal.timeout` is wired by hand at five sites; external→internal abort
forwarding is duplicated in `http-list-source` and `scan-runner`; `delay(ms, signal)` is private
to `fetcher.ts`. Six wrappers, six policies.

## Acceptance Criteria

- [x] **AC1** — `src/main/lib/http.ts` exports `fetchWithPolicy(url, { fetchImpl, timeoutMs,
retries, maxBytes, signal, log })` composing `AbortSignal.any([signal, AbortSignal.timeout(ms)])`,
      `readBodyCapped`, `describeFetchError` and `delay`; unit tests cover timeout, external
      abort, retry-then-succeed, body over cap, and error classification.
- [x] **AC2** — `feed-fetcher.ts` and `fetch-image.ts` use it; their existing tests (367 + 251
      lines) pass as the regression suite; `describeError` exists once.
- [x] **AC3** — `http-list-source.ts` uses it with a per-source budget (~10 s) and a cap
      (~2 MiB), mapped to the existing `transport-error`/`truncated` source states; a test proves
      a hanging source ends the fetch while the scan continues.
- [x] **AC4** — `content-repo.ts`, the bleeding-edge download (after story 220) and `scan-runner`
      reuse the classifier and the abort composition; `downloads/fetcher.ts` keeps streaming but
      imports `delay` and `describeFetchError` from `http.ts`.
- [x] **AC5** — The roadmap follow-up about `resolveHttpListSource` is removed.

## Open Questions

- none

## Decisions (Sprint)

- **Outcome, not throw:** `fetchWithPolicy` never throws and returns `{ ok: true, status, headers, body: Uint8Array }` or `{ ok: false, kind: 'timeout' | 'aborted' | 'network' | 'http-status' | 'too-large', status?, headers?, reason }`, so feed (304), image (404/410) and list source (status code) keep their own status semantics on one shared retry loop.
- **Retry rule:** retried are `timeout`, `network`, 5xx and a body-read error; never an external abort, a non-5xx status or `too-large` — exactly today's feed/image rule, which stays their regression baseline.
- **Timeout is per attempt** (a fresh `AbortSignal.timeout` each try) and `retryDelayMs` defaults to 0, because both migrated callers behave that way today and their tests pin the timing.
- **Classification by signal state, not error name:** `timeout` vs `aborted` is decided by which composed signal fired, because `electronNetFetch` and Node fetch do not reject with the same error names.
- **Retry log text is the caller's:** an `onRetry(reason)` callback builds the warning, because the feed (`news: … retrying once`) and image (`news image … retrying once`) messages differ and stay as they are.
- **`maxBytes` is required**, so every caller states its cap: feed documents 1 MiB (uncapped today; news docs are a few KB), content-repo JSON 4 MiB, the `version.txt` probe 64 KiB, images keep `MAX_IMAGE_BYTES`, list sources 2 MiB.
- **A declared `content-length` over the cap is refused before reading**, carrying `fetch-image.ts`'s existing pre-check into the shared reader for every caller.
- **`FetchImpl` moves to `src/main/lib/http.ts`** (with optional `headers`/`method`) and `downloads/fetcher.ts` re-exports it, because `lib/` must not import from a module (story 208) and existing importers then need no edit.
- **List-source mapping:** `timeout`/`network`/`aborted`/body-read error → `transport-error`, `too-large` → `truncated`, `http-status` → `http-status` with its code; budget 10 s, no retry, both budget and cap overridable (`ResolveSourcesDeps.httpListTimeoutMs`) so the hang test runs in milliseconds.
- **Bleeding-edge scope:** 221 is built before 220, which deletes `downloadUnpinnedAsset` and routes the unpinned download through `fetcher.ts`; so 221 migrates only the bleeding-edge _probe_ (`bleeding-edge.ts`, two of the five hand-wired `AbortSignal.timeout` sites) and the post-220 download is covered by `fetcher.ts` importing `delay`/`describeFetchError`.
- **scan-runner reuses the abort composition only** (`composeSignals`), because it runs UDP queries and has no fetch error to classify.
- **content-repo keeps zero retries and throwing** (`ContentRepoHttpError` for a status, an `Error` with the classifier's reason otherwise), because `ManifestService`'s ~10 s worst case and both callers' `catch` rely on it.
- **`update/service.ts`'s one-argument `describeError` stays:** it formats electron-updater errors for a log line, not a fetch, so AC2's "exists once" means the fetch classifier.
- **No e2e line:** no criterion describes a user action; the behaviour is main-process transport covered by unit tests, and the existing server-scan flows run in the sprint's `e2e-all` gate.
- **No systems doc update:** no doc under `docs/systems/` specifies these fetch paths (install-module.md item 10 is an open-questions list).
- **Changelog:** one `### Fixed` line, because a hung server-list source stalling a scan is user-visible.

## Plan

1. D1 — new `src/main/lib/http.ts`: `FetchImpl`, `composeSignals`, `delay`, `describeFetchError`,
   `readBodyCapped`, `fetchWithPolicy`, unit-tested in `http.test.ts`.
2. D2 — `feed-fetcher.ts` and `fetch-image.ts` drop their private `describeError`, `discard`,
   retry loop and capped reader and call `fetchWithPolicy`; their existing tests, unmodified, are
   the regression suite.
3. D3 — `http-list-source.ts` gets a 10 s budget and a 2 MiB cap through `fetchWithPolicy`; its
   hand-rolled abort forwarding goes; `source-resolution.ts` threads a timeout override; a test
   proves a hanging source ends while the others resolve. Roadmap bullet removed, changelog line.
4. D4 — `content-repo.ts`, `bleeding-edge.ts` (probe), `scan-runner.ts` and `downloads/fetcher.ts`
   reuse `composeSignals`/`describeFetchError`/`delay`; no hand-wired `AbortSignal.timeout`
   remains outside `http.ts`.

Order D1 → D2 → D3 → D4 (D2–D4 depend only on D1). Main process only; no IPC, no renderer.

## Deliverables

- **D1 — `src/main/lib/http.ts` + `src/main/lib/http.test.ts`.** New file; imports nothing from
  `src/main/modules/` or `electron`. Exports:
  - `type FetchImpl = (url: string, init: { signal: AbortSignal; headers?: Record<string, string>; method?: 'GET' | 'HEAD' }) => Promise<Response>`.
  - `composeSignals(...signals: (AbortSignal | undefined)[]): AbortSignal` — `AbortSignal.any`
    over the defined ones (a never-aborting signal when none is given).
  - `delay(ms, signal?)` — copy the body of the private `delay` in
    `src/main/modules/downloads/fetcher.ts:182` verbatim (abortable, resolves on abort, `ms <= 0`
    resolves at once). Do not edit `fetcher.ts` in this D.
  - `describeFetchError(error: unknown, timeoutMs?: number): string` — the exact text of today's
    `describeError` in `src/main/modules/home/news/feed-fetcher.ts:178`: a `TimeoutError` with
    `timeoutMs` given → `no response within ${timeoutMs}ms`; otherwise `String(error)` plus
    ` (${String(error.cause)})` when the error has a cause.
  - `readBodyCapped(response, maxBytes)` → `{ ok: true; body: Uint8Array } | { ok: false; reason: string }`:
    a valid `content-length` header over the cap is refused before reading (reason
    `declared content-length <n> exceeds <cap> bytes`); otherwise it streams and cancels the reader
    as soon as _received_ bytes exceed the cap (reason `body exceeds <cap> bytes`); `body === null`
    → empty. Port from `readCappedBody`/`parseContentLength` in
    `src/main/modules/home/images/fetch-image.ts`. A read rejection propagates to the caller.
  - `fetchWithPolicy(url, { fetchImpl, timeoutMs, retries, maxBytes, signal?, headers?, method?, retryDelayMs?, onRetry? })`
    → `Promise<FetchOutcome>`, never throws, where
    `FetchOutcome = { ok: true; status: number; headers: Headers; body: Uint8Array } | { ok: false; kind: 'timeout' | 'aborted' | 'network' | 'http-status' | 'too-large'; status?: number; headers?: Headers; reason: string }`.
    Per attempt: a fresh `AbortSignal.timeout(timeoutMs)` composed with `signal` via
    `composeSignals`; the same signal covers the body read. Classify a rejection by signal state:
    `signal?.aborted` → `aborted`; the attempt's timeout signal aborted → `timeout`; anything else
    → `network`; reason `describeFetchError(error, timeoutMs)`. A non-2xx response is discarded
    (`response.body?.cancel()`, errors swallowed) and returned as `http-status` with `status`,
    `headers`, reason `HTTP <status>`. A 2xx body goes through `readBodyCapped`; over cap →
    `too-large`; a body-read rejection is classified like a fetch rejection, reason prefixed
    `body could not be read: `. `method: 'HEAD'` skips the body read (empty `body`).
    Retried, at most `retries` extra attempts: `timeout`, `network`, `http-status` with status
    ≥ 500. Between attempts call `onRetry?.(reason)` then `await delay(retryDelayMs ?? 0, signal)`.
    Never retried: `aborted`, any other status, `too-large`. After the last attempt return its
    outcome.
    Tests in `http.test.ts` (127.0.0.1 loopback `http` server or an injected fake `FetchImpl`;
    short timeouts like 50 ms), one per AC1 line in `## Acceptance Tests`.
- **D2 — feed and image fetchers on `fetchWithPolicy`.** Files:
  `src/main/modules/home/news/feed-fetcher.ts`, `src/main/modules/home/images/fetch-image.ts`.
  Delete both private `describeError`, `discard`, the retry loops (`attemptRequest`/`request`,
  `requestOnce`/`requestWithRetry`), `readCappedBody` and `parseContentLength`; call
  `fetchWithPolicy` from `src/main/lib/http.ts` (D1) with each file's existing `timeoutMs`,
  `retries` and `fetchImpl`. Feed: `headers` carries `if-none-match` exactly as today;
  `http-status` 304 → `not-modified`, any other failure → `failed` with the outcome's `reason`;
  new constant `NEWS_DOCUMENT_MAX_BYTES = 1 MiB` as `maxBytes`; body decoded with `TextDecoder`;
  `onRetry` warns `news: ${url} failed (${reason}); retrying once`. Image: `http-status` 404/410
  → `gone`, `too-large` → `rejected` with the outcome's reason, other failures → `unavailable`
  with its reason; the content-type check stays (after the fetch); `maxBytes: MAX_IMAGE_BYTES`;
  `onRetry` warns `news image ${url} failed (${reason}); retrying once`. `NewsFetchImpl` and
  `ImageFetchImpl` stay exported. Acceptance: `feed-fetcher.test.ts` and `fetch-image.test.ts`
  pass **unmodified**; `grep -rn "function describeError" src/main` finds only
  `src/main/services/update/service.ts` (an electron-updater log helper, out of scope).
- **D3 — the HTTP list source gets a budget and a cap.** Files:
  `src/main/modules/servers/http-list-source.ts`, `src/main/modules/servers/source-resolution.ts`,
  `src/main/modules/servers/http-list-source.test.ts`,
  `src/main/modules/servers/source-resolution.test.ts`, `docs/ROADMAP.md`, `CHANGELOG.md`.
  Replace the hand-rolled `AbortController` forwarding in `resolveHttpListSource` with
  `fetchWithPolicy` from `src/main/lib/http.ts`: `{ fetchImpl, signal, retries: 0, timeoutMs: opts.timeoutMs ?? HTTP_LIST_TIMEOUT_MS, maxBytes: opts.maxBytes ?? HTTP_LIST_MAX_BYTES }`
  with exported constants 10 000 ms and 2 MiB; import `FetchImpl` from `src/main/lib/http.ts`.
  Map `timeout`/`network`/`aborted` → `{ ok: false, reason: 'transport-error' }`, `too-large` →
  `truncated`, `http-status` → `{ reason: 'http-status', status }`; `raw === 1` decodes the body
  with `TextDecoder` for `parseHttpListText`, `raw === 2` passes the bytes to
  `parseHttpListBinary`. Add `httpListTimeoutMs?: number` to `ResolveSourcesDeps` and pass it as
  `timeoutMs` in `resolveOneSource`. Update both files' doc comments (the "body that errors
  mid-read" gap in `source-resolution.ts` is closed; keep `Promise.allSettled`). Remove the bullet
  starting "`resolveHttpListSource`'s master/list sources have no bounded timeout" from
  `docs/ROADMAP.md`. Add under `## Unreleased` → `### Fixed` in `CHANGELOG.md` (create the
  heading if absent): `- **Servers** — A stalled or oversized server-list source no longer hangs a scan.`
  Tests: the AC3 lines; existing `http-list-source.test.ts` cases keep passing.
- **D4 — the remaining fetch sites reuse the policy pieces.** Files: `src/main/lib/content-repo.ts`,
  `src/main/lib/content-repo.test.ts`, `src/main/modules/downloads/engine/bleeding-edge.ts`,
  `src/main/modules/downloads/engine/bleeding-edge.test.ts`, `src/main/modules/servers/scan-runner.ts`,
  `src/main/modules/downloads/fetcher.ts`. All imports from `src/main/lib/http.ts` (D1).
  - `fetchContentJson`: `fetchWithPolicy(url, { fetchImpl: (u, i) => fetch(u, i), timeoutMs: opts?.timeoutMs ?? 10_000, retries: 0, maxBytes: 4 MiB })`
    (global `fetch` read lazily so `vi.stubGlobal('fetch', …)` still works); `http-status` →
    throw `ContentRepoHttpError(status, url)`; any other failure → throw
    `new Error('content repo request failed: ' + reason + ' ' + url)`; parse with
    `JSON.parse(new TextDecoder().decode(body))`. Existing tests may be adapted only where they
    assert the old signal plumbing; they must still prove the timeout value reaches
    `AbortSignal.timeout`.
  - `probeBleedingEdge`: `version.txt` through `fetchWithPolicy` (`retries: 0`,
    `timeoutMs: PROBE_TIMEOUT_MS`, `maxBytes: 64 KiB`, global `fetch` read lazily), the `HEAD`
    through `fetchWithPolicy` with `method: 'HEAD'`; failures still throw
    `BleedingEdgeProbeFailedError` carrying the outcome's reason. Do not touch
    `engine/update-job.ts` (story 220 deletes `downloadUnpinnedAsset`).
  - `scan-runner.ts`: replace the `onExternalAbort` listener add/remove (around lines 171–176 and 255) with `const internal = composeSignals(controller.signal, external)`; keep the early return
    for an already-aborted `external` and every abort guarantee in the file doc comment.
  - `fetcher.ts`: delete the private `delay`; import `delay` and `describeFetchError`; the transport
    fallback `String(error)` in `classify` becomes `describeFetchError(error)`; replace the local
    `FetchImpl` declaration with `export type { FetchImpl } from '../../lib/http'` (plus a type
    import for local use). Streaming, stall timer and size-overrun logic stay unchanged.
    Acceptance: outside test files, `grep -rn "AbortSignal.timeout" src/main` finds only
    `src/main/lib/http.ts`; `scan-runner.test.ts`, `fetcher.test.ts`, `manifest-service.test.ts` and
    the mods catalog-service tests pass unmodified; the AC4 test lines pass.

## Model Hints

- All Ds → default tier. D1's subtle part (timeout vs external-abort classification, no retry on
  abort) is spelled out in the D and pinned by its own tests.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/lib/http.test.ts` › "a response slower than timeoutMs ends as timeout with the 'no response within' reason" (D1)
- AC1 → unit `src/main/lib/http.test.ts` › "an external abort ends the fetch as aborted and is never retried" (D1)
- AC1 → unit `src/main/lib/http.test.ts` › "a 503 then a 200 succeeds on the retry and calls onRetry once" (D1)
- AC1 → unit `src/main/lib/http.test.ts` › "a body over maxBytes is too-large, by declared content-length and by streamed bytes" (D1)
- AC1 → unit `src/main/lib/http.test.ts` › "a 404 is http-status and not retried; a network rejection is network with its cause" (D1)
- AC2 → unit `src/main/modules/home/news/feed-fetcher.test.ts` and `src/main/modules/home/images/fetch-image.test.ts`, whole files, unmodified (D2); "describeError exists once" is D2's grep acceptance.
- AC3 → unit `src/main/modules/servers/source-resolution.test.ts` › "a hanging http-list source ends at its budget as transport-error while the other sources still resolve" (D3)
- AC3 → unit `src/main/modules/servers/http-list-source.test.ts` › "a body over the cap is reported as truncated" (D3)
- AC4 → unit `src/main/lib/content-repo.test.ts` › "a request that never answers fails with the timeout reason instead of hanging" (D4)
- AC4 → unit `src/main/modules/downloads/engine/bleeding-edge.test.ts` › "a version.txt that never answers fails the probe with a probe-failed error" (D4)
- AC4 → unit `src/main/modules/servers/scan-runner.test.ts` › "an abort in stage 1 stops both stages and settles without waiting for in-flight queries" and "an abort in stage 2 stops it, and an already-aborted signal starts nothing" (existing, D4 regression for the abort composition); `src/main/modules/downloads/fetcher.test.ts` whole file (D4); D4's grep acceptance for the single `AbortSignal.timeout` site.
- AC5 → D3's acceptance: the roadmap bullet is gone (checked in review of the diff; a doc edit has no runtime test).

## Done

All fetch sites now share `src/main/lib/http.ts` (`fetchWithPolicy`, `readBodyCapped`, `describeFetchError`, `delay`, `composeSignals`). Feed and image fetchers use it; the HTTP list source gets a 10 s budget and 2 MiB cap (`transport-error`/`truncated`); content-repo, the bleeding-edge probe, scan-runner and `lib/net/fetcher.ts` reuse the pieces. Only `http.ts` calls `AbortSignal.timeout`; ROADMAP bullet removed, one `### Fixed` changelog line.

Commit message: `221: http fetches share one timeout/size policy (lib/http.ts fetchWithPolicy); list sources get a 10 s budget and 2 MiB cap`

Verification (narrow gate): `npm run build`, `typecheck`, `lint` green; `npx vitest run --changed HEAD` green (47 files / 555 tests); no e2e line by design (`e2e-all` is the sprint's gate). AC1-AC5 mapped tests all ran and passed (http.test.ts x5, source-resolution hanging-source, http-list-source truncated, content-repo and bleeding-edge timeout tests, feed/image/scan-runner/net-fetcher files green). AC5 checked in review of the diff. No manual residue. Review: stage 1 FAIL on test quality, fixed (2 cycles), second review PASS.

Decisions:

- Story paths mapped to current locations: `fetcher.ts` is `src/main/lib/net/fetcher.ts` (import `../http`), manifest service in `src/main/services/content/`.
- Tests that faked responses as plain objects without a body stream (manifest-service, catalog-service, engine-options, downloads index, content-repo, bleeding-edge, source-resolution) had their response helpers changed to real `new Response(...)`, assertions unchanged, because `fetchWithPolicy` reads the body stream; the story's "unmodified" list only held for scan-runner, net/fetcher, feed and image tests.
- Image fetcher: the size cap now applies while reading, before the content-type check, so an oversized body with a bad content-type is `rejected` for size; both outcomes are `rejected`.
- Bleeding-edge timeout test spies `AbortSignal.timeout` (fake timers do not cover it) so it runs in milliseconds.

tiers: D 4 / hard 0 · review default · cycles 2 · agents 8
