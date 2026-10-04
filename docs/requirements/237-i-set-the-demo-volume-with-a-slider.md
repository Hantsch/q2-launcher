---
id: 237
title: I set the demo's game volume with a slider
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player watching a demo, I can turn the game's sound up, down or off from the timeline with a
volume slider and a mute button, the way a video player works — without opening the console.

User feedback 2026-10-04: "volume slider (only ingame sound), like on YouTube". Today there is no
volume control in the Demos view; the only way is typing `s_volume 0.3` into the console field. The
playback channel already sends console commands (`pause`, `seek`, `timescale`), and `s_volume` is a
known cvar (Q2PRO default 0.7). "Only ingame sound" means the game's own volume — not the launcher's,
not the system mixer, and not the volume the user plays the game with normally.

Concept: [replays-module.md](../systems/replays-module.md), [demo-browser.md](../concepts/demo-browser.md).

## Acceptance Criteria

- [ ] **AC1** — While a demo session runs, the timeline shows a speaker button and a volume slider
      (0–100 %), on Windows and Linux.
- [ ] **AC2** — Moving the slider changes the playing game's sound volume; the slider sends the
      value through the playback channel, never by restarting the demo.
- [ ] **AC3** — Dragging the slider does not flood the channel: intermediate values are coalesced and
      the value the user lets go of is the one the game ends up with.
- [ ] **AC4** — The speaker button mutes and unmutes; unmute restores the volume set before muting.
      Muted state shows as a crossed-out speaker icon plus a text label, never by colour alone.
- [ ] **AC5** — The slider and the button are keyboard-operable (arrow keys step the slider, the
      button toggles with Enter/Space) and carry accessible names.
- [ ] **AC6** — After the session ends, the installation's `s_volume` is what it was before the demo
      started — the demo volume never leaks into normal play.
- [ ] **AC7** — A new session starts at the volume of the last demo session (remembered by the
      launcher), or at the game's own value if none was set yet.

## Open Questions

- **Q1** — Does "game sound" include music (`ogg_volume` in Q2PRO, if the build has it), or only
  `s_volume`? Recommendation: `s_volume` only; music is rare in demos.
- **Q2** — Is the remembered volume (AC7) global or per installation? Recommendation: global — it is
  a viewing preference, not a game setting.
- **Q3** — Does `s_volume` take effect live under the Windows `s_driver wave` stage setup, or does it
  need `snd_restart`? To be verified in refine against a real Q2PRO.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
