---
id: 286
title: 'Spike: audio is pulled from the DMA mixer per step'
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want to pull the engine's sound step by step through a DMA driver
of our own, and play it in real time, so that both playback with sound ([[293]]) and frame-exact
audio export ([[305]]) build on a tested mechanism.

Spike, timebox 2 days: delivers `spikes/286-dma-audio-pull/RESULT.md` with measurements and a
recommendation, no production code (the engine patch is committed under `engine/patches/`).

Context:

- [concept §8.4](../concepts/integrated-demo-player.md) (audio), [concept §10.1](../concepts/integrated-demo-player.md) (step mode and audio capture), risk R6 (not exactly
  `48·ms` samples per step because of mixahead or skipped refreshes).
- DMA path: `vendor/q2pro/src/client/sound/dma.c` (`s_drivers[]`, `DMA_Init`, `DMA_Update`,
  `PaintChannels`), `vendor/q2pro/inc/client/sound/dma.h` (`dma_t`, `snddma_driver_t`), model
  `vendor/q2pro/src/unix/sound/sdl.c` (`Filler`). `S_Update` runs only on refresh frames
  (`vendor/q2pro/src/client/main.c` `CL_Frame`); `s_mixahead` is clamped to ≥ 0.125 while
  `!cls.active` (`sound/main.c`). Step function `q2l_step` from [[285]].
- Patch `engine/patches/NNNN-snddma-web.patch`: new `src/unix/sound/web.c` with
  `snddma_driver_t snddma_web = { .name = "web", … }`, listed in `s_drivers[]` under
  `#ifdef __EMSCRIPTEN__`; the meson web branch builds `dma.c` + `web.c`.
- Capture: `q2l_step(ms)` advances `samplepos` by `48·ms` frames; `q2l_audio_take(dst, maxFrames)`
  copies `[oldpos, oldpos+n)` out of the ring. Real time: an AudioWorklet reports consumed frames
  through a `SharedArrayBuffer`, or — without cross-origin isolation — a `MessagePort` with
  1024-frame blocks (reason recorded in `RESULT.md`).
- Harness `spikes/286-dma-audio-pull/harness.mjs` on the frames of [[284]]/[[285]].
- Not in scope: production code in the launcher, volume UI ([[293]]), AAC ([[306]]), sound in the
  launcher's export path ([[305]]).
- Depends on: [[284]]

Expected manual residue: listen to the real-time run — sound in sync with the picture, no clicks
or dropouts.

## Acceptance Criteria

- [ ] **AC1** — `npm run engine:build` exits 0 with `snddma_web`.
- [ ] **AC2** — With `s_driver web` and `s_khz 48`, the engine starts with the driver listed in the
      console without errors and `s_started` true.
- [ ] **AC3** — In capture mode (`s_mixahead 0`, `cls.active` forced), 600 steps at the 60 fps
      cadence (17/17/16 ms) each yield exactly `48·ms` stereo samples from `q2l_audio_take`:
      `harness.mjs --mode=capture --frames=600 --fps=60` exits 0 and writes `results/counts.json`
      with `mismatches: 0`.
- [ ] **AC4** — Two capture runs of the same demo with the same seed produce the same PCM
      SHA-256 (`--mode=capture --runs=2 --seed=1`, `results/pcm-hashes.json`).
- [ ] **AC5** — In real-time mode an AudioWorklet pulls the samples through a ring buffer and the
      demo is audible; `--mode=realtime --seconds=60` writes `results/realtime.json` with
      `underruns` per minute and `latencyMs` engine → output.
- [ ] **AC6** — `RESULT.md` describes the interface (`q2l_audio_take`, worklet ring buffer), the
      patches needed and open points for [[293]] and [[305]].
- [ ] **AC7** — `git status --short src/` is empty.

## Open Questions

## Decisions (Sprint)

- Engine paths in this story mean the MashedD fork under `vendor/q2pro-mashed/` (same file names
  as `vendor/q2pro/`), because [[281]] adopts that fork as the base (user decision there).
- "`s_started` true" is read as: after `S_Init`, the cvar `s_enable` reads `1` (`SS_DMA`) —
  `S_Init` writes `s_started` back into `s_enable`, so it is the only observable form without a
  new export; the harness passes `+set s_enable 1` so the DMA backend is the one under test.
- Units: `dma.samplepos` counts mono samples, so a capture step advances it by `48·ms·2`;
  `q2l_audio_take` counts stereo frames — the off-by-channels error is the most likely bug here.
- One `q2l_audio_take(dst, maxFrames)` serves both modes: it returns the painted-but-not-yet-taken
  frames `[taken, s_paintedtime)`, capped at `maxFrames`, because with `s_mixahead 0` that is
  exactly the step's `48·ms` and in real time it is the mix-ahead the worklet still needs.
- Real time: the engine ring stays private in the WebAssembly heap (the [[281]] build has no
  threads, so the heap is not a `SharedArrayBuffer`); the main thread copies with
  `q2l_audio_take` into a JS ring the worklet reads, and reports the worklet's consumed frames
  back through a second export `q2l_audio_consumed(frames)`, which sets `samplepos`.
- Capture is switched by an export `q2l_audio_capture(int on)` (on: resets `taken` to
  `s_paintedtime`, so pre-capture audio is dropped); while on, `q2l_step` (from [[285]]'s patch)
  calls the driver's step hook before `CL_Frame`, matching concept §10.1's "the step advances
  `samplepos`".
- The capture harness requests `maxFrames = 4096` (more than `48·17 = 816`) and also fails when
  every captured sample is zero, because a `take` that echoes the request or returns silence would
  otherwise pass the count and hash checks.
- Transport: the `MessagePort` path with 1024-frame blocks is mandatory (it works without
  cross-origin isolation, which the launcher does not have today); the `SharedArrayBuffer` path is
  measured too when serving the spike page with COOP/COEP makes `crossOriginIsolated` true, so
  `RESULT.md` can recommend one to [[293]] on numbers.
- Autoplay: the harness sets the Chromium switch `--autoplay-policy=no-user-gesture-required`
  instead of editing the copied `webPreferences`, because production ([[293]]) starts the
  `AudioContext` on the user's play click and the copy must stay faithful.
- Real-time mode drives the engine with [[284]]'s own main loop, not `q2l_step`, because that is
  the playback path [[293]] builds on.
- `latencyMs` engine → output = mean of `(paintedFrames − consumedFrames) / 48` plus
  `(baseLatency + outputLatency)·1000` of the `AudioContext`, because it is the only end-to-end
  figure the harness can observe without a microphone loop.
- The harness reuses the Electron frame of [[284]]/[[285]] by import, never by a third copy: if
  [[285]] copied [[284]]'s frame, D2 first extracts it to `spikes/lib/engine-window.mjs`.
- Driver ring: `dma.samples = 0x8000 · channels`, `submission_chunk = 1`, S16LE stereo,
  `dma.speed = 48000` for `s_khz 48`, modelled on `sdl.c` — `submission_chunk 1` keeps
  `Q_ALIGN(endtime, …)` in `DMA_Update` from rounding a step's count.

## Plan

Spike, no `src/` change, no CHANGELOG entry (nothing user-visible), no systems doc. Runs after
[[284]] and [[285]] (it needs their Electron frame and `q2l_step`).

1. **Engine patch** (D1): `engine/patches/NNNN-snddma-web.patch` (next free number after
   [[285]]'s patch) — `src/unix/sound/web.c` (`snddma_web`, ring, `q2l_audio_take`,
   `q2l_audio_consumed`, `q2l_audio_capture`, step hook), `s_drivers[]` entry under
   `#ifdef __EMSCRIPTEN__` in `dma.c`, `web.c` in the meson web branch, the three exports in
   `-sEXPORTED_FUNCTIONS`, and the hook call in `q2l_step`.
2. **Capture harness** (D2): `spikes/286-dma-audio-pull/harness.mjs --mode=capture` — boot check
   (AC2), 600 steps at 17/17/16 ms with counts, two seeded runs with PCM SHA-256.
3. **Real-time harness** (D3): `--mode=realtime --seconds=60` — AudioWorklet, port (and SAB if
   isolated) transport, `realtime.json`.
4. **RESULT.md** (D4): interface, patches, measurements, open points for [[293]]/[[305]],
   `git status --short src/` empty.

## Deliverables

- **D1 — The `snddma_web` driver and audio exports as an engine patch.** Write
  `engine/patches/NNNN-snddma-web.patch` (NNNN = next free number after the `q2l_step` patch of
  story 285; patches apply in order, so it may touch that patch's `src/unix/q2l_step.c`). Engine
  source is the MashedD fork; read `vendor/q2pro-mashed/src/unix/sound/sdl.c` (driver model,
  `Filler`), `src/client/sound/dma.c` (`s_drivers[]` ~l.531, `DMA_Init`, `DMA_GetTime`,
  `DMA_Update` — mixahead clamp while `!cls.active`, `Q_ALIGN` on `submission_chunk`),
  `inc/client/sound/dma.h` (`dma_t`, `snddma_driver_t`). Content:
  - new `src/unix/sound/web.c`: `const snddma_driver_t snddma_web = { .name = "web", … }`; init
    prints a console line naming the driver, allocates the ring (`dma.samples = 0x8000·2`,
    `channels 2`, `samplebits 16`, `submission_chunk 1`, `speed = s_khz 48 → 48000`,
    `samplepos 0`); `begin_painting`/`submit` are no-ops.
  - `EMSCRIPTEN_KEEPALIVE int q2l_audio_take(int16_t *dst, int maxFrames)`: copies stereo frames
    `[taken, s_paintedtime)` (capped at `maxFrames`) out of the ring, handling wrap
    (`pos = taken mod (dma.samples/2)`), advances `taken`, returns the count.
  - `EMSCRIPTEN_KEEPALIVE void q2l_audio_consumed(int frames)` (real time): sets `samplepos` to
    `(frames·2) mod dma.samples`.
  - `EMSCRIPTEN_KEEPALIVE void q2l_audio_capture(int on)`: capture flag; on → `taken =
    s_paintedtime`. While on, a hook `snddma_web_step(int ms)` advances `samplepos` by
    `48·ms·2` mono samples (with wrap); `q2l_step` calls it before `CL_Frame`.
  - `dma.c`: `extern const snddma_driver_t snddma_web;` and `&snddma_web` in `s_drivers[]` under
    `#ifdef __EMSCRIPTEN__`.
  - `meson.build` web branch: `src/unix/sound/web.c` in the `software-sound` sources;
    `_q2l_audio_take,_q2l_audio_consumed,_q2l_audio_capture` added to `-sEXPORTED_FUNCTIONS`.
  - Acceptance: `npm run engine:build` exits 0 and the three names appear in the built
    `resources/engine/q2pro.wasm` exports (`wasm-objdump -x`, or the [[281]] symbol-check script).
- **D2 — Capture harness with boot check, counts and PCM hashes.** `spikes/286-dma-audio-pull/
  harness.mjs` (plus `README.md`), results under `spikes/286-dma-audio-pull/results/`. Reuse the
  Electron frame (window with copied `webPreferences`, spike scheme, game data + test demo of
  story 283) by importing it from `spikes/285-deterministic-step/` or
  `spikes/284-demo-frame-in-electron/`; if 285's harness is a copy of 284's, first extract the
  frame to `spikes/lib/engine-window.mjs` and make 284/285 import it — no third copy. Engine args
  add `+set s_enable 1 +set s_driver web +set s_khz 48 +set s_mixahead 0`.
  - Boot check (every mode): the console log contains the driver's init line and no sound error,
    and `s_enable` reads `1` after start; otherwise exit 1. Recorded as `driver`, `sEnable` in the
    result JSON.
  - `--mode=capture --frames=600 --fps=60`: seed via [[285]]'s setup, `q2l_audio_capture(1)`,
    then per step `q2l_step(ms)` with the cadence 17/17/16 and `q2l_audio_take(buf, 4096)`;
    expected `48·ms`. Writes `results/counts.json` `{ steps, expected[], got[], mismatches,
    nonZeroSamples }`; exit 0 only when `mismatches === 0` and `nonZeroSamples > 0`.
  - `--runs=2 --seed=1`: two capture runs (engine re-initialised as in 285), SHA-256 over the
    concatenated PCM per run → `results/pcm-hashes.json` `{ runs: [hash, hash], equal }`; exit 0
    only when equal. Also writes `results/capture-run1.wav` for listening.
- **D3 — Real-time mode with an AudioWorklet.** `spikes/286-dma-audio-pull/worklet.js` and the
  real-time branch of `harness.mjs`. Harness adds the switch
  `--autoplay-policy=no-user-gesture-required`; `webPreferences` stay the copy. The engine runs on
  284's own main loop; a JS pump (each animation frame) calls `q2l_audio_take` into a JS ring and
  sends 1024-frame blocks to the worklet (`--transport=port`, default); the worklet reports
  consumed frames, which the pump passes to `q2l_audio_consumed`. `--transport=sab`: ring + counters
  in a `SharedArrayBuffer`, available only when the spike scheme serves the page with
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` and
  `crossOriginIsolated` is true — otherwise it exits 1 naming the reason. `--mode=realtime
  --seconds=60` writes `results/realtime.json` `{ transport, seconds, underruns,
  underrunsPerMinute, latencyMs, nonSilentBlocks, crossOriginIsolated }` (underrun = the worklet
  rendered a quantum with fewer frames than needed; `latencyMs` per the Decisions); exit 0 when
  `nonSilentBlocks > 0`.
- **D4 — `RESULT.md`.** `spikes/286-dma-audio-pull/RESULT.md`: the interface (`q2l_audio_take`,
  `q2l_audio_consumed`, `q2l_audio_capture`, the worklet ring and its transport), the patches
  needed (file + purpose), the measurements from `counts.json`, `pcm-hashes.json` and
  `realtime.json` for each transport tried, whether R6 holds, and open points for [[293]]
  (transport choice, COOP/COEP, autoplay, latency) and [[305]] (timestamps, `timescale ≠ 1`).
  Finish with `git status --short src/` empty.

## Model Hints

- D1 → deliverable-hard: C inside the engine's mixer across three patched files — `samplepos` is
  in mono samples while steps count stereo frames, the ring wraps, and `DMA_Update`'s mixahead
  clamp and `Q_ALIGN` interact with [[285]]'s `q2l_step`; any slip yields plausible but wrong
  per-step counts and costs the whole spike.

Review: → default

## Acceptance Tests

- AC1 → build command `npm run engine:build` exits 0 and the export check over
  `resources/engine/q2pro.wasm` lists `q2l_audio_take`, `q2l_audio_consumed`,
  `q2l_audio_capture` (D1).
- AC2 → harness `spikes/286-dma-audio-pull/harness.mjs` › boot check "the web driver starts and
  s_enable reads 1", run as part of `--mode=capture --frames=600 --fps=60` (D2).
- AC3 → harness `node spikes/286-dma-audio-pull/harness.mjs --mode=capture --frames=600 --fps=60`
  exits 0, `results/counts.json` `mismatches: 0`, `nonZeroSamples > 0` (D2).
- AC4 → harness `node spikes/286-dma-audio-pull/harness.mjs --mode=capture --runs=2 --seed=1`
  exits 0, `results/pcm-hashes.json` `equal: true` (D2).
- AC5 → harness `node spikes/286-dma-audio-pull/harness.mjs --mode=realtime --seconds=60` exits 0
  and writes `results/realtime.json` with `underrunsPerMinute`, `latencyMs`,
  `nonSilentBlocks > 0` (D3). Manual residue: listening — sound in sync with the picture, no clicks
  or dropouts — needs human hearing; no automated check judges perceived sync or clicks.
- AC6 → document check: `spikes/286-dma-audio-pull/RESULT.md` has the sections interface,
  patches, measurements, open points for 293 and 305 (D4, checked by the story review).
- AC7 → command `git status --short src/` prints nothing (D4).

## Done
