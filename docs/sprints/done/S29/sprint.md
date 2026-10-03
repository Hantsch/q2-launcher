---
sprint: S29
status: done # planned | in-progress | done
branch: sprint/S29
milestone: 10.9 — Demo plays in the launcher (stage, fullscreen by choice, stop)
---

# Sprint S29 — Demo browser, part 4 — the demo plays in the launcher

## Goal

A demo plays on a stage inside the Demos view — a borderless Q2PRO window the launcher places and
keeps in step with its own window — so the timeline and console field are usable. Fullscreen is a
deliberate button, steered by keys (binds and `quit` work there), with a bindable way back; the
timeline can stop the demo; the game console is no longer flooded by the launcher's plumbing.

## Stories (in build order)

- [x] 169 — a spike proves a demo can play on the launcher's stage (done before the sprint; go)
- [x] 170 — a demo plays on the launcher's stage
- [x] 171 — the stage follows the launcher
- [x] 172 — I choose fullscreen and come back
- [x] 173 — I end the demo from the launcher
- [x] 174 — the game console is not flooded by the launcher
- [x] 175 — an address I add is saved right away

## Notes

- Triggered by live use of S28: fullscreen hides the timeline, and `quit` typed in-game does
  nothing. Spike 169 ([RESULT](../../../../spikes/169-windowed-stage/RESULT.md)) found the cause — the
  Windows control loop starves every command typed or bound in-game — which also means **story
  167's demo binds are dead on Windows while the launcher steers a demo**; 172 fixes that for
  fullscreen, 173 makes it visible on the stage.
- Concept change: §3/§12 of [demo-browser.md](../../../concepts/demo-browser.md) now make the windowed
  stage the default and in-game binds the fullscreen path. Embedding (`SetParent`) stays a non-goal.
- Highest regression risk: 170/171 change every demo playback's launch arguments and add window
  tracking in main; 172 touches [[164]]'s loop lifecycle and the config action catalog (migration,
  as 167 did); 174 touches the loop's timing.
- Every story's open questions go to the user in the clarification round — several are product
  choices (stage layout, archived cvars, Wayland, queued presses, chat notify lines).
- Real-window behaviour (DPI, topmost, focus) cannot be proven by the stub engine alone — expect
  manual residue in 170/171/172 against the real Q2PRO, as in 133/169.

## Regression gate

Ran on sprint/S29 at 8765ff7 (after two fix commits).

- `npm run build` green (~5 s) · `npm test` green (~0.5 min, 405 files / 5842 tests) · `npm run ui:verify` green after fix (114 shots, 0 axe violations) · `npm run ui:flows` 102/107 in 38 min.
- First pass at ea6136a was red: 9 flows + 1 ui:verify screen.
  - `replays-stage`, `replays-stage-follow`, `replays-stage-overlays`, `replays-stage-view-leave` — story 173 (effb5ce): the Windows stage-hint paragraph resized the stage box after go-live. Fixed in 0acf61a.
  - ui:verify `replays-timeline@940x620` — story 170 (ccaa984): screen definition stale against stage mode (list hidden). Fixed in 8765ff7.
  - `replays-archive-readonly`, `replays-extra-folders`, `servers-filter-search`, `servers-master-sources`, `servers-sort-order` — pre-existing (also red at the sprint start a4a4145); not fixed here. (archive-readonly: judgement — the local installation is not Q2PRO.)
- Confirmation run: only those 5 pre-existing flows remain red. No blocker.
