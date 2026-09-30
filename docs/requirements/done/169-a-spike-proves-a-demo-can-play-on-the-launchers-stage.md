---
id: 169
title: a spike proves a demo can play on the launcher's stage
status: done # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

Live use of S28 showed the timeline is useless the way playback starts today: Q2PRO opens
fullscreen and covers the launcher, so the timeline and console field ([[165]], [[166]]) are out of
reach. The user wants the demo to play **as if it were part of the launcher** — timeline and buttons
usable — and fullscreen only when they choose it, steered by keys then. Also observed: `quit` typed
in-game does not end the demo.

This story is a **spike**: its result is a decision, not product code. It checks, against the pinned
Q2PRO build, whether the engine can run as a borderless window the launcher places over its own
"stage" and toggles to fullscreen at runtime, and why in-game commands do not run.

Embedding the engine window into the launcher window (`SetParent`) stays a non-goal (concept §2).

## Acceptance Criteria

- [x] **AC1** — The recorded result states whether Q2PRO launches borderless and topmost at a given
      geometry, and whether geometry, topmost and fullscreen can be changed at runtime over story
      164's channel.
- [x] **AC2** — The recorded result states whether playback continues while another window has
      focus.
- [x] **AC3** — The recorded result explains why `quit` typed in-game does not run, and what
      releases or restores the control loop.
- [x] **AC4** — The recorded result ends in go/no-go and names the stories that follow.

## Open Questions

## Plan

Throwaway harness in `spikes/169-windowed-stage/` (outside `src/`), same control-file mechanism as
[[133]]/[[164]], run by hand against `C:\Games\Q2Pro` with `opentdm/demos/test.dm2`.

## Deliverables

- [x] D1 — `spikes/169-windowed-stage/harness.mjs`, `stop-probe.mjs`, `win-probe.ps1`, `README.md`.
- [x] D2 — `spikes/169-windowed-stage/RESULT.md` with the results files it is based on.

## Model Hints

Review: → default

## Acceptance Tests

- AC1–AC4 → **manual residue:** a spike against a real Q2PRO binary and a real desktop; the evidence
  is `spikes/169-windowed-stage/RESULT.md` and its `results/*.json`.

## Done

- **Go** for a windowed stage: launch geometry exact (`vid_geometry` + `win_noborder` +
  `win_alwaysontop`), live `vid_geometry` / `win_alwaysontop` / `vid_fullscreen` all work over the
  control loop (~0.5 s), playback continues unfocused, fullscreen returns to the last geometry.
- Root cause of the dead in-game `quit`: the Windows control loop re-inserts itself at the front of
  the command buffer, so everything appended behind it — typed console lines, key binds (incl.
  [[167]]'s demo actions) — never runs while it lives. Stopping it releases the queue; a queued
  `exec` can restart it. A loop-free OOB `cmd` transport does not exist in this build.
- Side findings: the logfile is buffered despite `logfile_flush 1`; ~26 console lines/s of
  `Execing`/`POS` spam.
- Follow-ups: [[170]]–[[174]], sprint S29.
- Commit message: `169: spike — Q2PRO plays on a launcher-placed borderless window; control loop starves in-game commands`
