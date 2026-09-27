---
id: 145
title: a demo I cannot parse still shows up
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A demo from an unusual build, a half-written file, a corrupt download — the header parser
([[136]]/[[137]]) cannot read it. It is still the user's file: it appears in the list, marked as
unreadable with the reason, and shows whatever the file name and file time can tell (concept
`docs/concepts/demo-browser.md` §15, DEMO-7). A demo never silently disappears because the parser
does not understand it.

## Acceptance Criteria

- [ ] **AC1** — A file the parser reports as unparsable appears in the list with an "unreadable"
      marker.
- [ ] **AC2** — Its detail view shows the parser's reason in plain text (an i18n key plus data, e.g.
      "Unknown protocol 36").
- [ ] **AC3** — It still shows name facts from [[139]] and the file time as its date.
- [ ] **AC4** — Sidecar editing, reveal, copy path and rename work for it exactly as for a readable
      demo.
- [ ] **AC5** — Play follows the rule decided in Q1, and a disabled Play carries its reason as
      visible text.

## Open Questions

- [ ] **Q1 — Playing an unreadable demo** — the game dir is unknown: disable Play with the reason,
      or offer Play in a chosen installation and let the engine decide?

## Plan

<!-- Filled by /refine 145, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 145. -->

## Model Hints

<!-- Filled by /refine 145. -->

## Acceptance Tests

<!-- Filled by /refine 145. -->

## Done

<!-- Filled by /build 145. -->
