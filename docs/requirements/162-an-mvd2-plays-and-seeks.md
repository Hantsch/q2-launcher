---
id: 162
title: an mvd2 plays and seeks
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A server-side `.mvd2` ([[137]]) contains every player, not one POV. Q2PRO plays it through the same
`demo` command (auto-detected) and seeks it with `mvdseek` rather than `seek` (concept
`docs/concepts/demo-browser.md` §6.4, §9.1). A user plays an MVD2 exactly like a `.dm2` ([[159]]) and
the timeline ([[165]]) works on it — but which player the camera follows, and whether the launcher
offers a choice, is concept open point §17.9, and the concept puts a POV choice beyond Q2PRO's own
playback outside v1 (§2).

## Acceptance Criteria

- [ ] **AC1** — Play on an `.mvd2` (and `.mvd2.gz`) starts Q2PRO with `+set game` and `+demo`, like
      [[159]].
- [ ] **AC2** — Timeline seeking on an MVD2 uses the command decided in Q2, and a unit test pins the
      command per format.
- [ ] **AC3** — Which player is followed after the start is documented (Q1), and the detail view
      states it where it matters.
- [ ] **AC4** — On r1q2, MVD2 stays disabled with its reason ([[161]] AC3).

## Open Questions

- [ ] **Q1 — Followed player** (§17.9): whom does Q2PRO follow by default, and does v1 offer
      nothing more than Q2PRO's own in-game controls for switching?
- [ ] **Q2 — `mvdseek` vs `seek`** — which one the timeline sends for MVD2, and whether both accept
      the same relative/absolute syntax.

## Plan

<!-- Filled by /refine 162, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 162. -->

## Model Hints

<!-- Filled by /refine 162. -->

## Acceptance Tests

<!-- Filled by /refine 162. -->

## Done

<!-- Filled by /build 162. -->
