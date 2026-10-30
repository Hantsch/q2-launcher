---
id: 285
title: 'Spike: the engine steps deterministically'
status: done # draft -> ready -> in-progress -> done
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

- [x] **AC1** — `npm run engine:build` exits 0 with the `q2l_step` patch.
- [x] **AC2** — 300 steps of 33 ms render exactly one frame each (a frame counter rises by 1 per
      step).
- [x] **AC3** — With seed 1, flares off, 640×480 and the [[283]] test demo, two runs in the same
      process (engine re-initialised) give identical SHA-256 for every 15th frame:
      `node spikes/285-deterministic-step/harness.mjs --runs=2 --seed=1 --renderer=swiftshader`
      exits 0 and writes `results/hashes-swiftshader.json` with two identical hash lists.
- [x] **AC4** — The same run under SwiftShader (`--use-angle=swiftshader
--enable-unsafe-swiftshader`) and on the real GPU (`--renderer=gpu`) is recorded in
      `RESULT.md`: stable per renderer or not, and whether the renderers differ from each other.
- [x] **AC5** — Two runs without a fixed seed (`--no-seed`) are recorded in `RESULT.md` with the
      first frame whose hashes differ (proving whether the seed is needed).
- [x] **AC6** — `RESULT.md` names the cvar or patch that switches off flares/occlusion queries
      during capture.
- [x] **AC7** — `RESULT.md` lists every other source of non-determinism found, each with a
      countermeasure, and a recommendation for [[300]] and [[304]].
- [x] **AC8** — `git status --short src/` is empty.

## Open Questions

## Decisions (Sprint)

- Patch base is the MashedD tree (`vendor/q2pro-mashed/`), as a new patch ordered after [[281]]'s
  series — 281's (User) decision makes that fork the engine base.
- `com_abortframe` is `static` in `common.c`; the patch drops `static` and declares it `extern` in
  `inc/common/common.h` so `q2l_step.c` can `setjmp` on it — keeps the story's separate-file layout
  with a two-line diff to `common.c`.
- `q2l_step(ms)` mirrors `Qcommon_Frame` from the point `msec` is known (`com_localTime`,
  `com_framenum`, `Sys_RunConsole`, `NET_UpdateStats`, `SV_Frame`, `CL_Frame`) and drops `NET_Sleep`,
  `Sys_Milliseconds`, the busy-wait, the 250 ms clamp and `fixedtime`/`timescale` — skipping the
  console/command part would let queued commands land a step late and shift every hash.
- The harness pauses Emscripten's requestAnimationFrame loop (`Module.pauseMainLoop()`) before the
  first step — otherwise real-time `Qcommon_Frame` calls interleave with the steps and break AC2/AC3.
- AC2's frame counter is an engine-side `q2l_frames_rendered()` bumped after the main `R_EndFrame` in
  `SCR_UpdateScreen` — counting step calls would pass AC2 without proving a refresh happened.
- Seeding is an exported `q2l_seed(int)` calling `Q_srand`, called by the harness before the first
  step; `--no-seed` skips it — the seed must come after `Qcommon_Init`'s `time(NULL)` seeding to matter.
- "Engine re-initialised" means a fresh module instance on a new canvas in the same Electron renderer —
  an in-engine `disconnect`/restart keeps cvar, cache and RNG state and tests something weaker than
  the golden lane's self-check.
- AC2's "33 ms" is the 30 fps cadence `ms_i = round((i+1)·1000/30) − round(i·1000/30)` (33/33/34) in
  the same run as AC3 — the story makes that cadence mandatory and one run proves both.
- The harness copies (does not import) window, `webPreferences`, CSP and spike scheme from
  `spikes/284-demo-frame-in-electron/harness.mjs`, naming the origin — spikes are self-contained
  throwaway code (185 derived from 183 the same way), and a second copy is within the reuse rule.
- Flares are switched off with `cl_flares 0` (verified: `src/client/main.c` registers it, the gate is
  in `src/client/entities.c`); whether `tess.c` still issues occlusion queries with it off is AC6's
  question, answered from the run, not assumed.
- Committed outputs: the `results/hashes-*.json` files and every 60th frame as `results/frame-<n>.png`
  (5 per renderer) — enough for the manual residue without bloating the repo.
- A sampled frame that is a single colour, or a run whose sampled hashes are all equal, fails the
  harness — identical hashes of blank or stale buffers would otherwise "prove" determinism.
- AC4's GPU run happens on this Windows machine; if no hardware GL context is available, RESULT.md says
  so with the reason and the SwiftShader result stands alone — the spike's verdict for [[304]] rests
  on SwiftShader anyway (concept §13).

## Plan

A spike: one engine patch, one harness, one RESULT.md. Nothing under `src/`, no changelog entry (not
user-visible), no systems doc touched.

1. **Engine patch** (`engine/patches/<NNN>-q2l-step.patch`, against the MashedD tree [[281]] pins):
   new `src/unix/q2l_step.c` with `q2l_step(ms)`, `q2l_seed(seed)`, `q2l_frames_rendered()`, all
   `EMSCRIPTEN_KEEPALIVE`; `com_abortframe` made extern; frame counter bumped in `SCR_UpdateScreen`
   after `R_EndFrame`; meson web branch compiles the file and exports the three symbols. Real-time
   playback (284's harness) keeps working unchanged.
2. **Harness** `spikes/285-deterministic-step/harness.mjs`: Electron window copied from 284, renderer
   flags per `--renderer`, data from 283's cache, demo `tests/engine/demos/move-fire.dm2`. Per run: a
   fresh module instance, 640×480, `cl_flares 0`, `cl_async 1`, `r_maxfps 0`, focus forced, `demo`,
   RAF loop paused, seed, 300 steps at the 30 fps cadence, counter check per step, every 15th frame
   `readPixels` + SHA-256 in the same task. Writes `results/hashes-<renderer>[-noseed].json`.
3. **Runs + RESULT.md**: SwiftShader ×2 seeded, GPU ×2 seeded, SwiftShader `--no-seed` ×2, one 60 fps
   extra; RESULT.md answers AC2–AC7 from those files and recommends for [[300]] and [[304]].

Order D1 → D2 → D3.

## Deliverables

- **D1 — `q2l_step` engine patch.** New `engine/patches/<NNN>-q2l-step.patch` (next number after the
  series story 281 put in `engine/patches/`; base = MashedD tree, read-only clone in
  `vendor/q2pro-mashed/`). The patch:
  (a) adds `src/unix/q2l_step.c` with `EMSCRIPTEN_KEEPALIVE void q2l_step(int ms)` —
  `if (setjmp(com_abortframe)) return;`, then exactly what `Qcommon_Frame` (`src/common/common.c`
  ~l.1080–1150) does once `msec` is known: `com_localTime += ms`,
  `com_localTime2 += ms & (sv_paused->integer - 1)`, `com_framenum++`, `Sys_RunConsole()`,
  `NET_UpdateStats()`, `SV_Frame(ms)`, `CL_Frame(ms)` — never `NET_Sleep`, `Sys_Milliseconds`, the
  busy-wait, the 250 ms clamp or `fixedtime`/`timescale`; `EMSCRIPTEN_KEEPALIVE void q2l_seed(int seed)`
  → `Q_srand(seed)`; `EMSCRIPTEN_KEEPALIVE int q2l_frames_rendered(void)` returning a counter;
  (b) `src/common/common.c`: `static jmp_buf com_abortframe` → non-static, `extern` declaration in
  `inc/common/common.h`;
  (c) `src/client/screen.c` `SCR_UpdateScreen`: increment the counter right after the main
  `R_EndFrame()` (~l.1246; declared in a header the client and `q2l_step.c` both see);
  (d) `meson.build` web branch: compile `src/unix/q2l_step.c` and extend `-sEXPORTED_FUNCTIONS`
  (currently `["_main"]`, ~l.738) by `_q2l_step`, `_q2l_seed`, `_q2l_frames_rendered`.
  Real-time play through `emscripten_set_main_loop` stays unchanged. Accept: `npm run engine:build`
  exits 0 with the patch applied; the built `resources/engine/q2pro.wasm` exports the three symbols
  (`wasm-objdump -x` in 281's Docker image); `git status --short src/` stays empty.
- **D2 — determinism harness.** New `spikes/285-deterministic-step/harness.mjs` plus `README.md` with
  the commands. Copy window, `webPreferences`, CSP and `q2spike://` scheme from
  `spikes/284-demo-frame-in-electron/harness.mjs` (header comment names the origin; do not import).
  Data: `Q2L_SPIKE_Q2DIR`, else the shareware cache of `npm run engine:data` (story 283; its last output
  line is the cache path), else stop with a clear message; demo `tests/engine/demos/move-fire.dm2`.
  Flags: `--runs=N` (default 2), `--seed=N` (default 1) / `--no-seed`, `--renderer=swiftshader|gpu`
  (swiftshader → `app.commandLine.appendSwitch('use-angle', 'swiftshader')` and
  `appendSwitch('enable-unsafe-swiftshader')`), `--fps=30|60` (default 30), `--steps=N` (default 300).
  Per run, all runs in one renderer process: a new 640×480 canvas (backing store and CSS), a fresh
  module instance, engine args as in 284 plus `+set cl_flares 0 +set cl_async 1 +set r_maxfps 0`,
  window focused and `setBackgroundThrottling(false)` so `cls.active` is `ACT_ACTIVATED`, queue
  `demo move-fire`, `Module.pauseMainLoop()`, `q2l_seed(seed)` unless `--no-seed`, then for
  i in 0..steps-1: `q2l_step(ms_i)` with `ms_i = round((i+1)·1000/fps) − round(i·1000/fps)`; assert
  `q2l_frames_rendered()` rose by exactly 1; every 15th frame, in the same task,
  `gl.readPixels(0, 0, 640, 480, RGBA, UNSIGNED_BYTE)` on the canvas' WebGL2 context →
  `crypto.subtle.digest('SHA-256', …)`; every 60th frame also save `results/frame-<i>.png` (results come
  back via `webContents.executeJavaScript`). Fail with a non-zero exit and a log line when a step renders
  ≠ 1 frame, a sampled frame is a single colour, all sampled hashes of one run are equal, or — with a
  seed — the runs' hash lists differ; with `--no-seed` a difference is reported, not a failure. Write
  `results/hashes-<renderer>[-noseed][-60fps].json` as
  `{ renderer, seed, fps, steps, runs: [{ framesRendered, hashes: [{ frame, sha256 }] }], identical, firstDifferentFrame }`.
  `npm run lint` and `npm run format:check` stay green for the new files. Accept:
  `node spikes/285-deterministic-step/harness.mjs --runs=2 --seed=1 --renderer=swiftshader` exits 0 and
  writes `results/hashes-swiftshader.json` with two identical lists of 20 hashes and
  `framesRendered: 300` per run.
- **D3 — measurements and RESULT.md.** Run D2's harness: `--renderer=swiftshader` (seeded, 2 runs),
  `--renderer=gpu` (seeded, 2 runs), `--renderer=swiftshader --no-seed` (2 runs, ≥ 1 s apart so
  `time(NULL)` differs), `--fps=60` once as an extra; commit the JSON files and frame PNGs under
  `spikes/285-deterministic-step/results/`. Write `spikes/285-deterministic-step/RESULT.md` in the
  style of `spikes/185-control-latency/RESULT.md`, with sections: **AC2** step/frame-counter result;
  **AC3** SwiftShader two-run result; **AC4** per renderer stable or not, and whether SwiftShader and
  GPU hashes differ (or "GPU not available" with the reason); **AC5** the `--no-seed` first differing
  frame and the verdict "seed needed / not needed"; **AC6** the switch for flares/occlusion queries
  (`cl_flares 0`, plus whether `src/refresh/tess.c` still issues `GL_QUERY_RESULT_AVAILABLE` queries
  with it off, and the patch needed if it does); **AC7** every other non-determinism source found
  (e.g. `Sys_Milliseconds`/realtime reads left inside `CL_Frame`, the 60 fps cadence), each with a
  countermeasure, and a recommendation for story 300 (production step mode) and story 304 (golden
  lane). Every number in RESULT.md must appear in a committed results JSON. Accept: RESULT.md answers
  AC2–AC7; `git status --short src/` is empty.

## Model Hints

- D1 → deliverable-hard — a C patch across engine internals under Emscripten: `setjmp` on a jump buffer
  moved across translation units, a step that must replicate `Qcommon_Frame`'s post-timing body
  exactly while the RAF main loop still exists, and a counter that must sit on the real refresh path,
  not on `CL_Frame` entry; each mistake silently skews every later hash.

Review: → story-review-hard — the plausible wrong spike reports "deterministic" from hashes of a blank,
stale or pre-draw buffer, or from a second "run" that reuses the first instance, or quotes RESULT.md
numbers absent from the results JSON; all pass the harness's exit code and a default review that
checks sections and shape.

## Acceptance Tests

A spike's evidence is an unattended probe against the real WASM engine, not a vitest/ui:flow test: the
harness is the test, `RESULT.md` + `results/*.json` its report. No launcher UI surface is involved, so
`ui:flow` does not apply (same convention as story 183).

- AC1 → command `npm run engine:build` › exit 0 with `engine/patches/<NNN>-q2l-step.patch` applied (D1).
- AC2 → probe `node spikes/285-deterministic-step/harness.mjs --runs=2 --seed=1 --renderer=swiftshader`
  › non-zero exit on any step whose `q2l_frames_rendered()` delta ≠ 1; `framesRendered: 300` per run
  in `results/hashes-swiftshader.json` → RESULT.md "AC2" (D2).
- AC3 → probe same run › exit 0, `results/hashes-swiftshader.json` `identical: true` with two lists of
  20 SHA-256 (D2).
- AC4 → probe `… --renderer=gpu` › `results/hashes-gpu.json` next to the SwiftShader file → RESULT.md
  "AC4" (D3).
- AC5 → probe `… --renderer=swiftshader --no-seed` › `results/hashes-swiftshader-noseed.json`
  `firstDifferentFrame` → RESULT.md "AC5" (D3).
- AC6 → RESULT.md "AC6" names `cl_flares 0` and the occlusion-query finding from the runs (D3).
- AC7 → RESULT.md "AC7" list with countermeasures and the 300/304 recommendation (D3).
- AC8 → command `git status --short src/` › empty output (D1/D3 acceptance, checked again in review).
- **manual residue:** look at `results/frame-*.png` — they show movement, not frozen pictures. The
  automated guard (no single-colour frame, sampled hashes not all equal) is the gate; judging the
  pictures by eye needs a person.

## Done

Spike delivered: engine patch `engine/patches/0007-web-step-the-engine-by-a-host-given-msec.patch` (`q2l_step`, `q2l_seed`, `q2l_frames_rendered`) and `spikes/285-deterministic-step/` (`harness.mjs`, `README.md`, `RESULT.md`, `results/*`). Fixed-step driving is bit-identical: SwiftShader 2 runs x 20 hashes identical, GPU (RTX 4080) identical, 60 fps identical; SwiftShader and GPU differ in 20 of 20 frames (goldens per renderer); `--no-seed` diverges (first sampled difference at frame 150, seed needed). `cl_flares 0` removes the occlusion queries.

Change type: docs

Commit message: `285: spike deterministic engine stepping (q2l_step patch, hash harness, RESULT.md)`

Verification: narrow gate — typecheck, lint, build, `vitest run --changed HEAD` (no tests selected), `npm run engine:build` exit 0, harness `--runs=2 --seed=1 --renderer=swiftshader` exit 0 with `identical: true`, 300 frames and 20 hashes per run; `git status --short src/` empty; no ui:flow applies. AC1-AC8 all verified by those runs and RESULT.md sections AC2-AC7. Review: stage 1 and hard stage PASS.

Decisions:

- The patch is named by the series' convention (0007-web-...) and counts frames after `SCR_UpdateScreen`'s main `R_EndFrame` (the plan's l.1246 is `SCR_TimeRefresh_f`).
- The harness warms up until 3 consecutive steps render one frame before the 300 counted steps (`warmupSteps` 3 in every run); `frame` is `i+1`.
- Window is focusable and focused (284's is not) so `cls.active` is activated; blur would switch the sync mode, listed in RESULT.md AC7.
- Reviews' wording findings fixed in RESULT.md (warm-up claim, "between frames 136 and 150", focus source); occlusion-query and `com_eventTime` claims are code reading, disclosed as such.

Manual residue: look at `results/frame-*.png` — they show movement, not frozen pictures (viewed by the reviewer: different scenes at frames 60 and 240).

tiers: D 3 / hard 1 · review default+hard · cycles 2 · agents 6
