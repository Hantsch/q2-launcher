---
id: 121
title: the list says what it's doing
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the Servers view ([[106]]) and the list is not just rows ([[118]]) — it has to be
honest about its own state: that a scan is running and how far it has got, that no source returned
anything at all, or that one particular source failed while the rest of the list is fine. A blank or
ambiguous list reads as broken; a list that says what it is doing does not.

This story covers those three explicit states (loading, empty, per-source error) plus the populated
list already covered by [[118]]/[[119]]/[[120]], and makes all four verifiable the way every other
screen in this app is: entries in the `ui:verify` registry, and a `ui:flow` script that exercises the
scan-to-select path against a local stub — never a real master or a real server. The data these
states describe comes from the scan engine in [[114]]; joining a selected server is out of scope here
and belongs to [[125]].

## Acceptance Criteria

- [ ] **AC1** — While a scan from [[114]] is in progress, the list shows a loading state with live
      progress counts (e.g. servers found so far / servers still being queried).
- [ ] **AC2** — When a completed scan returns no servers from any source, the list shows a stated
      empty state ("no source returned a server") that includes a link into source settings ([[111]]).
- [ ] **AC3** — A failure on one source is shown attributed to that specific source, without hiding or
      blocking the rest of the list's results from sources that succeeded.
- [ ] **AC4** — The populated, loading, empty and error list states are all present as entries in the
      `ui:verify` screen registry, and a full verification run against them holds zero axe violations
      (GB-A4).
- [ ] **AC5** — A `ui:flow` script drives a scan-to-select flow (the scan → select portion of the
      concept's scan → select → join-dialog example; the join-dialog portion is [[125]]) entirely
      against a local stub fixture that serves the scan data — the script never touches a real master
      or a real game server (GB-A5).

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 121`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 121`. -->

## Model Hints

<!-- Filled by `/refine 121`. -->

## Acceptance Tests

<!-- Filled by `/refine 121`. -->

## Done

<!-- Filled by `/build 121`. -->
