---
id: 172
title: I choose fullscreen and come back
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

Fullscreen is my deliberate choice: a **fullscreen button in the timeline** switches the running demo
to fullscreen, and from then on I steer it with my keys — the demo actions from [[167]] — and can
use the game's console, including `quit`. To return, a **"back to window" action** — bindable in the
Controls tab's "Demo playback" category like the others — puts the demo back on the stage ([[170]])
and gives the launcher's timeline control again.

Spike [[169]] found why binds and typed commands do nothing today: on Windows the control loop
([[164]]) re-inserts itself at the front of the command buffer, so everything a key or the console
appends never runs while it lives. [[167]]'s binds are therefore dead on Windows during playback.
The spike also verified the way out: live `vid_fullscreen 1/0` works and returns to the last stage
geometry; stopping the loop releases the queue; a queued `exec` of the loop cfg restarts it — which
is exactly what the "back to window" bind can do (`vid_fullscreen 0` + re-arm the loop).

On Linux the channel is stdin, there is no loop and nothing starves; the fullscreen switch and the
back-to-window action still apply.

## Acceptance Criteria

- [ ] **AC1** — The timeline has a fullscreen button; pressing it switches the running demo to
      fullscreen.
- [ ] **AC2** — In fullscreen on Windows the control loop is stopped, so bound demo actions, typed
      console commands and `quit` take effect in-game.
- [ ] **AC3** — While in fullscreen the timeline shows that the demo is steered by keys (visible
      text, i18n key) instead of stale position/controls.
- [ ] **AC4** — The Controls tab's "Demo playback" category offers a bindable "back to window"
      action; binding it writes its engine command into the profile like every other bind, pinned by
      a unit test; the launcher never binds it on its own.
- [ ] **AC5** — Pressing the bound "back to window" key in fullscreen returns the demo to the stage
      geometry and the launcher regains control (position updates and timeline commands work again).
- [ ] **AC6** — The "back to window" action outside a launcher-started demo playback is harmless (no
      error dialog, no game-state change beyond an engine message).
- [ ] **AC7** — Existing profiles get the new action (unbound) through a state migration, as [[167]]
      did for the demo category.

## Open Questions

- **Q1 — Queued presses:** keys pressed while the loop ran (windowed stage) sit in the queue and all
  fire at once when the loop stops for fullscreen (e.g. three "jump forward" presses). Accept, make
  the demo actions guard on a cvar, or tell the user in-window that keys do nothing there ([[173]])?
- **Q2 — Detecting the return:** the logfile is buffered ([[169]] side finding) — the launcher must
  detect the re-armed loop from resumed POS output, not from a single trailing line. Timeout and
  what the timeline shows if the user never comes back?
- **Q3 — Alt+Enter / other fullscreen switches:** if the user toggles `vid_fullscreen` themselves,
  does the launcher notice, or is the timeline button the only supported path?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
