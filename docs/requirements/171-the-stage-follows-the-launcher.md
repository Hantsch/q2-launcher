---
id: 171
title: the stage follows the launcher
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

The game window on the stage ([[170]]) is a separate, always-on-top window. It must behave as if it
were part of the launcher: when I move, resize, maximize or minimize the launcher, the picture goes
with it; when I switch to another program or another launcher view, the game must not float on top
of it; and nothing of the launcher that opens over the stage (the speed dropdown, dialogs, toasts)
may be hidden behind the game.

Spike [[169]] verified the means: live `set vid_geometry` moves/resizes the window (~0.5 s over
[[164]]'s channel), live `set win_alwaysontop 0/1` clears/sets topmost, playback keeps running while
the game window has no focus.

## Acceptance Criteria

- [ ] **AC1** — Moving or resizing the launcher window (incl. maximize/restore) repositions the game
      window onto the stage; the launcher coalesces geometry updates so a drag does not queue one
      command per pixel.
- [ ] **AC2** — Minimizing the launcher hides the game window (or moves it out of sight); restoring
      brings it back onto the stage.
- [ ] **AC3** — When another program becomes the foreground window, the game window is no longer
      topmost; when the launcher (or the game) is foreground again, it is.
- [ ] **AC4** — Leaving the Demos view while a demo plays does not leave the game window covering the
      other view; returning puts it back on the stage.
- [ ] **AC5** — Launcher surfaces that open over the stage (dropdowns, dialogs, toasts) are never
      hidden behind the game window.

## Open Questions

- **Q1 — AC2/AC4 mechanism:** move the window off-screen via `vid_geometry`, shrink it, minimize it,
  or pause the demo? (Minimizing a borderless Q2PRO window at runtime is unverified.)
- **Q2 — AC5:** hide/move the game while an overlay is open, or lay out so nothing opens over the
  stage?
- **Q3 — Latency:** ~0.5 s per geometry update makes the picture trail a drag; acceptable, or hide
  the game during the drag and show it at the end?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
