---
id: 325
title: Tests and comments state what they check
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Overdue rows TD-013, TD-014, TD-028, TD-031 and TD-033 are test and comment hygiene: story numbers
in `describe` titles, `as never` casts, a regex that matches comments, missing edge-case tests,
comments that point at a removed locale mirror, bare catches outside the error policy, invariant
notes lost in a comment sweep.

## Acceptance Criteria

- [ ] **AC1** — No `describe` title contains a story number; client mocks have no `as never` cast;
      the handler-reference check ignores comments (TD-013).
- [ ] **AC2** — Tests exist for darwin at the steam and diagnostics call sites, for `looksLikeQuake2`
      positive and negative cases, and for `isInside` with swapped arguments at its four call sites
      (TD-014).
- [ ] **AC3** — No comment says `mirrors locales/en.json` or names an i18n key that does not exist
      (TD-028).
- [ ] **AC4** — Every bare `catch` in `src/main` names the failure class it swallows or calls
      `log.caught`; a check fails on a new bare catch (TD-031).
- [ ] **AC5** — The invariant notes on `ImportPreviewResult` and `RefreshedProfileResult` in
      `shared/modules/config.ts` are back (TD-033).
- [ ] **AC6** — Rows TD-013, TD-014, TD-028, TD-031 and TD-033 are removed from `docs/TECH-DEBT.md`.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Done
