---
id: 174
title: the game console is not flooded by the launcher
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

While the launcher steers a demo on Windows, its control loop ([[164]]) prints about 13
`Execing q2l_ctl.cfg` and 13 `POS m:ss.f` lines per second into the game console (measured in
[[169]], P7). They bury everything else in the console and show up in the notify lines at the top of
the picture — on the stage ([[170]]) that is right over the demo. The launcher's own plumbing must
not be visible in the game.

The position readback itself must keep working: [[164]] reads `POS` lines from the logfile, and the
logfile is buffered — steady output is what keeps it flowing ([[169]] side finding).

## Acceptance Criteria

- [ ] **AC1** — While a demo plays under the launcher's control, no launcher plumbing lines
      (`Execing q2l_…`, `POS …`, `ACK …`) appear in the notify lines over the picture.
- [ ] **AC2** — The console scrollback is not flooded: either the plumbing lines do not reach it, or
      their rate is reduced to a stated maximum per second (recorded decision).
- [ ] **AC3** — Position updates still reach the timeline at least as often as today's
      `POSITION_PUSH_MS` (250 ms), and commands are still acknowledged — pinned by the existing
      channel tests plus a test for the new behaviour.
- [ ] **AC4** — Any cvar the launcher changes for this (e.g. `con_notifytime`) is restored after the
      session and does not end up permanently in the user's config.

## Open Questions

- **Q1 — Mechanism:** the pinned build prints `Execing` unconditionally. Options: fewer loop ticks
  (larger `wait`, slower readback), `con_notifytime 0` for the session (also hides chat of the demo),
  a quieter exec path if Q2PRO has one — needs a quick check against the binary.
- **Q2 — Chat in demos:** is hiding the demo's own chat notify lines acceptable if `con_notifytime`
  is the chosen mechanism?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
