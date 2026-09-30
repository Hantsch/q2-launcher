---
id: 187
title: I watch a demo in cinema mode
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

**Conditional on spike [[186]] ending in go.** If it ends in no-go, this story is withdrawn with a
note pointing at the spike's recorded result.

A running demo has three ways to be watched, and I choose between them from the timeline:

- **Preview**: the demo plays small on the Demos view's stage, the timeline beneath it, as today
  ([[170]]).
- **Cinema mode** (new): the demo fills the whole screen, and the launcher lays its controls over it
  like a video player. I steer it with the mouse over those controls, without leaving the picture.
- **Fullscreen**: the game's real fullscreen, where only in-game keys and the console steer it, as
  today ([[172]]).

In cinema mode the controls appear when I move the mouse and fade out when I leave it still, like a
video player's. Leaving cinema mode returns the demo to the preview.

## Acceptance Criteria

- [ ] **AC1** — The timeline offers the three modes (preview, cinema mode, fullscreen) with visible
      labels (i18n keys); the current mode is recognisable without relying on colour alone.
- [ ] **AC2** — Choosing cinema mode moves the running demo over the whole display the launcher window
      is on, without restarting playback.
- [ ] **AC3** — In cinema mode an overlay shows position/duration, click-to-seek, play/pause, ±jump,
      speed, fullscreen and a "leave cinema mode" control; each acts on the running demo the way the
      timeline does.
- [ ] **AC4** — The overlay's controls appear when the mouse moves and fade out after a few seconds
      without movement (the delay is fixed in Decisions); they stay visible while the pointer rests on
      them or the demo is paused.
- [ ] **AC5** — While the overlay has focus, keys steer the demo like a video player (the key set is
      fixed in Decisions), and Esc leaves cinema mode.
- [ ] **AC6** — Leaving cinema mode returns the demo to the preview at the stage's current geometry,
      and the timeline in the launcher works again.
- [ ] **AC7** — Choosing fullscreen from cinema mode enters [[172]]'s fullscreen; its "back to
      window" action returns to the preview.
- [ ] **AC8** — When the demo ends or the game exits while in cinema mode, the overlay closes and the
      launcher shows the ended state as today.
- [ ] **AC9** — Where the stage is unavailable (Wayland, [[170]]), the cinema-mode control stays
      visible, is disabled and says why as visible text (i18n key).

## Open Questions

- [ ] **Q1 — Fade-out delay:** how many seconds without mouse movement before the controls fade
      (YouTube: ~3 s)?
- [ ] **Q2 — Keys in the overlay:** which ones — e.g. Space/K pause, ←/→ jump, `<`/`>` speed, F
      fullscreen, Esc leave?
- [ ] **Q3 — A click on the picture** (not on a control): nothing, or play/pause like YouTube? And
      double-click?
- [ ] **Q4 — The launcher window** while in cinema mode: stays where it is behind the game, or is
      minimised and restored on leaving?
- [ ] **Q5 — The console-command field** ([[166]]): part of the overlay, or only in the preview?

## Plan

<!-- Filled by /refine 187, once [[186]] is done and the Open Questions are resolved. -->

## Deliverables

<!-- Filled by /refine 187. -->

## Model Hints

<!-- Filled by /refine 187. -->

## Acceptance Tests

<!-- Filled by /refine 187. -->

## Done

<!-- Filled by /build 187. -->
