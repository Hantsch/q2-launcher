---
id: 151
title: the demo list says what it's doing
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user opens the Demos view and always knows why they see what they see: the scan is still running
(and how far it is), there are no demos at all (and where to add a folder), or one source could not
be read while the others could (concept `docs/concepts/demo-browser.md` §10 "States", DEMO-19) — the
same explicitness the servers list got in [[121]].

## Acceptance Criteria

- [ ] **AC1** — While a scan runs, the list shows a loading state with live counts from [[144]]'s
      progress event (scanned / total).
- [ ] **AC2** — With no demos in any source, the list shows "no demos found" with a link into the
      demos settings section where extra folders are added ([[142]]).
- [ ] **AC3** — A source that is missing or unreadable (deleted extra folder, permission denied,
      archive that fails to open) shows a per-source error naming the source and the reason, while
      demos from every other source stay listed.
- [ ] **AC4** — After a scan finishes, the loading state gives way to the list (or the empty state)
      without a manual reload.
- [ ] **AC5** — Each state is a `ui:verify` screen with zero axe violations.

## Open Questions

<!-- None known from the concept. -->

## Plan

<!-- Filled by /refine 151. -->

## Deliverables

<!-- Filled by /refine 151. -->

## Model Hints

<!-- Filled by /refine 151. -->

## Acceptance Tests

<!-- Filled by /refine 151. -->

## Done

<!-- Filled by /build 151. -->
