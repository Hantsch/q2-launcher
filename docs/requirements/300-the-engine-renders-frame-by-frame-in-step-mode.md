---
id: 300
title: The engine renders frame by frame in a step mode
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

The export advances the engine frame by frame by a fixed time span and gets exactly one fully
rendered picture after each step. An export is then reproducible regardless of the machine's speed
and of whether the window is visible.

Context:

- [concept §8.2](../concepts/integrated-demo-player.md): `q2l_step`, forced refresh,
  `cls.active`, `cl_async 1`, `r_maxfps 0`, integer-ms cadence, `Q_srand(seed)`.
- [concept §10.1](../concepts/integrated-demo-player.md) (step mode), risks R3 and R12 in
  [concept §11](../concepts/integrated-demo-player.md).
- Spike result: `spikes/285-deterministic-step/RESULT.md` (determinism, the cvar that turns flares
  off, causes of deviations).
- Engine code to patch: `Qcommon_Frame` (`src/common/common.c`), `CL_Frame`,
  `CL_UpdateFrameTimes` and `CL_Activate` (`src/client/main.c`). The patch series lives under
  `engine/patches/` ([[281]]).
- C bridge from [[294]], adapter from [[296]]. Main window: `src/main/window.ts`,
  `src/main/window-shared.ts` (`backgroundThrottling` is off only in the harness).
- Constraints:
  - `q2l_step(int ms)` runs, in order: `setjmp(com_abortframe)`, `com_localTime += ms`,
    `SV_Frame(ms)`, `CL_Frame(ms)`. It never calls `NET_Sleep` or `Sys_Milliseconds`.
    `q2l_capture_begin`/`q2l_capture_end` save and restore every cvar they change.
  - A JS `EngineCapture` interface (`begin`, `step(ms) → { frameSeq }`, `end`) lives in the
    replays module for the `ExportController` only. It is not part of `DemoPlayer`.
  - Background throttling gets a new contract-first channel `exportThrottle { active: boolean }`
    (zod), whose handler calls `event.sender.setBackgroundThrottling`. It is always reset after
    the end or a cancel (`finally`).
  - Until the engine lane exists ([[304]]), the determinism check runs through the spike harness
    in `spikes/285-deterministic-step/`.
- Not in scope: encoder and file logic ([[299]], [[302]]), export resolution ([[301]]), audio
  ([[305]]).
- Expected manual residue: start the export loop with a minimised window on a real GPU, and
  measure whether it keeps running and how long it takes compared with a visible window (the AC6
  measurement).
- Depends on: [[285]], [[294]].

## Acceptance Criteria

- [ ] **AC1** — After `q2l_capture_begin(1, …)` and 60 calls of `q2l_step(ms_i)` with
      `ms_i = round((i+1)·1000/60) − round(i·1000/60)`, `position_ms` has grown by exactly 1000 ms.
- [ ] **AC2** — In that run, `frame_seq` has grown by exactly 60 (one refresh per step).
- [ ] **AC3** — Two captures of the same demo with the same seed and start point in one process
      give pairwise equal SHA-256 hashes for 120 frames (`gl.readPixels`, SwiftShader):
      `node spikes/285-deterministic-step/harness.mjs --frames 120 --runs 2` reports
      "hashes equal: 120/120".
- [ ] **AC4** — For 24, 25, 30, 50 and 60 fps over 10 s, the pure function
      `stepCadence(fps, frameCount)` in `src/shared/replays/` sums to exactly 10 000 ms.
- [ ] **AC5** — In those cadences, every step deviates from `1000/fps` by at most 1 ms.
- [ ] **AC6** — While a capture runs, the adapter does not call `q2l_frame` from the rAF loop.
- [ ] **AC7** — After `q2l_capture_end`, the real-time loop runs again, paused.
- [ ] **AC8** — Main calls `webContents.setBackgroundThrottling(false)` when an export starts and
      restores it at the end and on cancel (unit test with a fake `webContents`).
- [ ] **AC9** — With the window minimised, 120 steps take at most 20 % longer than with the window
      visible.
- [ ] **AC10** — While a capture runs, user commands (seek, speed) are refused with
      `fail('replays.player.error.busyExporting')`.
- [ ] **AC11** — The patch is in `engine/patches/` with a comment stating its purpose; concept
      §8.2 is updated where the findings differ.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
