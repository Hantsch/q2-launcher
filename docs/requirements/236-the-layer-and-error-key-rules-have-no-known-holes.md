---
id: 236
title: the layer and error-key rules have no known holes
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

Stories [[204]], [[206]], [[208]] and [[209]] made the module bus, the refusal shape and the layer
rules a test and a linter. Their reviews named the places where the rule is still only a convention:

- [[209]]: modules still call `lib/paths.userDataDir()`, `lib/net/fetcher` and `lib/native-image`
  directly (narrow electron-backed shell libs), not through `app`, and no test enforces that either way.
- [[208]]: oxlint's builtin `paths` list is shorter than the architecture test's predicate, so lint
  and test disagree about which node builtins are forbidden in shared and renderer code.
- [[206]]: `${reason}` key templates remain in `master-source-address.ts`, playback-console, userinfo,
  master-records and installations, and the error-key scan does not cover `fail(\`...\`)` templates.
- [[204]]: the AC2 grep for `.value.ok` was narrowed to a listed set of 7 files; a few shared comments
  still point at old paths.
- [[225]]: `parseMissingKeyHandler` in the renderer i18n now renders an unknown unlock feature id as
  the id itself; whether that deserves a translated fallback was not decided.

The maintainer wants these rules enforced by the same test or linter that already guards their
neighbours, so a future change cannot reopen a hole unnoticed.

## Acceptance Criteria

- [ ] **AC1** — Either modules reach user-data dir, fetcher and native-image only through `app`, or
      `src/architecture.test.ts` lists them as an allowlisted edge with a reason per entry.
- [ ] **AC2** — The set of node builtins forbidden by `.oxlintrc.json` equals the architecture test's,
      checked by a test that compares the two.
- [ ] **AC3** — No `fail()` or refusal key is built from a template; the error-key scan covers
      `fail(\`...\`)` and the five remaining `${reason}` sites use literal key records.
- [ ] **AC4** — The `.value.ok` check covers all of `src/renderer`, not a listed set of files, and no
      comment points at a path that no longer exists.
- [ ] **AC5** — An unknown unlock feature id renders through a translated fallback (decided in
      refine), with a unit test.

## Open Questions

<!-- AC1: move to `app`, or document and allowlist? AC5: is a translated fallback wanted, or is the
raw id right for an id nobody should see? -->

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
