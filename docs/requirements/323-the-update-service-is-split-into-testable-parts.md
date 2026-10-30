---
id: 323
title: The update service is split into testable parts
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

`createUpdateService` is a 480-line closure factory with 20 inner functions (TD-001); its keep and
cancel paths are untested, a LAN-mode watchlist recheck stays pending and concurrent catalog
fetches fetch twice (TD-020). Updates must behave exactly as today, with those gaps closed.

## Acceptance Criteria

- [ ] **AC1** — No function in the update service is longer than 80 lines, and the factory has no
      more than five inner functions (TD-001).
- [ ] **AC2** — The update job's keep and cancel paths each have a unit test (TD-020).
- [ ] **AC3** — In LAN mode a watchlist recheck resolves instead of staying pending (TD-020).
- [ ] **AC4** — Two catalog fetches started together cause one network fetch (TD-020).
- [ ] **AC5** — The existing update flows pass unchanged.
- [ ] **AC6** — Rows TD-001 and TD-020 are removed from `docs/TECH-DEBT.md`.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Done
