---
id: 155
title: I describe a demo the way I remember it
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user selects a demo and sees everything the browser knows about it, each value with where it came
from — then corrects and adds what they remember: a name, a description, who played on which side
and how it ended, the mod and gamemode if the guess was wrong, tags, a favourite star, a rating and
a date if the file time is misleading (concept `docs/concepts/demo-browser.md` §10 "Detail / edit",
DEMO-11, DEMO-13).

This story is the detail view and its sidecar editor; storage is [[146]], broken sidecars are
[[147]], sources are [[148]]. File actions ([[156]], [[157]]) and Play ([[159]]) land in this view
in their own stories.

## Acceptance Criteria

- [ ] **AC1** — Selecting a demo opens a detail view showing every effective value with its source
      as visible text ([[148]] AC5).
- [ ] **AC2** — The editor edits every sidecar field: name, description, mod, gamemode, map, date
      override, tags, favourite and rating (1–10).
- [ ] **AC3** — Sides can be added and removed; each side has an optional team name, an optional
      final result and a list of players that can be added, removed and reordered.
- [ ] **AC4** — Players known from the demo content or the name can be taken into a side without
      retyping them.
- [ ] **AC5** — Invalid input (rating outside 1–10, unparsable date) is shown inline and blocks
      saving.
- [ ] **AC6** — Save writes the sidecar through [[146]]; cancel discards every change; leaving with
      unsaved changes asks first.
- [ ] **AC7** — After save, the row ([[150]]), sort ([[152]]) and filters ([[153]]) reflect the new
      values without a rescan.
- [ ] **AC8** — The detail and editor are `ui:verify` screens with zero axe violations and an
      e2e flow that edits and saves a sidecar against the fixture folder ([[141]] AC6).

## Open Questions

- [ ] **Q1 — Quick favourite/rating** — can favourite and rating also be set directly from the row,
      without opening the editor? Not in the concept.
- [ ] **Q2 — Tag suggestions** — does the tag input suggest tags already used on other demos?
- [ ] **Q3 — Layout** — detail as a side panel next to the list (like the servers detail) or its own
      page?

## Plan

<!-- Filled by /refine 155, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 155. -->

## Model Hints

<!-- Filled by /refine 155. -->

## Acceptance Tests

<!-- Filled by /refine 155. -->

## Done

<!-- Filled by /build 155. -->
