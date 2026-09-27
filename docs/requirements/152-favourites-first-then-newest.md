---
id: 152
title: favourites first, then newest
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user opening the Demos view wants their favourite demos at hand and, below them, whatever was
recorded last. That is the default order: **favourites on top, then newest by effective date** — the
same pinning the server favourites have (concept `docs/concepts/demo-browser.md` §3, §10, DEMO-16).
Every column can be sorted instead, and the launcher remembers the user's choice.

## Acceptance Criteria

- [ ] **AC1** — With no remembered choice, favourites come first, then all demos newest first by
      effective date ([[148]]); within the favourites, newest first too.
- [ ] **AC2** — Every column of the row ([[150]]) can be sorted ascending and descending.
- [ ] **AC3** — The sort choice is stored in the module's state key ([[142]]) and restored on the
      next start.
- [ ] **AC4** — Demos with an unknown value in the sorted column sort after all known values in
      both directions.
- [ ] **AC5** — Favourites stay pinned (or not) under a user-chosen sort as decided in Q1.
- [ ] **AC6** — The sort is pure shared code with unit tests.

## Open Questions

- [ ] **Q1 — Pinning under a user sort** — do favourites stay on top when sorting by map or rating,
      or is pinning part of the default order only?

## Plan

<!-- Filled by /refine 152, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 152. -->

## Model Hints

<!-- Filled by /refine 152. -->

## Acceptance Tests

<!-- Filled by /refine 152. -->

## Done

<!-- Filled by /build 152. -->
