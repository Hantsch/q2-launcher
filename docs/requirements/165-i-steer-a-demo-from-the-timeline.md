---
id: 165
title: I steer a demo from the timeline
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

This is the point of the whole module: a demo watched **like a video** — "like YouTube", not
`demo foo.dm2` and a prayer. While a demo plays in the engine window, the launcher shows a timeline:
play/pause, jump back and forward, click anywhere to seek there, change speed, and see the current
position and the total length (concept `docs/concepts/demo-browser.md` §3, §12.1, DEMO-26).

Commands go through [[164]]'s channel: Q2PRO `seek [+-]<time|%>` (backward through its in-memory
snapshots every `cl_demosnaps` seconds), `pause`, `timescale`. MVD2 seeking follows [[162]]; with
r1q2 the timeline is reduced ([[161]]). Jump and speed steps are concept open point §17.7 —
placeholders ±10 s / ±60 s and 0.25×–4× until decided.

## Acceptance Criteria

- [ ] **AC1** — While a demo plays, the Demos view shows a timeline for that session; it disappears
      (or returns to idle) when the game exits.
- [ ] **AC2** — Play/pause toggles the engine's pause state.
- [ ] **AC3** — Jump back and jump forward move the playback by the step sizes decided in Q1.
- [ ] **AC4** — Clicking a point on the timeline seeks to that position.
- [ ] **AC5** — A speed control sets the engine's `timescale` in the steps decided in Q1, and shows
      the current speed.
- [ ] **AC6** — Current position and total duration are shown and the position advances while
      playing; the duration comes from [[138]], else from the engine.
- [ ] **AC7** — Every control is keyboard operable with visible focus; a control that does not
      apply (r1q2, [[161]]) is visible, disabled and says why.
- [ ] **AC8** — The timeline is a `ui:verify` screen with zero axe violations and an e2e flow drives
      it against a stubbed engine; any sub-44px density gets a CLAUDE.md deviation row with the
      desktop-only rationale.

## Open Questions

- [ ] **Q1 — Steps** (§17.7): jump step sizes and speed steps.
- [ ] **Q2 — Where the timeline lives** — inside the Demos view only, or a compact bar visible from
      every view while a demo plays?
- [ ] **Q3 — Pause state** — can the launcher know about a pause the user triggered in-game via a
      bind ([[167]]), or does it infer it from the position standing still?

## Plan

<!-- Filled by /refine 165, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 165. -->

## Model Hints

<!-- Filled by /refine 165. -->

## Acceptance Tests

<!-- Filled by /refine 165. -->

## Done

<!-- Filled by /build 165. -->
