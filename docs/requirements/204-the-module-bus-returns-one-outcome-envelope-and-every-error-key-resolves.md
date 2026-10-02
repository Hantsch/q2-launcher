---
id: 204
title: the module bus returns one Outcome envelope and every error key resolves
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a module handler that returns `Outcome<T>` to arrive in the renderer as
`Outcome<T>`, not `Outcome<Outcome<T>>`, so that no client needs a flattener, a forgotten flatten
can no longer treat a failure as success, and the type tells the truth. And I want every error
key main can send to be proven present in the locale by a test, not by discipline.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F04 part 1–2, F31):
`MainModuleRegistry.invoke` wraps every handler return in `ok(...)` unconditionally while config
(46 `fail()` sites), downloads (44), replays (62) and mods (33) handlers already return their own
`Outcome`. Clients cope four ways: 21 per-function flatteners in `config/client.ts` (each with a
copied "double-unwrap gotcha" comment), 7 in downloads, mods flattens unconditionally in its
`call<T>` wrapper (a latent bug for plain-value handlers), replays exposes
`Promise<Outcome<Outcome<NameTemplatesView>>>` to components, and 13+ component sites unwrap
`.value.ok` by hand. The replays client records a shipped user-facing crash from this. Separately,
all 88 `fail('…')` literal keys in main currently resolve in `en.json`, but nothing enforces it;
mods has no typed error keys (12 `'mods.error.*'` literals, outcomes typed `key: string`,
`'downloads.error.diskWrite'` borrowed), and `toMetadataWarnings` builds
`config.import.warning.${reason}` from a widened `string`.

## Acceptance Criteria

- [ ] **AC1** — `src/shared/types/common.ts` exports `isOutcome(value)`; `MainModuleRegistry.invoke`
      passes a handler's own `Outcome` through and wraps only plain values; `ModuleSetup.handle`'s
      handler type is `(p: T) => R | Outcome<R> | Promise<…>`. Registry tests cover both shapes
      and a handler that returns `fail(...)`.
- [ ] **AC2** — Every client flattener (`result.ok ? result.value : result` and the mods `call<T>`
      unwrap) and every component-side `.value.ok` unwrap is deleted; `git grep -n 'double-unwrap'`
      and `git grep -n '\.value\.ok' src/renderer` return nothing; replays' client signatures are
      single-envelope.
- [ ] **AC3** — A test (`src/renderer/src/i18n/error-keys.test.ts` or in main) scans
      `src/main/**/*.ts` for `fail('…')` literals and exported error-key constants and asserts each
      resolves to a leaf in `en.json`; it fails on a deliberately misspelled key.
- [ ] **AC4** — mods has `MODS_ERROR_KEYS`/`ModsErrorKey` mirroring downloads; all mods job
      outcomes are typed with it; `mods.error.diskWrite` exists instead of borrowing downloads'.
- [ ] **AC5** — `toMetadataWarnings` is typed on `RestoreWarningReason` with a
      `Record<RestoreWarningReason, key>` and a test that every reason resolves.
- [ ] **AC6** — Every existing module client test and the module index tests pass; no flow
      changes (the wire shape for plain-value handlers is unchanged).

## Open Questions

- [ ] **Q1** — The review's value judge recommends typing `handle`'s return so the compiler, not a
      runtime `isOutcome` sniff, enforces the single envelope — i.e. require every handler to
      return `Outcome<R>` and convert the few plain-value handlers. Which is it: sniff-and-wrap
      (zero handler edits) or compile-time (safer, ~20 handler edits)?

## Plan

<!-- Filled by /refine 204. -->

## Deliverables

<!-- Filled by /refine 204. -->

## Model Hints

<!-- Filled by /refine 204. -->

## Acceptance Tests

<!-- Filled by /refine 204. -->

## Done

<!-- Filled by /build 204. -->
