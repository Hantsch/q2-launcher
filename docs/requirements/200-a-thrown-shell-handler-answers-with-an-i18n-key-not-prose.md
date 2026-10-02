---
id: 200
title: a thrown shell handler answers with an i18n key, not prose
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — `handleOutcome` catches a thrown handler, logs it with the channel name at `error`
      level, and resolves `fail('ipc.error.handlerFailed', { channel })`. A test in
      `src/main/ipc/index.test.ts` with a throwing handler proves the outcome and that the
      resolved value contains no part of the thrown message.
- [ ] **AC2** — Plain `handle` logs the same way and rethrows a sanitised `Error` whose message is
      the key `ipc.error.handlerFailed`; the test proves the rejection text contains neither the
      original message nor a path.
- [ ] **AC3** — `ipc.error.handlerFailed` exists in `src/renderer/src/i18n/locales/en.json` and
      is covered by the error-key test introduced by story 204 (or a minimal check in this story
      if 204 has not landed).
- [ ] **AC4** — docs/ARCHITECTURE.md's IPC section states the rule in one paragraph: expected
      failures are `Outcome`, a throw is a bug, and both surfaces turn a throw into
      `*.error.handlerFailed`.
- [ ] **AC5** — No handler behaviour changes for the success and `Outcome`-failure paths (existing
      `src/main/ipc/*.test.ts` stay green unchanged).

## Open Questions

- [ ] **Q1** — Should the renderer bridge (`src/renderer/src/lib/bridge.ts`) map a rejected plain
      `invoke` onto the error toast, or is that left to callers as today? The review's value
      judge recommends leaving the bridge alone in this story.

## Plan

<!-- Filled by /refine 200. -->

## Deliverables

<!-- Filled by /refine 200. -->

## Model Hints

<!-- Filled by /refine 200. -->

## Acceptance Tests

<!-- Filled by /refine 200. -->

## Done

<!-- Filled by /build 200. -->
