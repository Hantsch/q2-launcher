---
id: 200
title: a thrown shell handler answers with an i18n key, not prose
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want a shell IPC call that fails unexpectedly (EPERM on a path, a missing executable,
a bug) to show a translated error, and as the maintainer I want both IPC surfaces to follow the
same error contract, so that no new shell channel has to re-decide the policy.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F10): the 49 shell channels
are registered through `handle`/`handleOutcome` in `src/main/ipc/index.ts` and there is no `try`
anywhere under `src/main/ipc`. `handleOutcome` maps only a failed `safeParse` to `fail(...)`; a
throw from, say, `installations:inspectPath` rejects the renderer promise with Electron's
"Error invoking remote method … Error: EPERM …" — English prose carrying a filesystem path,
exactly what CLAUDE.md's "main sends i18n keys, never prose" forbids. The module bus
(`MainModuleRegistry.invoke`) already catches and answers `fail('modules.error.handlerFailed')`;
the two surfaces disagree.

## Acceptance Criteria

- [x] **AC1** — `handleOutcome` catches a thrown handler, logs it with the channel name at `error`
      level, and resolves `fail('ipc.error.handlerFailed', { channel })`. A test in
      `src/main/ipc/index.test.ts` with a throwing handler proves the outcome and that the
      resolved value contains no part of the thrown message.
- [x] **AC2** — Plain `handle` logs the same way and rethrows a sanitised `Error` whose message is
      the key `ipc.error.handlerFailed`; the test proves the rejection text contains neither the
      original message nor a path.
- [x] **AC3** — `ipc.error.handlerFailed` exists in `src/renderer/src/i18n/locales/en.json` and
      is covered by the error-key test introduced by story 204 (or a minimal check in this story
      if 204 has not landed).
- [x] **AC4** — docs/ARCHITECTURE.md's IPC section states the rule in one paragraph: expected
      failures are `Outcome`, a throw is a bug, and both surfaces turn a throw into
      `*.error.handlerFailed`.
- [x] **AC5** — No handler behaviour changes for the success and `Outcome`-failure paths (existing
      `src/main/ipc/*.test.ts` stay green unchanged).

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — Should the renderer bridge (`src/renderer/src/lib/bridge.ts`) map a rejected plain
  `invoke` onto the error toast, or is that left to callers as today? The review's value
  judge recommends leaving the bridge alone in this story.

## Decisions (Sprint)

- **(User)** renderer bridge: Leave `bridge.ts` alone; only main answers with a key.
- Triage: trivial-but-planned — one wrapper file, one locale key, one doc paragraph; a single
  default-tier D, because the sprint runs `/build` on every story.
- Only the **handler** call is wrapped; the schema step is not: `handle`'s `schema.parse` keeps
  throwing synchronously and `handleOutcome`'s `safeParse` → `fail(invalidKey)` is untouched, because
  AC5 pins the existing "rejects an invalid payload … synchronously" tests unchanged and a ZodError
  carries field paths, not filesystem paths.
- The catch covers both a synchronous throw and a rejected promise from the handler (`await` inside
  `try`), because `installations:inspectPath`-style handlers are async and an EPERM is a rejection.
- Log line mirrors `MainModuleRegistry.invoke` (`src/main/modules/registry.ts:141`):
  `log.error(\`handler for channel '${channel}' threw\`, error)`on the existing`ipc` scoped logger,
  because one log shape for both surfaces is the point of the story.
- `handle` rethrows `new Error('ipc.error.handlerFailed')` with no channel or params in the
  message, because AC2 asks for the bare key and the channel is already in the log line.
- en.json text: `"handlerFailed": "The launcher failed while handling \u201c{{channel}}\u201d. This is a bug."`
  under `ipc.error`, because it matches the tone of the sibling `invalidPayload` and of
  `modules.error.handlerFailed`.
- AC3 takes the "minimal check" branch: story 204 is built after 200 in S32's order, so this story
  adds a leaf-exists assertion; 204's scan will cover the key again later.
- AC4 is proven by a cheap doc-content assertion (ARCHITECTURE.md contains both
  `ipc.error.handlerFailed` and `modules.error.handlerFailed`), because P1 needs a named test and
  the paragraph's existence is the observable part.
- The throwing-handler tests call `handle`/`handleOutcome` directly on a freshly imported
  `./index` with a stub handler, not via `registerAllIpc`, because the wrapper is the unit under
  test and no real service needs to fail.
- CHANGELOG gets one `### Fixed` line under `## Unreleased`, because a translated message instead of
  English prose with a path is a user-visible fix (sprint goal says so).

## Plan

1. `src/main/ipc/index.ts`: add `HANDLER_FAILED_KEY = 'ipc.error.handlerFailed'`. In `handle`, parse
   first (unchanged, synchronous), then run the handler in an async `try/await/catch`: log with the
   channel, rethrow `new Error(HANDLER_FAILED_KEY)`. In `handleOutcome`, keep the `safeParse` branch,
   then `try { return await handler(...) } catch { log; return fail(HANDLER_FAILED_KEY, { channel }) }`.
   Update both JSDoc blocks.
2. `en.json`: add `ipc.error.handlerFailed`.
3. `docs/ARCHITECTURE.md` IPC section: one paragraph — expected failures are `Outcome`, a throw is a
   bug, and both surfaces (`handle`/`handleOutcome`, `MainModuleRegistry.invoke`) turn a throw into
   `*.error.handlerFailed`, logged with the channel/handler.
4. Tests appended to `src/main/ipc/index.test.ts` (no existing `it` edited).
5. CHANGELOG line.

Order: one deliverable, all of the above.

## Deliverables

- **D1 — both shell IPC wrappers answer a throw with `ipc.error.handlerFailed`.**
  Files: `src/main/ipc/index.ts`, `src/main/ipc/index.test.ts`,
  `src/renderer/src/i18n/locales/en.json`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`.
  Mirror: the `try/catch` in `MainModuleRegistry.invoke` (`src/main/modules/registry.ts:138-146`).
  - `index.ts`: new constant `HANDLER_FAILED_KEY = 'ipc.error.handlerFailed'` next to
    `INVALID_PAYLOAD_KEY`. `handle`: keep `schema.parse(payload)` synchronous and outside any try
    (an invalid payload must still throw synchronously); then call the handler inside an async
    function with `try { return await handler(data, event) } catch (error) { log.error(\`handler
    for channel '${channel}' threw\`, error); throw new Error(HANDLER_FAILED_KEY) }`.
`handleOutcome`: keep `safeParse`→`return fail(invalidKey)`unchanged; then the same
try/await/catch, returning`fail(HANDLER_FAILED_KEY, { channel })`. Update both JSDoc comments.
Success and `Outcome`-failure return values pass through untouched.
  - `en.json`: under `"ipc": { "error": { … } }` add
    `"handlerFailed": "The launcher failed while handling \u201c{{channel}}\u201d. This is a bug."`
    (keep the file's existing `\u201c`/`\u201d` escape style; edit only this block — never run
    prettier over the file or globs).
  - `docs/ARCHITECTURE.md`, section "## The IPC contract": add one paragraph after the
    `handle`/`handleOutcome` paragraph: expected failures are an `Outcome`; a throw is a bug; both
    surfaces turn a throw into a key — the shell wrappers into `ipc.error.handlerFailed`
    (`handleOutcome` resolves `fail(…, { channel })`, `handle` rejects with an `Error` whose message
    is the key) and the module bus into `modules.error.handlerFailed` — and log the original error
    with the channel/handler; never prose or a path across IPC.
  - `CHANGELOG.md`: under `## Unreleased` › `### Fixed` (create the heading if absent), one line,
    ≤15 words, e.g. "An unexpected launcher error now shows a translated message instead of raw
    system text."
  - Tests appended to `src/main/ipc/index.test.ts` (do not modify any existing `it`). Mock
    `../lib/logger` with a hoisted spy logger (`scopedLogger: () => ({ info, warn, error, debug })`
    as `vi.fn()`s) so the `error` call can be asserted. Call `handle`/`handleOutcome` directly on a
    fresh `await import('./index')` with a real channel (e.g. `installations:inspectPath` for
    `handleOutcome`, `window:getState` or any plain channel for `handle`), a permissive schema
    (`z.any()` cast), and a handler that throws
    `new Error("EPERM: operation not permitted, open 'C:\\secret\\q2\\baseq2'")`; then invoke the
    captured listener from the `registered` map. Tests (names below) cover: sync throw and async
    rejection for `handleOutcome`; rejection for `handle`; log assertion; en.json leaf exists
    (`import en from '../../renderer/src/i18n/locales/en.json'`, precedent:
    `src/main/services/update/service.actions.test.ts`); ARCHITECTURE.md contains both
    `ipc.error.handlerFailed` and `modules.error.handlerFailed` (read with `node:fs` relative to
    the repo root).
  - Acceptance: `npx vitest run src/main/ipc` green, `npm run typecheck` green.

## Model Hints

- D1 → default.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/ipc/index.test.ts` › "handleOutcome resolves a thrown handler to ipc.error.handlerFailed with the channel and logs it"
  and › "handleOutcome resolves a rejected async handler to ipc.error.handlerFailed" — assert
  `toEqual({ ok: false, error: { key: 'ipc.error.handlerFailed', params: { channel } } })`,
  `JSON.stringify(result)` contains neither `EPERM` nor `secret`, and the spy logger's `error`
  was called with a message containing the channel.
- AC2 → unit `src/main/ipc/index.test.ts` › "handle rejects a thrown handler with a sanitised ipc.error.handlerFailed error"
  — rejection is an `Error` with `message === 'ipc.error.handlerFailed'`, message contains neither
  `EPERM` nor `C:\\`, and the spy logger's `error` was called with the channel.
- AC3 → unit `src/main/ipc/index.test.ts` › "ipc.error.handlerFailed resolves to a string in en.json"
  (minimal check; 204's scan supersedes it later).
- AC4 → unit `src/main/ipc/index.test.ts` › "ARCHITECTURE.md states that both surfaces turn a throw into handlerFailed".
- AC5 → unit: the existing suites `npx vitest run src/main/ipc` stay green with no existing test
  case modified (review checks the diff of `src/main/ipc/*.test.ts` is additions only).
- No `ui:flow` line: no user action is introduced — the change is the main-side reply shape, and
  the bridge is deliberately untouched (User decision).

## Done

Both shell IPC wrappers now catch a throwing handler (sync or rejected): `handleOutcome` resolves `fail('ipc.error.handlerFailed', { channel })`, `handle` rejects with `Error('ipc.error.handlerFailed')`; both log the original error with the channel. en.json key, ARCHITECTURE.md paragraph and a CHANGELOG line added.

Commit: `200: thrown shell IPC handler answers with ipc.error.handlerFailed key, not prose`

Verification (narrow gate): `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (120 files / 992 tests) green; no e2e (no `ui:flow` line, bridge untouched). AC1-AC5 mapped to the five tests in `src/main/ipc/index.test.ts` (names as in Acceptance Tests), all ran and passed; AC5: diff of the test file is additions only. No manual residue. Review (default): PASS, 1 cycle.

Decisions: handler-only wrapping per sprint decisions; AC3 minimal en.json leaf check (204 supersedes). Deliberately unfixed review nits: logged-error argument asserted via `expect.anything()` (channel in message is asserted); first two tests share assertions; one `.then(` continuation indented off-style (repo not prettier-clean, no prettier run).

tiers: D 1 / hard 0 · review default · cycles 1 · agents 3
