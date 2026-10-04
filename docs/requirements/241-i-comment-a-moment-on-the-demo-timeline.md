---
id: 241
title: I comment a moment on the demo timeline
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player reviewing a demo, when I pause I can write a comment pinned to that moment of the
timeline, see the comments as marks on the timeline, and read them with their times in the demo's
details — so I can note a mistake, a good play or a moment to show someone.

User feedback 2026-10-04: "tag on the timeline — when you press pause you create a comment on the
timeline in the sidecar; the details then show the comments and when they occur".

Today the launcher knows the playback position (0.1 s resolution, pushed every 250 ms) and the pause
state; the timeline (`DemoTimeline.tsx`) has no marks, and the sidecar (`<demo>.json`, schema v1) has
nothing time-anchored.

Concept: [replays-module.md](../systems/replays-module.md), [demo-browser.md](../concepts/demo-browser.md).

## Acceptance Criteria

- [ ] **AC1** — While a demo is paused, the timeline offers "Add comment", which opens a text field
      anchored at the current position.
- [ ] **AC2** — A saved comment is written to the demo's sidecar with its time and text, and survives
      a restart.
- [ ] **AC3** — Each comment shows as a mark on the timeline's seek bar at its time; hovering or
      focusing the mark shows the text.
- [ ] **AC4** — Activating a mark seeks the playing demo to that time.
- [ ] **AC5** — The demo detail lists all comments sorted by time, each with its `mm:ss` time and
      text, also when no demo is playing.
- [ ] **AC6** — A comment can be edited and deleted from the detail list.
- [ ] **AC7** — Demos inside a zip cannot carry comments; the action is disabled and says why as
      visible text.
- [ ] **AC8** — Sidecars written before this story still load unchanged; adding the first comment
      keeps every existing field.

## Open Questions

- **Q1** — Only while paused, or also while playing (using the position at the click)?
  Recommendation: the button works in both states, and pausing on open is automatic — the feedback
  names pause as the trigger, not as a restriction.
- **Q2** — Can a detail-list entry jump into playback when no session runs (start the demo and seek)?
  Recommendation: yes, as "Play from here".
- **Q3** — Limits: max comments per demo and max text length. Recommendation: 200 comments, 500
  characters each, in line with the existing sidecar limits.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
