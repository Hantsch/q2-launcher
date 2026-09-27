---
id: 138
title: a demo knows how long it is
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

"Is this the full 20-minute match or a 30-second clip?" — a user deciding what to watch needs a
demo's length in the list, and the timeline ([[165]]) needs it to draw a seek bar (concept
`docs/concepts/demo-browser.md` §6.3, DEMO-6).

The demo header does not store a duration. Q2PRO emits 10 Hz demo frames, so duration ≈
`svc_frame` count × 100 ms. An exact count needs decoding every message (messages carry no length of
their own) but not entity state; a cheap estimate is roughly one block per frame. Which one runs at
scan time is concept open point §17.4 — to be decided by measuring on real demos, because a library
of thousands of demos is scanned on every module open ([[144]]).

## Acceptance Criteria

- [ ] **AC1** — Every `.dm2` and `.mvd2` that [[136]]/[[137]] can parse gets a duration.
- [ ] **AC2** — The method chosen in Q1 is documented in the module's code and in the concept
      (§17.4 resolved), including its accuracy against an exact frame count.
- [ ] **AC3** — Computing durations stays inside the scan-time budget decided in Q2, asserted by a
      test on a large synthetic demo.
- [ ] **AC4** — A demo whose duration cannot be determined shows "unknown", never `0:00`.
- [ ] **AC5** — Durations are shown as `m:ss`, or `h:mm:ss` from one hour on.

## Open Questions

- [ ] **Q1 — Exact vs. estimate** (§17.4) — needs measurements on real demos; which method?
- [ ] **Q2 — Budget** — what scan cost per demo (or per MB) is acceptable?
- [ ] **Q3 — Exact later?** If the estimate is chosen, is an exact duration computed lazily when a
      demo is opened in the detail view or played?

## Plan

<!-- Filled by /refine 138, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 138. -->

## Model Hints

<!-- Filled by /refine 138. -->

## Acceptance Tests

<!-- Filled by /refine 138. -->

## Done

<!-- Filled by /build 138. -->
