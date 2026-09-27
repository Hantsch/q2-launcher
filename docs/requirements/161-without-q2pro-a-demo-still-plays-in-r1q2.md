---
id: 161
title: without Q2PRO a demo still plays in r1q2
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user who only has r1q2 installations can still watch their demos — with less control, and told so
(concept `docs/concepts/demo-browser.md` §11.1, DEMO-24, DEMO-25). r1q2 plays protocol-34 demos with
`+demomap name.dm2`; it has **no seek**, but `timescale` and `paused` work during playback (§9.1).
The timeline ([[165]]) then offers play/pause and speed only, with the visible note **"Seeking needs
Q2PRO"**.

Formats r1q2 cannot play are disabled with their reason: MVD2, protocol 343x and oversized-packet
demos ([[136]] records protocol and size facts). `.gz` is decompressed into the temporary copy
([[160]]) rather than disabled — refine confirms (Q2).

On Linux there is no r1q2 at all. Where the engine choice would appear, the fallback is shown as not
available with the reason "Not available on Linux: r1q2 is not supported" (§13, CLAUDE.md
platform-parity rule).

## Acceptance Criteria

- [ ] **AC1** — With no qualifying Q2PRO installation but a qualifying r1q2 one, Play launches r1q2
      with `+demomap` and the demo's game dir.
- [ ] **AC2** — During r1q2 playback the timeline offers play/pause and speed only; jump and seek are
      visible, disabled, and the text "Seeking needs Q2PRO" is shown.
- [ ] **AC3** — An MVD2 demo cannot be played on r1q2: the r1q2 choice is disabled with its reason.
- [ ] **AC4** — A protocol 343x or oversized-packet demo cannot be played on r1q2: disabled with its
      reason.
- [ ] **AC5** — A `.gz` demo plays on r1q2 through [[160]]'s decompressed copy (or is disabled with
      its reason, per Q2).
- [ ] **AC6** — On Linux, the r1q2 fallback is shown as not available with the visible text "Not
      available on Linux: r1q2 is not supported" wherever the engine choice appears.
- [ ] **AC7** — The risk decided in Q1 is handled as decided and pinned by a test.

## Open Questions

- [ ] **Q1 — `demomap` and stufftext.** The concept rejects `demomap` on Q2PRO because it executes
      stufftext from the demo (§4) — r1q2's only route is `+demomap`. Accept the risk silently, warn
      before playing a demo from an extra folder/archive, or restrict the fallback to the user's own
      demos?
- [ ] **Q2 — `.gz` on r1q2** — decompress into the copy (as AC5 assumes) or disable with reason?

## Plan

<!-- Filled by /refine 161, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 161. -->

## Model Hints

<!-- Filled by /refine 161. -->

## Acceptance Tests

<!-- Filled by /refine 161. -->

## Done

<!-- Filled by /build 161. -->
