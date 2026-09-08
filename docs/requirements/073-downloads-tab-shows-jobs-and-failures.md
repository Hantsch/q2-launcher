---
id: 073
title: The Downloads tab shows what is running, what failed, and what is cached
status: draft
created: 2026-09-08
---

## Requirement

With [[071]] able to produce real jobs, the downloads module needs its own surface — the
`PlannedModuleView` placeholder for `downloads` becomes a real view. A user who starts a
download (via the wizard in [[074]]) needs somewhere to see it progress, find out why it failed
if it did, and see what the archive cache currently holds, without that state disappearing the
moment they navigate away.

## Acceptance Criteria

- [ ] **AC1** — The Downloads tab lists every currently running or queued job with its progress
      (bytes, speed, ETA — reusing `JobProgress`'s existing fields).
- [ ] **AC2** — A failed job's reason is shown in a readable, i18n'd failure log entry that
      persists until the user dismisses it; a successful job fades from the list instead of
      staying.
- [ ] **AC3** — The tab shows the archive cache's current size (the same figure Settings'
      cache section shows, [[072]]).
- [ ] **AC4** — The view replaces the `PlannedModuleView` fallback for the `downloads` module
      (`src/renderer/src/modules/index.ts`) and is registered per
      [ARCHITECTURE.md#adding-a-module](../ARCHITECTURE.md#adding-a-module).
- [ ] **AC5** — The tab renders correctly with zero jobs, one running job, and one failed job in
      the UI verification fixture, with no network access.

## Open Questions

- Is the failure log per installation or global across the app, and how long does a dismissed
  failure stay recoverable (e.g. in an activity history) before it is gone for good? (concept
  open point 20)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
