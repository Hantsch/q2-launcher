---
sprint: S39
status: planned # planned | in-progress | done
branch: # set by /sprint
milestone: 12.3 — One player API, sound; 12.4 — Video export without sound
---

# Sprint S39 — One player for both modes, and video export

## Goal

In integrated mode every demo control reacts within one frame, with sound, through one player API
that engine mode also runs behind, unchanged for the user. From integrated mode the user exports the
whole demo or a range to MP4 (video only, 1080p60/720p30) with progress, and cancelling leaves no
file; in engine mode export is disabled and says why.

## Stories (in build order)

<!-- S38 findings first, then concept increments 3 (292–297) and 4 (298–303). -->

- [ ] 329 — The S38 integrated-player findings are closed
- [ ] 294 — The engine exposes commands and state to JS
- [ ] 292 — One player API for both playback modes
- [ ] 295 — Engine-mode playback runs behind the player API
- [ ] 296 — Integrated playback runs behind the player API
- [ ] 293 — Integrated playback has sound
- [ ] 297 — The timeline steers both modes
- [ ] 298 — The engine ships optimized within budgets
- [ ] 300 — The engine renders frame by frame in step mode
- [ ] 301 — Exports render at their own resolution
- [ ] 302 — Video encoding picks the best encoder
- [ ] 299 — Exports stream to a picked file
- [ ] 303 — I export a demo range as video

## Notes

- Scope: two increments, like S38 (~48 concept points plus 329). The user chose this cut on 2026-10-31.
- The 1 GiB integrated game-data cap stays (user decision 2026-10-31), despite ~2.3 GiB renderer RSS at the cap.
- Build order follows dependencies: 294 (engine hooks) before the API; 292 before both mode adapters;
  298 (`-O2`) before step mode and export, because `-O0` endangers export speed (concept R1).
- Deliberately left out: export sound, A/V sync, export options, fullscreen/cinema and HUD options
  (304–310, increment 5); fallbacks, MVD2, live clip (311–315); packaging and licences (316–319);
  TD-075 (engine CI lane, local by design).
- If 302 finds no usable H.264 encoder tier on Windows, 303 is cut to what the found tier can do and
  the rest moves to S40 — decided in `/sprint`'s clarification round, not silently.

## Regression gate

<!-- Filled by `/sprint` phase 2b. -->
