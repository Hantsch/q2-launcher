---
id: 170
title: a demo plays on the launcher's stage
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

When I play a demo, it should look like it plays **inside the launcher**: the picture sits in an area
of the Demos view (the "stage"), with the timeline and console field ([[165]], [[166]]) right beneath
it and usable, not hidden behind a fullscreen game.

Spike [[169]] proved the way: Q2PRO starts as a borderless, always-on-top window whose position and
size the launcher sets (`vid_fullscreen 0`, `win_noborder 1`, `win_notitle 1`, `win_alwaysontop 1`,
`win_noresize 1`, `vid_geometry WxH+X+Y`), laid exactly over the stage. This is **not** embedding
(concept §2 non-goal stays): the game remains its own window. Windowed stage is the **default** for
every demo playback; fullscreen is a deliberate choice ([[172]]).

These are session settings of a demo playback only; a normal game launch is unchanged.

## Acceptance Criteria

- [ ] **AC1** — While a demo plays, the Demos view shows a stage area, and the timeline and console
      field are visible and operable below it.
- [ ] **AC2** — A demo playback starts Q2PRO windowed, borderless and topmost, with its client area
      covering the stage exactly (physical pixels, correct at display scaling other than 100 %).
- [ ] **AC3** — The window parameters are passed only to demo playbacks; a normal launch's arguments
      are unchanged.
- [ ] **AC4** — The window parameters do not end up permanently in the user's own config (Q2PRO
      archives cvars on exit) — or the recorded decision states which ones do and why that is
      acceptable.
- [ ] **AC5** — On a platform or session where the stage cannot position the window, the stage shows
      the reason as visible text (i18n key), and the demo still plays in a normal window.
- [ ] **AC6** — Stage labels and reasons are i18n keys.

## Open Questions

- **Q1 — Stage size and layout:** fixed aspect ratio (4:3 like Q2, 16:9) or whatever space the view
  leaves? Does the demo list/detail collapse while playing?
- **Q2 — Archived cvars (AC4):** `vid_geometry`, `win_*` and `vid_fullscreen` are archived by Q2PRO
  and written to `q2config.cfg` on exit — restore them after the session, pass them in a way that is
  not archived, or accept?
- **Q3 — Linux (parity rule):** X11 is expected to honour `vid_geometry` (unverified); Wayland cannot
  position windows. Detect Wayland and show "Not available on Wayland: …" with a normal window?
- **Q4 — Multi-monitor:** the stage follows the launcher's display; which display scale applies when
  the launcher spans two?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
