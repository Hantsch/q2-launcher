---
id: 286
title: 'Spike: audio is pulled from the DMA mixer per step'
status: draft # draft -> ready -> in-progress -> done
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

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
