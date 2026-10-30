---
id: 306
title: Exports have AAC sound with a fallback chain
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

My exported video has AAC sound whether or not my system can encode AAC through WebCodecs, so the
MP4 plays with sound everywhere, Linux included.

Background:

- WebCodecs AAC exists in Chromium only on Windows (Media Foundation) and macOS. It is missing on
  desktop Linux and on Windows N editions
  ([MDN Codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection)).
- `@mediabunny/aac-encoder` registers itself as a custom encoder through `registerAacEncoder()`,
  and `canEncodeAudio('aac')` takes registered encoders into account
  ([Mediabunny codecs](https://mediabunny.dev/guide/supported-formats-and-codecs)).

Context:

- [concept §10.4](../concepts/integrated-demo-player.md) (tiers 1–3),
  [concept §12](../concepts/integrated-demo-player.md) (licence points L4/L6, for legal
  clarification, no legal advice), risk R4 in [concept §11](../concepts/integrated-demo-player.md).
- Prior work: samples per frame from [[305]] (`q2l_audio_take`, 48 kHz S16 stereo); probe and
  video pipeline from [[302]] (`ExportController`); the matrix from [[282]]
  (`spikes/282-webcodecs-matrix/RESULT.md`).
- Constraints:
  - Selection is a pure function `selectAudioTier(probe: AudioProbe, flags): AudioTier | Refusal`
    in `src/renderer/src/modules/replays/export/encoder-selection.ts`.
  - The polyfill is loaded with a dynamic `import('@mediabunny/aac-encoder')` only when tier 1 is
    missing, so it costs nothing on Windows. Its WASM part has to run under the CSP from [[288]]
    (`'wasm-unsafe-eval'`).
  - `AudioSampleSource({ codec: 'aac', bitrate })` takes [[305]]'s samples unchanged.
  - The default bitrate is 192 kbit/s. Media Foundation accepts only certain bitrates, so the
    allowed values are {96, 128, 160, 192} kbit/s and the probe checks them too.
  - **Shipping** tier 2 in release builds waits for the clarification of L4 ([[317]]). Until then
    it sits behind `Q2L_EXPORT_AAC_POLYFILL=1` or a build flag; code and tests are complete
    anyway.
- Not in scope: the ffmpeg path ([[313]]; it only appears here as tier 3), A/V sync measurement
  ([[307]]), bitrate UI ([[308]]), any change to the video encoder.
- Expected manual residue: on a real Linux desktop, export a demo with sound and listen to the MP4
  in VLC.
- Depends on: [[305]], [[302]].

## Acceptance Criteria

- [ ] **AC1** — When `AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 })` reports `supported: true`, an export with sound uses tier 1 and its
      progress reports `audioEncoder: 'webcodecs'`.
- [ ] **AC2** — Without WebCodecs AAC, an export with sound calls `registerAacEncoder()` exactly
      once per renderer session.
- [ ] **AC3** — In that case it uses tier 2, and the progress reports `audioEncoder: 'polyfill'`.
- [ ] **AC4** — With neither WebCodecs AAC nor the polyfill available, the probe returns tier 3
      (`ffmpeg`) when [[313]] is enabled by its flag.
- [ ] **AC5** — Without the [[313]] flag in that case, it refuses with
      `replays.export.error.noAudioEncoder`, and the dialog's "Sound" option is visibly disabled
      with that text as the reason.
- [ ] **AC6** — With `Q2L_EXPORT_FORCE_AUDIO_TIER=polyfill` (read only in dev and test builds) on a
      system with WebCodecs AAC, the exported MP4's audio track reads back through Mediabunny
      `Input` as `aac`, 48 kHz, 2 channels: flow `replays-export-audio-polyfill`.
- [ ] **AC7** — For two exports of the same demo, one per tier, the two audio durations differ by
      at most one AAC frame (1024 samples).
- [ ] **AC8** — In each of those exports, the audio duration differs from the video duration by at
      most one AAC frame (`npm run test:engine -- --only=aac-tiers`).
- [ ] **AC9** — On a Linux host, the export dialog opens without an error.
- [ ] **AC10** — On a Linux host, an export with sound runs through tier 2 (platform parity: no
      silently missing feature).
- [ ] **AC11** — `npx vitest run src/renderer/src/modules/replays/export/encoder-selection.test.ts`
      covers tier 1, tier 2, no tier (refusal with key) and a forced tier.
- [ ] **AC12** — Release builds ship tier 2 only behind the flag until L4 is cleared.
- [ ] **AC13** — The new i18n keys are in the module's `locale/en.json`.

## Open Questions

1. Licence point L4: may the FFmpeg-based `@mediabunny/aac-encoder` (LGPL parts, statically built
   WASM) ship in the launcher? For legal clarification in [[317]]. This is no legal advice.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
