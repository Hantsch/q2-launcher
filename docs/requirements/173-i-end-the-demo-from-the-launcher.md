---
id: 173
title: I end the demo from the launcher
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

I can end a playing demo without hunting for the game: the timeline has a **"stop" button** that
quits the game and returns the launcher to idle. Today there is none, and `quit` typed in the game's
console does nothing on Windows while the launcher steers the demo — spike [[169]] found that the
control loop starves every command typed in-game or sent by a key.

In fullscreen ([[172]]) the loop is stopped, so `quit` and binds work there. On the windowed stage
([[170]]) the game's own console and binds stay unusable while the launcher steers it; the launcher
must say so visibly instead of letting the user type into a console that ignores them. Closing the
game window (Alt+F4) works in both modes ([[169]] P11).

## Acceptance Criteria

- [ ] **AC1** — While a demo plays, the timeline shows a stop button; pressing it ends the game
      (`quit` over [[164]]'s channel) and the timeline returns to its idle state.
- [ ] **AC2** — If the game does not exit within a bounded time after the stop, the launcher ends the
      process and still returns to idle.
- [ ] **AC3** — Temporary playback files (copy-in [[160]], control/log files [[164]]) are cleaned up
      the same way as after any other game exit.
- [ ] **AC4** — On the windowed stage on Windows, the launcher states visibly (i18n text near the
      console field or stage) that the game's own console and key binds do not reach the game there,
      and names the alternatives (the console field, fullscreen, Alt+F4).
- [ ] **AC5** — On Linux (stdin channel, no loop) the AC4 hint is not shown, because in-game typing
      works there.

## Open Questions

- **Q1 — Stop vs. Play:** is the stop button in the timeline only, or does the action bar's
  "Running" button become stop during a demo playback?
- **Q2 — Confirmation:** stop immediately, or confirm? (A demo is replayable, so probably immediate.)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
