---
id: 185
title: Demo commands reach the game without waiting
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

On Windows the launcher steers a demo through a control file the game's loop reads every ~200 ms,
and reads answers from the game's logfile ([[164]], [[166]], [[174]]). Two things make every command
slow: the logfile reaches the disk only in bursts, and the next command waits for the previous one's
answer from that same log. Quick successive clicks therefore queue behind each other.

Using the levers [[183]] measured and approved, commands reach the game and their answers reach the
launcher within the target latency [[183]] set — without the console flood [[174]] removed and without
changing what the game's own console and binds can do on the stage ([[169]], [[173]]).

## Acceptance Criteria

- [ ] **AC1** — On Windows, a single timeline command takes effect in the game and is acknowledged to
      the launcher within [[183]]'s target latency (p95), measured on real Q2PRO the way [[183]]
      measured it.
- [ ] **AC2** — Several commands sent in quick succession (e.g. three jumps within 300 ms) all run in
      the game, in order, each exactly once; none waits for an earlier command's acknowledgement
      before it is handed to the game.
- [ ] **AC3** — The position readback reaches the launcher at least as often as [[183]]'s approved
      combination promises (no ~1.3 s bursts).
- [ ] **AC4** — The game's console and notify area show no more launcher lines than after [[174]]
      (no `Execing …` or `POS …` flood).
- [ ] **AC5** — The existing channel guarantees still hold: exactly-once execution, the queue cap,
      the fullscreen switch and back-to-window ([[172]]), stop ([[173]]) and the cleanup of control
      and command files after the session.
- [ ] **AC6** — Linux behaviour is unchanged, or improved if [[183]] found a Linux delay (per its AC6).

## Open Questions

- Q1: Depends entirely on [[183]]'s go/no-go per lever. If no lever meets a useful target, this
  story is cut to what [[183]] approves and [[184]]'s "waiting for the game…" state carries the rest
  (option 2 from the user's request: inform instead of fix). Confirm that fallback.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
