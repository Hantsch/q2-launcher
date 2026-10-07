# Sprint S29 — Review

**Goal:** a demo plays on a stage inside the Demos view — a borderless Q2PRO window the launcher places and keeps in step with its own window — so the timeline and console field stay usable. Fullscreen is a deliberate button, steered by keys, with a bindable way back; the timeline can stop the demo; the game console is no longer flooded by the launcher's plumbing.

**Merge note:** the regression gate is green apart from 5 pre-existing failures. Two regressions from this sprint (173, 170) were found at the gate and fixed. Nothing blocks the merge.

## Overview

| Story                                           | Status                      | Commit                  |
| ----------------------------------------------- | --------------------------- | ----------------------- |
| 169 spike: a demo plays on the launcher's stage | done before the sprint (go) | —                       |
| 170 a demo plays on the launcher's stage        | done                        | ccaa984 (+ fix 8765ff7) |
| 171 the stage follows the launcher              | done                        | 9dcff58                 |
| 172 I choose fullscreen and come back           | done                        | d88c0cc                 |
| 173 I end the demo from the launcher            | done                        | effb5ce (+ fix 0acf61a) |
| 174 the game console is not flooded             | done                        | 5db56b0                 |
| 175 an address I add is saved right away        | done                        | ea6136a                 |

## Implemented stories

- **170** Demo playback launches Q2PRO windowed, borderless and topmost over a 4:3 stage in the Demos view (list/detail hidden, timeline and console beneath). Main converts the measured rect to physical pixels; `vid_fullscreen`/`vid_geometry` are restored line-exact afterwards. Wayland plays a normal window with a visible reason.
- **171** A main-side stage follower parks the game window off-desktop on drag, minimize, view-leave or overlay, places it after 250 ms quiet, and drops/restores topmost on launcher blur/focus. Overlays (dialogs, menus, toasts, the speed select) make the game step aside.
- **172** A fullscreen button on the timeline. Demo actions are guarded so queued presses are harmless, a bindable "Back to window" action returns to the stage, and the launcher follows the user's own fullscreen switches. State migration v5 adds the row and upgrades untouched demo commands.
- **173** `playback.stop` (quit over the channel, terminate after 5 s or at once if refused) with stop buttons on the timeline and the action bar's "Running" slot; Windows shows a visible hint that in-game typing does not reach the game.
- **174** The launcher-controlled session sets `con_notifylines 0` + `scr_chathud 1`, the Windows loop ticks every 13 frames (~200 ms), and both cvars are restored after the session.
- **175** New config operation `commitCvars` writes only the added address into the profile's file and the installation copies; a dirty profile keeps its other pending edits unsaved. The dialog toasts "saved".

## Findings & decisions

**User decisions**

- 4:3 stage using the space available; demo list/detail hidden while a demo plays (170).
- Stage cvars go non-archived where possible; **restore after the session only where no non-archived path exists** — `vid_fullscreen`/`vid_geometry` are archived engine-side and must be set live, so the restore is line-exact (only those lines of `q2config.cfg`; the one recorded exception to story 004) (170).
- Linux Wayland: detected, visible "Not available on Wayland: …" reason, normal window (170).
- Overlays: hide the game while a launcher overlay is open (171). Latency: hide the game during drag/resize, show it at the end (171); "hide" = **park** (off-screen via `vid_geometry`), not minimize or pause.
- Queued presses: demo actions guarded on a cvar (position-moved guard `q2l_armpos`) so stale presses do nothing (172). The launcher follows the user's own fullscreen switches (Alt+Enter) (172).
- Stop in the timeline **and** the action bar's Running button turns into stop; stop immediately, no confirmation (173).
- Chat stays visible: `scr_chathud 1` + `con_notifylines 0` (option a), other notify lines are hidden too; Windows tick slows to ~200 ms (174).
- A dirty profile: only the address is written, every other pending edit stays pending (175).

**Technical decisions (main ones)**

- Restore survives a launcher crash (pending snapshot applied at next start); the restore helper takes a cvar-name list, which 174 reused (`SESSION_RESTORE_CVARS`).
- One timing rule for the follower: park immediately, place after 250 ms quiet, one command in flight per kind, dedupe, retry on busy. Main sees the window through a read-only observer seam, never `BrowserWindow`.
- Overlays occlude by intersection (Modal always; Menu/Popover/HoverCard/toasts only over the stage rect; the native speed select from mousedown to change/blur).
- Guard uses `ne` with an `x` prefix; a paused demo is resumed on the switch; the first press within one position step after the switch is ignored (accepted price). "Back to window" is `exec q2l_back.cfg`, written per session.
- While fullscreen, timeline and console sends are rejected with a visible reason on both platforms.
- `commitCvars` renders the file from the baseline (not the live profile), never uses `markFileSeen`, leaves `dirty` untouched, refuses on a changed/unreadable file (`commitConflict`) and on a dirty profile without baseline (`commitNeedsSave`); disk first, then state.
- The Windows stage hint (173) lives in the console field's reserved reason line so the stage box does not change size.

**Unfixed review notes and limitations**

- 170: launcher quit while the game keeps running — next start's `applyPending` restores before the engine's write-on-exit, so the stage values can persist. Negative display origins are emitted as `+-X` in `vid_geometry`; Q2PRO's parsing is unverified. `toGeometry` in `index.ts` has no unit test of its own.
- 171: the speed select stays parked/`always` after Escape or re-pick until blur; overlay-registry unit tests cover only the store (Menu/Popover/HoverCard/Toasts registration untested); Alt+Down/F4 untested; a narrow stale-desired-geometry edge after a busy failure.
- 172: a user Alt+Enter racing a queued button switch can drop the switch; stale-FS0 detection covers one read batch; a switch back made inside fullscreen (Alt+Enter) is not observable on Windows (the keys text names the bind); `pause` stays ungated on r1q2 (playback is Q2PRO-only); index.ts wiring of the follower suspension has no unit test.
- 173: if the kill succeeds but no `exit` ever arrives (e.g. a Linux wine wrapper), the UI stays on "Stopping…"; an action-bar stop refusal is silent; hint-gone-in-fullscreen/after-finish is unit-tested only.
- 174: nothing tests the `index.ts` wiring of `SESSION_RESTORE_CVARS` as restore names.
- 175: a pending `writeCatalogDefaults` toggle is not in `captureBaseline`, so it lands on disk with the commit (documented in code; follow-up: add it to `profile-baseline.ts`). One unexplained flaky run of `src/main/modules/config/index.test.ts` (1 of 5 during D1, not captured, 0 of 6 later).
- Trail hygiene: 174/175 progress lines use date-prefixed timestamps (`2026-09-29 HH:MM`) instead of plain `HH:MM:SS`; timestamps are still monotonic. 171's trail carries an extra `D2b` step.
- Process mishap: during gate failure attribution a worktree cleanup deleted `node_modules`; it was restored with `npm ci`, no source was affected.

## Blocked / open

Nothing blocked. Pre-existing red flows, red at the sprint start (a4a4145) and unchanged: `replays-archive-readonly` (judgement: the local installation is not Q2PRO), `replays-extra-folders`, `servers-filter-search`, `servers-master-sources`, `servers-sort-order`. `controls-extra-keys` was red on bare HEAD during 172 (keyboard-focus flake) but was green in the gate runs.

## Regression gate

See `sprint.md` → Regression gate. At 8765ff7: build, `npm test` (405 files / 5842 tests) and `ui:verify` (114 shots, 0 axe violations) green; `ui:flows` 102/107. The first pass was red on 9 flows + 1 screen: the 173 stage-hint paragraph resized the stage box (4 flows; fixed in 0acf61a) and the 170 `replays-timeline@940x620` screen definition was stale against stage mode (fixed in 8765ff7). The remaining 5 reds are pre-existing and are not this sprint's. No merge blocker.

## Acceptance

Every criterion maps to named tests in its story's `## Done`:

- **170** AC1 `replays-stage` + `DemoStage.test` + `stage-fit.test`; AC2 `stage.test` + `demo-play.test` + `replays-stage`; AC3 `launch-plan.test` + `demo-play.test`; AC4 `session-cvar-restore.test`; AC5 `replays-stage-unavailable` + `stage.test` + `demo-play.test`; AC6 `DemoStage.test` + `stage.test`.
- **171** AC1 `stage-follow.test` + `replays-stage-follow` + `replays-stage-view-leave`; AC2/AC3 `stage-follow.test` + `replays-stage-follow`; AC4 `replays-stage-view-leave`; AC5 `overlay-registry.test` + `replays-stage-overlays`.
- **172** AC1 `replays-fullscreen` + `DemoTimeline.test`; AC2 `windows-channel.test` + `protocol.test` + flow; AC3 `DemoTimeline.test` + flow; AC4 `action-catalog.test` + `migrations.test` + `demo-actions-bind`; AC5 `windows-channel.test` + `protocol.test` + flow; AC6 `protocol.test` + `demo-guard.test`; AC7 `migrations.test`.
- **173** AC1 `replays-stop` (timeline + action bar) + `playback-stop.test`; AC2/AC3 `replays-stop` + `playback-stop.test` + `launch.test`; AC4 `replays-stop` + `ConsoleCommandField.test`; AC5 `ConsoleCommandField.test`.
- **174** AC1 `protocol.test` + `replays-play-q2pro`; AC2 `protocol.test`; AC3 `windows-channel.test`, `playback-control.test`, `protocol.test`, `replays-timeline`; AC4 `session-cvar-restore.test` + `demo-play.test`.
- **175** AC1–AC3 `servers-address-book` flow + `config/index.test`; AC4 `AddToAddressBookDialog.test` + `config/index.test`; AC5 `AddToAddressBookDialog.test`.

**Manual residue** (see `testplan.md`):

- 170 AC2 — the real Q2PRO window's client area on the stage, borderless and topmost, at 150 % scaling, on X11 and with a negative display origin (the stub engine opens no window; CI has no scaled display).
- 171 AC2 — real Q2PRO honours a fully off-desktop `vid_geometry` (no clamp back onto a monitor); the stub engine has no window.
- 171 AC3 — the OS topmost flag and z-order against another real program (the harness window is non-focusable and off-screen by design).
- 172 AC2 — real key presses and typed console lines in a real Q2PRO fullscreen (synthetic keys do not reach Q2PRO, no licensed game data in CI).
- 174 AC1 — the real picture has no notify lines and shows chat in the chat HUD. Already verified once by the D1 probe against `C:\Games\Q2Pro` (`spikes/174-chat-hud`, PASS); the testplan keeps a short re-check.
- 175 AC6 — documentation-only (127's AC4 pointer); confirmed by the reviewer, nothing to walk, so not in the testplan.

**Covered below the real surface:** 173 AC5 (Linux hint absent) by a component test — no Linux e2e runner; 175 AC4 (write failure) by unit + component tests, because a read-only file fails differently on Windows and Linux; 170 AC5's Wayland path runs through the harness lever `Q2L_UI_SESSION_TYPE` on the Windows runner; the physical-pixel math (170 AC2) rests on `stage.test.ts` with an injected `dipToScreen`; Linux channel behaviour in 172 by unit tests; 173's hint-gone-in-fullscreen/after-finish by unit tests; 174 AC2's line rate is a recorded decision, not a measurement.

## Tier record

| Story     | Ds     | hard Ds | review stages                 | review cycles | agents | build min |
| --------- | ------ | ------- | ----------------------------- | ------------- | ------ | --------- |
| 170       | 5      | 1       | default + hard                | 2             | 11     | 37        |
| 171       | 5      | 1       | default                       | 0             | 8      | 31        |
| 172       | 7      | 1       | default                       | 1             | 12     | 58        |
| 173       | 4      | 1       | default                       | 1             | 8      | 20        |
| 174       | 3      | 0       | default                       | 1             | 5      | 11        |
| 175       | 3      | 1       | default                       | 1             | 7      | 17        |
| **Total** | **27** | **5**   | 5× default, 1× default + hard | 6             | 51     | 174       |

Build minutes are `build · started` to `story · done` in `progress.md`; refine (~30 min for all six stories) and the gate (~100 min) are not included.

The hard review (only 170 had default + hard) found what the default review missed: the default stage returned UNCLEAR, the hard stage FAIL on the snapshot-overwrite and tiny-rect issues (a failed restore overwriting the original snapshot, and a stage rect under 64 px). Both were fixed, each with a new test.

## Changelog

Every user-facing story (170–175) has its CHANGELOG entry from build; none were late.
