---
id: 305
title: Audio is captured per step
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

After each engine step, the export gets exactly the audio samples that belong to that time slice.
The sound in the video is then gapless and in sync with the picture.

Context:

- [concept §8.4](../concepts/integrated-demo-player.md): own driver `snddma_web`, capture
  operation, `s_khz 48` → 48 samples per ms, `s_mixahead 0`, `cls.active`, one refresh per step.
- [concept §10.1](../concepts/integrated-demo-player.md): audio timestamps follow engine time.
- Spike result: `spikes/286-dma-audio-pull/RESULT.md` (driver prototype, measurements).
- Engine code: `src/client/sound/dma.c` (`DMA_Update`, `s_drivers[]`),
  `inc/client/sound/dma.h` (`dma_t`), `src/client/sound/main.c` (`S_Update`).
- The driver's real-time operation is [[293]], the step mode [[300]], the export controller
  [[302]].
- Constraints:
  - Engine patch: a capture branch in `snddma_web` (`begin_painting`/`submit` without a callback).
    `q2l_step` advances `dma.samplepos` by `48·ms`. After `S_Update`, the newly painted samples
    are copied into a linear capture buffer.
  - `q2l_capture_begin` sets `s_khz 48` and `s_mixahead 0`, and saves and restores both.
  - JS reads through `HEAP16` into a reused `Int16Array` and copies for the `AudioSample`.
  - Until [[306]] there is no audio track in the MP4. A developer switch `--dump-wav` writes a
    debug WAV for checking.
- Not in scope: encoding and fallback ([[306]]), the sync check ([[307]]), the UI option
  ([[308]]).
- Expected manual residue: listen to the debug WAV. Is it gapless, free of clicks, with audible
  shots?
- Depends on: [[286]], [[300]].

## Acceptance Criteria

- [ ] **AC1** — During capture, `q2l_step(17)` makes `q2l_audio_take` return exactly 816 stereo
      frames (17 × 48), and `q2l_step(16)` exactly 768.
- [ ] **AC2** — Over 300 steps of the 60 fps cadence, the captured frames total 48 × the sum of the
      step milliseconds: `npm run test:engine -- --only audio-capture` checks AC1 and AC2.
- [ ] **AC3** — The pure function `audioFramesForStep(ms, sampleRate)` in `src/shared/replays/`
      returns the integer `48·ms` at 48 000 Hz.
- [ ] **AC4** — `audioFramesForStep` throws for any rate other than 48 kHz.
- [ ] **AC5** — During capture, the controller turns the samples into a Mediabunny `AudioSample`
      (`s16`, 2 channels, 48 kHz) whose timestamp is the cumulative engine ms × 1000 µs.
- [ ] **AC6** — Over 60 steps with the fake engine, the audio timestamps have no gaps.
- [ ] **AC7** — Calling `q2l_audio_take` with a buffer that is too small returns only what fits. A
      second call returns the rest, and nothing is lost.
- [ ] **AC8** — While a capture runs, the real-time output (the AudioWorklet from [[293]]) is
      silent or detached; only the controller drains the capture buffer.
- [ ] **AC9** — With the sound option "off", the controller never calls `q2l_audio_take`, and no
      audio track is created.
- [ ] **AC10** — `npm run engine:smoke -- --capture 1280x720 --frames 300 --dump-wav` writes a
      5.0 s WAV to `.engine-test/`.
- [ ] **AC11** — The patch is in `engine/patches/`; concept §8.4 is updated where findings differ.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
