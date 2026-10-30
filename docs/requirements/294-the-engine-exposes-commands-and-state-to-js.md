---
id: 294
title: The engine exposes commands and a state struct to JS
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

The launcher steers the WebAssembly engine through typed C functions and reads its state per frame
from one fixed struct. There is no cfg/exec detour and no console parsing, and state changes reach
the launcher without polling latency (success criterion K2: a command shows its effect within one
rendered frame).

Context:

- [concept §9.3](../concepts/integrated-demo-player.md) (C bridge, `q2l_state_t`, "state struct
  instead of callbacks"), [concept §8.2](../concepts/integrated-demo-player.md) (main loop).
- Engine functions (Q2PRO source, read-only under `vendor/q2pro/`):
  - `Cbuf_AddText`, `Cmd_ExecuteString` (`src/common/cmd.c`).
  - `CL_Pause_f`, `CL_CheckForPause`, `CL_DemoPos_m` (`src/client/main.c`).
  - `CL_Seek_f`, `update_status` (`file_progress`), `CL_FirstDemoFrame` (`src/client/demo.c`).
  - `Com_Error` (`src/common/common.c`).
  - `cl.mapname`, `cl.frame.clientNum`, `cl.clientinfo[].name`, `cl.frame.ps.stats[]`
    (`src/client/client.h`, `inc/shared/shared.h` `STAT_*`).
- Existing patch series under `engine/patches/`, from [[281]], [[285]] (`q2l_step`), [[286]]
  (`snddma_web`) and [[291]] (`q2l_console`).
- Constraints:
  - `q2l_state_t` is a static struct filled after `CL_Frame`, with strings copied via `Q_strlcpy`.
    Field offsets are pinned with `_Static_assert` and exported as a layout file
    (`q2l_state_layout.json`), so the TS reader ([[296]]) can be checked against them.
  - Seeking takes no console syntax from JS: the bridge builds the seek from milliseconds itself
    or calls the internal seek logic.
  - Errors are hooked in `Com_Error` before the `longjmp`.
  - `npm run engine:smoke -- --bridge` exercises the bridge with the test demo from [[283]] and
    writes `results/bridge.json`.
- Not in scope:
  - the TS adapter ([[296]]) and any UI;
  - productive capture or `q2l_step` ([[300]]) and `q2l_audio_take` ([[305]]); existing spike
    exports stay as they are;
  - MVD paths (`mvdseek`, `mvdpause`, [[319]]).
- Depends on: [[291]].

## Acceptance Criteria

- [ ] **AC1** — The engine exports `q2l_init`, `q2l_frame`, `q2l_console`, `q2l_play_demo`,
      `q2l_set_paused`, `q2l_seek`, `q2l_set_speed`, `q2l_set_volume`, `q2l_set_cvar` and
      `q2l_state` with the signatures of concept §9.3. After `npm run engine:build`,
      `npx wasm-objdump -x resources/engine/q2pro.wasm | grep -c "q2l_"` reports at least 10.
- [ ] **AC2** — `emscripten_set_main_loop` is gone. One `q2l_frame(realMs)` call from
      `requestAnimationFrame` runs exactly one `Qcommon_Frame` equivalent, without `NET_Sleep` and
      without busy-waiting.
- [ ] **AC3** — While a demo plays, `frame_seq` in `q2l_state()` grows by 1 per frame.
- [ ] **AC4** — While a demo plays, `position_ms`, `frames_read`, `paused`, `seeking`, `speed`,
      `map`, `pov_client`, `pov_name` and `stats[4]` are filled.
- [ ] **AC5** — Over 10 s of playback, `position_ms / 100` differs from `frames_read` by at most 1.
- [ ] **AC6** — After `q2l_set_paused(1)` and one more frame, `paused` is 1 and `position_ms` stays
      the same.
- [ ] **AC7** — While paused, no PAUSED picture is drawn (`scr_showpause 0` stays in effect).
- [ ] **AC8** — During `q2l_seek(1, 30000)` (absolute, 30 s), `seeking` is 1 for at least one
      frame. Afterwards it is 0 and `position_ms` is 30000 ± 100.
- [ ] **AC9** — Relative seek (`mode 0`) and percent seek (`mode 2`) end at the expected position
      (± 100 ms).
- [ ] **AC10** — An engine error (`Com_Error ERR_DROP`, e.g. a broken demo) increments
      `error_seq`, puts the text into `error` and sets `demo_state` to 4.
- [ ] **AC11** — After such an error, the next `q2l_play_demo` plays normally.
- [ ] **AC12** — `q2l_set_cvar` with a name outside the engine allowlist (`scr_draw2d`,
      `scr_chathud`, `crosshair`, `scr_demobar`, `scr_showpause`, `s_volume`, `timescale`) changes
      nothing and prints a warning to the console.
- [ ] **AC13** — While paused, `q2l_seek(0, ±100)` moves the position by exactly one server frame
      and playback stays paused. If it does not, the deviation is recorded in the story and a
      dedicated `q2l_step_frame(±1)` is proposed instead.
- [ ] **AC14** — `npm run engine:data && npm run engine:smoke -- --bridge` exits 0. Its
      `bridge.json` reports AC3–AC12 as true and records the AC13 result.

## Open Questions

1. Does Q2PRO's `seek` act as a single-frame step while paused (AC13), or is a dedicated
   `q2l_step_frame(±1)` needed?

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
