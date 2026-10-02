---
id: 231
title: i18n keys are referenced, not duplicated, and live with their module
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want every locale key to be proven used, repeated labels to exist once, and
a module's strings to live next to the module's code, so that a wording fix is one edit, a second
locale does not translate dead keys, and a module owns its strings the way it owns its code.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F62):
`src/renderer/src/i18n/locales/en.json` is 3,614 lines, 2,398 leaf keys, 38 namespaces (`config`
alone 1,006). 196 distinct values appear under more than one key (518 keys: "Name" x26,
"Cancel" x12, "Map" x10, "Rename…" x6) while `common.*` has 29 keys; ~25 keys are dead after
discounting plurals (`app.crash.*`, `config.preservedLines.*`, `config.validation.count/subject.*`,
`units.*`). The only test is the vocabulary word filter; missing keys warn only in DEV.

Priority P3; the key-usage test (AC1) is cheap and can ride with story 204's error-key test.

## Acceptance Criteria

- [ ] **AC1** — `src/renderer/src/i18n/keys.test.ts` asserts every leaf key is referenced
      literally in `src/` or matches an allowlisted dynamic prefix (each prefix with a comment
      naming its call site); the ~25 dead keys are deleted; the test fails on an unreferenced key.
- [ ] **AC2** — Repeated action and label values are consolidated into `common.action.*` /
      `common.label.*`; a duplicate-value test fails when a value appears under more than one key
      outside an allowlist of deliberate exceptions (with reasons).
- [ ] **AC3** — Locale files are split into `src/renderer/src/modules/<id>/locale/en.json` plus
      `src/renderer/src/i18n/locales/en.shell.json`, deep-merged in `initI18n`; the merged result
      is identical to today's bundle (snapshot test); "Adding a module" names the locale file as a
      step.
- [ ] **AC4** — Every flow and the vocabulary test pass; `ui:a11y` reports no new missing-label
      findings.

## Open Questions

- [ ] **Q1** — Does splitting the bundle change the i18next load path for the cinema window,
      which has its own renderer entry?

## Plan

<!-- Filled by /refine 231. -->

## Deliverables

<!-- Filled by /refine 231. -->

## Model Hints

<!-- Filled by /refine 231. -->

## Acceptance Tests

<!-- Filled by /refine 231. -->

## Done

<!-- Filled by /build 231. -->
