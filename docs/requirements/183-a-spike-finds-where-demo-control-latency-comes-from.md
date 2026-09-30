---
id: 183
title: A spike finds where demo-control latency comes from
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

Timeline controls (pause, jump, seek, speed) feel noticeably delayed on Windows. Spike [[133]]
measured 318–701 ms from control file to ACK with a ~77 ms loop tick (`wait 5`). Since [[174]] the
loop waits 13 frames (~200 ms), and its comment notes the buffered logfile now delivers POS lines in
**bursts ~1.3 s apart** — fewer lines per second fill Q2PRO's log buffer more slowly. On top, the
Windows channel sends the next command only after the previous one's ACK arrives through that same
log, so two quick clicks wait for each other.

Before building the fix ([[185]]) we need numbers on the real Q2PRO, not guesses: which share of the
delay is the loop tick, the log flush, and the ACK serialisation — and which lever removes it
without bringing back [[174]]'s console flood or [[169]]'s input starvation.

This is a spike: its output is a `RESULT.md` with measurements and a go/no-go per lever, like
`spikes/133-q2pro-control/` and `spikes/169-windowed-stage/`.

## Acceptance Criteria

- [ ] **AC1** — `spikes/183-control-latency/RESULT.md` states, for the current production settings on
      real Q2PRO (Windows), the measured time from "control file written" to (a) the command taking
      effect in the game and (b) its ACK being read by the launcher, p50 and p95.
- [ ] **AC2** — The result states the measured interval between log flushes (POS/ACK arrival) at the
      current tick.
- [ ] **AC3** — The result measures each candidate lever and gives a go/no-go per lever, at least:
      a shorter loop wait; forcing the log to flush every tick (e.g. `logfile` off/on, other
      `logfile_flush` values, padding the log output); dispatching the next command without waiting
      for the previous ACK (several sequences guarded in one control file, or queued lines coalesced
      into one command file).
- [ ] **AC4** — For every lever it records the side effects: console/notify lines visible in the game,
      whether in-game typing and binds are still starved as in [[169]], and CPU cost.
- [ ] **AC5** — The result names the recommended combination and the target latency [[185]] will be
      held to.
- [ ] **AC6** — The result states whether the Linux channel (stdin/stdout, 100 ms poll) shows a
      comparable delay, or explicitly records that Linux was not measured and why.

## Open Questions

- Q1: The spike drives the real `C:\Games\Q2Pro\q2pro.exe`. Probing pitfalls from 133/169 apply
  (buffered logfile: end with WM_CLOSE, never kill; synthetic keystrokes do not arrive). Can the
  sprint run it unattended, or does it need the user at the machine for the eyes-on part?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
