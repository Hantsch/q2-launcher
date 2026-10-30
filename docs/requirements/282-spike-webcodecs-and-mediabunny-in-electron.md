---
id: 282
title: 'Spike: what WebCodecs and Mediabunny can encode in Electron 43'
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want to know which video and audio encoders Electron 43 really
offers through WebCodecs on Windows and Linux, and whether a WebGL2 canvas can be grabbed as a
`VideoFrame` right after rendering, so that the export's encoder tiers rest on measurements rather
than assumptions.

Spike, timebox 1.5 days: delivers `spikes/282-webcodecs-matrix/RESULT.md` with measurements and a
recommendation, no production code.

Context:

- [concept §10.4](../concepts/integrated-demo-player.md) (encoder selection and fallback), [concept §10.5](../concepts/integrated-demo-player.md) (streaming), [concept §8.3](../concepts/integrated-demo-player.md)
  (`preserveDrawingBuffer`), risks R4 and R5.
- Electron 43.8.4 (`node_modules/electron/package.json`). External facts:
  [electron/electron#55456](https://github.com/electron/electron/issues/55456) (Linux VA-API crash),
  [MDN Codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection),
  [Mediabunny writing](https://mediabunny.dev/guide/writing-media-files).
- No engine needed: a WebGL2 canvas with an animated test pattern is enough. Harness
  `spikes/282-webcodecs-matrix/harness.mjs` + `probe.html` + `probe.js`; Mediabunny and
  `@mediabunny/aac-encoder` are installed only in the spike folder's own `package.json`.
- File writing goes through `StreamTarget` → a `WritableStream` → a preload bridge call →
  positioned `fs.writeSync` in main (a dry run for [[299]]). Read-back via Mediabunny
  `new Input({ source: new BufferSource(buf), formats: ALL_FORMATS })`.
- Linux run via act in the existing Linux container (cf. `ci:local:verify`) or a Linux desktop.
- Not in scope: the engine, production code, root `package.json` changes, export UI, encoder
  selection logic ([[302]]).
- Depends on: —

Expected manual residue: `results/sample-win32.mp4` plays smoothly in VLC and the Windows media
player, the sine tone is audible, no artefacts.

## Acceptance Criteria

- [ ] **AC1** — `cd spikes/282-webcodecs-matrix && npm install && node harness.mjs` exits 0 in a
      window with the launcher's `webPreferences` and writes `results/matrix-win32.json`.
- [ ] **AC2** — The matrix holds the `VideoEncoder.isConfigSupported()` result for every
      combination of codec (`avc1.640028`, `avc1.4d0028`, `avc1.42e01f`, `vp09.00.10.08`,
      `av01.0.04M.08`), resolution (1280×720, 1920×1080), frame rate (30, 60) and
      `hardwareAcceleration` (`no-preference`, `prefer-hardware`, `prefer-software`).
- [ ] **AC3** — The matrix holds `AudioEncoder.isConfigSupported` for AAC (`mp4a.40.2`, 48 kHz,
      stereo, 160 kbit/s) and for Opus.
- [ ] **AC4** — The matrix holds Mediabunny's `canEncodeAudio('aac')` before and after
      `registerAacEncoder()` from `@mediabunny/aac-encoder`.
- [ ] **AC5** — With `preserveDrawingBuffer: false`, a `new VideoFrame(canvas)` created in the
      same task right after drawing and read via `copyTo` contains test-pattern pixels; the result
      of a second attempt after an `await` (new task) is recorded too.
- [ ] **AC6** — With the first supported H.264 config, Mediabunny writes 10 s of test pattern at
      60 fps plus a 10 s sine tone via `StreamTarget` to `results/sample-win32.mp4`.
- [ ] **AC7** — `node spikes/282-webcodecs-matrix/verify-sample.mjs results/sample-win32.mp4`
      prints `frames=600 audio=10.00s` (± 1 frame) and exits 0.
- [ ] **AC8** — A Linux run (`harness.mjs --platform-label=linux`) writes
      `results/matrix-linux.json`; `RESULT.md` records whether `prefer-hardware` crashes the GPU
      process (#55456) and whether `prefer-software` avoids it.
- [ ] **AC9** — `RESULT.md` recommends an encoder tier (1/2/3 per concept §10.4) per platform and
      whether the ffmpeg fallback ([[313]]) stays P2 or becomes P3.
- [ ] **AC10** — `git diff --stat package.json package-lock.json` shows no change.

## Open Questions

- Does the ffmpeg fallback ([[313]]) stay P2 or drop to P3, given the measured matrix? (concept
  open point on ffmpeg)

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
