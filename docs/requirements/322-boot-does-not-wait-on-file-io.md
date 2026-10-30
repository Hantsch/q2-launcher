---
id: 322
title: Boot does not wait on file I/O, and a failed module has no live handlers
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Overdue rows TD-002, TD-003, TD-012 and TD-016 concern how main starts and what modules can reach.
Boot blocks on config file I/O; a module whose setup throws still answers IPC; optional deps that
exist only for tests weaken production guards; a handler can see a mid-session unlock early; two
helpers have no caller.

## Acceptance Criteria

- [ ] **AC1** — The window shows without waiting on config file reads; a slow config read does not
      delay first paint (TD-002).
- [ ] **AC2** — A module whose setup throws has none of its invoke channels answering; a call
      returns the module-unavailable refusal (TD-002).
- [ ] **AC3** — Production service factories take their dependencies as required; no production
      guard checks for an optional test-only dependency (TD-003).
- [ ] **AC4** — Handlers read unlock state only through the frozen `features` gate; `AppContext`
      no longer exposes the live `unlock` service to them (TD-016).
- [ ] **AC5** — `dedupeByKey` and `toastRefusal` have a production caller or are deleted (TD-012).
- [ ] **AC6** — Rows TD-002, TD-003, TD-012 and TD-016 are removed from `docs/TECH-DEBT.md`.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Done
