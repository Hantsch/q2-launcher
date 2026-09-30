---
id: 184
title: The timeline answers my click at once
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

When I press pause, jump, seek or change the speed, the timeline only changes once the game's
readback arrives — on Windows that can be more than a second ([[183]]). Until then the click seems to
have done nothing, so I click again and the command runs twice.

The timeline should answer my click **at once**: it shows the expected result right away (paused
icon, the seek target, the new speed) and keeps the position moving smoothly between readbacks. The
game's readback then confirms or corrects it. If the game has not confirmed after a while, the
timeline says so instead of silently showing a state that is not true.

This improves how responsive the controls feel on every platform, regardless of how far [[185]]
brings the real latency down.

## Acceptance Criteria

- [ ] **AC1** — Pressing pause/play switches the button's icon and label immediately, before the
      game's readback arrives.
- [ ] **AC2** — A jump (±) or a click/keyboard seek moves the position display and the slider to the
      target immediately.
- [ ] **AC3** — A speed change shows the new speed immediately.
- [ ] **AC4** — While the demo plays (not paused), the position advances smoothly at the current
      speed between readbacks instead of standing still and jumping when a readback burst arrives.
- [ ] **AC5** — When the readback arrives, the timeline shows the game's real state; a readback that
      disagrees with the expected state (e.g. the seek landed elsewhere) wins.
- [ ] **AC6** — A command the game has not confirmed within a bounded time shows a visible
      "waiting for the game…" state on the affected control (text, not only an icon or colour); it
      clears on confirmation or when the command is given up.
- [ ] **AC7** — A refused command (e.g. the channel reports an error) reverts the control to the
      last confirmed state and shows the error as today.

## Open Questions

- Q1: The bounded time for AC6 — a fixed value (recommended: 1 s, above [[183]]'s measured p95 after
  [[185]]), or taken from [[185]]'s measured target?
- Q2: Two quick jumps (+10, +10): does the display show +20 at once (accumulating expected state,
  recommended), or only the latest command's target?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
