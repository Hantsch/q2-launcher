# Story 285 D3 - result: the engine steps deterministically

Harness: `harness.mjs` (see `README.md`), demo `tests/engine/demos/move-fire.dm2`, 640x480, 300 counted steps per run,
2 runs per command, a frame hash every 15th frame (20 hashes per run; `frame` = step index + 1). All figures are read from
`results/hashes-swiftshader.json` (SW), `results/hashes-gpu.json` (GPU), `results/hashes-swiftshader-noseed.json` (NS) and
`results/hashes-swiftshader-60fps.json` (60). Every run of every file: `framesRendered` 300, `warmupSteps` 3. The GPU and
SwiftShader comparisons were run on one machine (one driver), so "stable" means stable there.

## AC2 - step and frame counter

`_q2l_step(ms)` renders exactly one frame per step: `framesRendered` is 300 for 300 counted steps in every run of all four
files (the harness fails the run on any step where `_q2l_frames_rendered()` moves by other than 1). The harness
steps until 3 consecutive steps render one frame each before counting (a guard for slower map loads): `warmupSteps` is 3 in
every run, i.e. no step rendered nothing here. The
engine's own main loop is paused (`pauseMainLoop()`) before the first step; `cl_async 1`, `r_maxfps 0`.

## AC3 - SwiftShader, two runs, seeded

`hashes-swiftshader.json` (`--seed=1`): `identical` true, `firstDifferentFrame` null, 20 of 20 sampled hashes equal between
run 0 and run 1. `hashes-swiftshader-60fps.json` (`--fps=60`, steps of 16 and 17 ms): `identical` true, 20 of 20 equal.
`glRenderer` in both: `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`, so the
software path was really used.

## AC4 - per renderer: stable, and SwiftShader against GPU

- SwiftShader: stable (AC3).
- GPU: stable. `hashes-gpu.json` (`--renderer=gpu --seed=1`): `identical` true, `firstDifferentFrame` null, 20 of 20 equal.
  The GPU was really used: `glRenderer` is `ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 (0x00002704) Direct3D11 vs_5_0 ps_5_0, D3D11)`
  in both runs, not a silent software fallback.
- **SwiftShader and GPU hashes differ in 20 of 20 sampled frames** (`hashes-swiftshader.json` against `hashes-gpu.json`, same
  frame numbers, same seed). A golden hash is therefore per renderer; one set cannot serve both. The frames look alike
  (`results/frame-swiftshader-<n>.png`, `results/frame-gpu-<n>.png`, n = 60, 120, 180, 240, 300) but are not byte-equal.
  No tolerance or perceptual comparison was measured in this spike.

## AC5 - unseeded: is the seed needed

`hashes-swiftshader-noseed.json` (`--no-seed`, runs started over a second apart so the engine's `time(NULL)` seed differs):
`identical` false, **`firstDifferentFrame` 150**. Frames 15 to 135 (9 samples) are equal; 9 of 20 samples differ in total
(frames 150, 165, 180, 195, 210, 255, 270, 285, 300; 225 and 240 happen to be equal again, so the difference is not
monotone). **Verdict: seed needed.** The first random-dependent effect in the demo appears between frames 136 and 150 (every 15th frame is sampled, so 150 is the first sampled difference); a golden test must
call `_q2l_seed` right after init, before the first step.

## AC6 - flares and occlusion queries

Switch: `+set cl_flares 0` (the harness uses it). Code path (`vendor/q2pro-mashed/src`):

- `client/entities.c` (CL_AddPacketEntities, extended protocol): `if (renderfx & RF_FLARE) { if (!cl_flares->integer) goto skip; ... }`
  - the flare entity is never created.
- `refresh/main.c`: only entities with `RF_FLARE` are linked into `glr.ents.flares`; the query issue loop (`qglGenQueries`,
  begin/end query, `q->timestamp = com_eventTime`) and `refresh/tess.c` (the `GL_QUERY_RESULT_NO_WAIT` /
  `GL_QUERY_RESULT_AVAILABLE` reads, `if (!glr.ents.flares) return;`) both iterate that list.

So with `cl_flares 0` **no occlusion query is issued and none is read**; `tess.c` returns at the empty-list check. With
`cl_flares 1` the queries would influence the image: `q->visible` comes from an asynchronous result that is read when
available, so the frame on which a flare fades in depends on GPU timing, and the 2500 ms reset and 33 ms re-issue gates use
`com_eventTime`, which `q2l_step` does not advance (AC7). No patch is needed for determinism as long as the cvar stays 0; a
stricter guarantee (a user config or a server cannot turn it on) would need a step-mode hook that forces `cl_flares` to 0.
Not written here. The demo's own flares were not inspected; the harness result holds with the cvar at 0.

## AC7 - other non-determinism sources, each with a countermeasure

- **RNG seed.** `Q_srand(time(NULL))` at startup (`common/common.c`); particles, muzzle flash and tank sounds use `Q_rand`
  (`client/effects.c`). Effect: NS differs from frame 150 (AC5). Countermeasure: `_q2l_seed(n)` after init (done). `Q_rand` is the
  engine's own Mersenne twister, not libc `rand()`; no libc `rand()` or `random()` hit in `client/` or `refresh/`.
- **`com_eventTime`.** Set from `Sys_Milliseconds()` in `Qcommon_Frame` only; `q2l_step` skips it, so it stays at its last real
  value. Affects flare cadence (`refresh/main.c`) and key hold time (`client/input.c`). Countermeasure: keep `cl_flares 0`; in
  story 300 set `com_eventTime = com_localTime` inside `q2l_step` before `CL_Frame`. Irrelevant for demo playback.
- **`Sys_Milliseconds()` left in the client.** `cls.disable_screen` loading-plaque timeout (120 s wall clock, `screen.c`),
  `timedemo` timing (`demo.c`), `host_speeds` (`main.c`), `SCR_TimeRefresh`. Countermeasure: none needed for a 300-step demo
  run (no plaque expiry within seconds, timedemo and host_speeds off); story 300 routes them through step time.
- **`cls.realtime`, `com_localTime`, `com_localTime2`.** Deterministic: advanced from the step's `msec`. The harness feeds
  `round((i+1)*1000/fps) - round(i*1000/fps)` ms.
- **60 fps cadence.** Steps alternate 16 and 17 ms; stable (60: `identical` true) but a different timeline from 30 fps, so the
  two never share hashes. Countermeasure: the fps is part of the golden's key; one fixed step table.
- **Frames per step.** A step that renders 0 or 2 images would detach the hashed frame from the step. Countermeasure: count
  with `_q2l_frames_rendered()` per step and fail on any delta other than 1 (done); warm up until steady.
- **Window focus.** A blur calls `CL_Activate(ACT_RESTORED)` (`unix/video/emscripten.c`), which switches the client from async
  to the 60 Hz sleep sync mode; at 33 ms steps that still renders one frame per step, so the frame guard would not notice.
  Countermeasure: keep the window focused with background throttling off (the harness does) and set the activation state in
  story 300's step mode instead of relying on window focus.
- **GPU variance.** GPU and SwiftShader never match (AC4); another GPU or driver is untested. Countermeasure: golden per
  renderer (SwiftShader for the CI lane), re-record on a driver change.
- **`readPixels` timing.** The drawing buffer is cleared at composite. Countermeasure: read in the same task as the step,
  before yielding (done; the harness only awaits the digest after the read).

## Recommendation

- Story 300 (production step mode): keep `q2l_step`, `q2l_seed`, `q2l_frames_rendered` exported; add
  `com_eventTime = com_localTime` inside the step, force `cl_flares 0` and `cl_async 1` in step mode, route the client's
  `Sys_Milliseconds` readers through step time, and always call `_q2l_seed` before the first step. Fixed fps table, warm up
  until 3 steady frames.
- Story 304 (golden lane): SwiftShader only (`--renderer=swiftshader`), seeded, 30 fps, hash every 15th frame; store goldens
  per renderer and fps (`hashes-swiftshader.json` is the template). The GPU is stable on this machine but differs from
  SwiftShader in 20 of 20 frames, so a GPU golden would need its own set per driver and is better left as an advisory lane.
