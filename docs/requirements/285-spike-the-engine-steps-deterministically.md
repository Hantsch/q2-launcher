---
id: 285
title: 'Spike: the engine steps deterministically'
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want proof that the engine produces bit-identical frames when it is
driven with fixed time steps, so that video export and golden-frame tests rest on a solid base.

Spike, timebox 2 days: delivers `spikes/285-deterministic-step/RESULT.md` with measurements and a
recommendation, no production code (the engine patch is committed under `engine/patches/`).

Context:

- [concept §8.2](../concepts/integrated-demo-player.md) (main loop and time), [concept §10.1](../concepts/integrated-demo-player.md) (step mode), [concept §13](../concepts/integrated-demo-player.md) (test
  strategy), risk R3 (randomness, occlusion queries, integer ms, GPU variance).
- Engine time path: `Qcommon_Frame` in `vendor/q2pro/src/common/common.c` (`NET_Sleep`,
  `Sys_Milliseconds`, `fixedtime`, `timescale`); `CL_Frame` and `CL_UpdateFrameTimes` in
  `vendor/q2pro/src/client/main.c` (sync modes `SYNC_SLEEP_60`, `SYNC_MAXFPS`). Randomness:
  `Q_srand(time(NULL))` in `Qcommon_Init`. Flare occlusion queries: `vendor/q2pro/src/refresh/tess.c`
  (`GL_QUERY_RESULT_AVAILABLE`).
- Patch: `q2l_step(int ms)` in a new engine file `src/unix/q2l_step.c` (`EMSCRIPTEN_KEEPALIVE`,
  exported via `-sEXPORTED_FUNCTIONS`): `setjmp`, `com_localTime += ms`, `SV_Frame`, `CL_Frame`,
  no `NET_Sleep`, no `Sys_Milliseconds`. Before a run: `cls.active = ACT_ACTIVATED`, `cl_async 1`,
  `r_maxfps 0`, `Q_srand(seed)`.
- Frame hash in the harness right after `q2l_step` via `gl.readPixels` on the canvas' WebGL2
  context (same task), then `crypto.subtle.digest('SHA-256', …)`. Harness
  `spikes/285-deterministic-step/harness.mjs` on the Electron frame from [[284]], data and demo
  from [[283]].
- 30 fps (33/33/34 ms) or 25 fps (40 ms) is mandatory; 60 fps (17/17/16 ms) only as an extra
  measurement.
- Not in scope: audio ([[286]]), encoders ([[282]]), export UI, the production step mode
  ([[300]]), the golden lane ([[304]]).
- Depends on: [[284]], [[283]]

Expected manual residue: a sample of the saved frames (`results/frame-*.png`) shows movement, not
frozen pictures.

## Acceptance Criteria

- [ ] **AC1** — `npm run engine:build` exits 0 with the `q2l_step` patch.
- [ ] **AC2** — 300 steps of 33 ms render exactly one frame each (a frame counter rises by 1 per
      step).
- [ ] **AC3** — With seed 1, flares off, 640×480 and the [[283]] test demo, two runs in the same
      process (engine re-initialised) give identical SHA-256 for every 15th frame:
      `node spikes/285-deterministic-step/harness.mjs --runs=2 --seed=1 --renderer=swiftshader`
      exits 0 and writes `results/hashes-swiftshader.json` with two identical hash lists.
- [ ] **AC4** — The same run under SwiftShader (`--use-angle=swiftshader
--enable-unsafe-swiftshader`) and on the real GPU (`--renderer=gpu`) is recorded in
      `RESULT.md`: stable per renderer or not, and whether the renderers differ from each other.
- [ ] **AC5** — Two runs without a fixed seed (`--no-seed`) are recorded in `RESULT.md` with the
      first frame whose hashes differ (proving whether the seed is needed).
- [ ] **AC6** — `RESULT.md` names the cvar or patch that switches off flares/occlusion queries
      during capture.
- [ ] **AC7** — `RESULT.md` lists every other source of non-determinism found, each with a
      countermeasure, and a recommendation for [[300]] and [[304]].
- [ ] **AC8** — `git status --short src/` is empty.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
