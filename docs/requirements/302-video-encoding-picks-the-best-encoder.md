---
id: 302
title: Video encoding picks the best available encoder
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

An export automatically uses the best H.264 encoder my system has and writes the video frame by
frame into an MP4. It works without settings and the file plays everywhere.

Context:

- [concept §10](../concepts/integrated-demo-player.md) (sequence diagram),
  [concept §10.4](../concepts/integrated-demo-player.md) (encoder tiers),
  [concept §10.5](../concepts/integrated-demo-player.md) (streaming to disk).
  - Linux uses `prefer-software` because of Electron #55456.
  - OpenH264 offers only Baseline.
- Spike result: `spikes/282-webcodecs-matrix/RESULT.md` (Windows/Linux matrix, `VideoFrame(canvas)` without
  `preserveDrawingBuffer`, Mediabunny test file).
- Mediabunny (MPL-2.0): `Output`, `Mp4OutputFormat`, `StreamTarget`, `VideoSampleSource`,
  `VideoSample`, `canEncodeVideo`, `getFirstEncodableVideoCodec`.
- Step mode: `EngineCapture` from [[300]]. Export sink from [[299]]
  (`exportOpen`/`Write`/`Finish`/`Abort`).
- Constraints:
  - Add `mediabunny` at a pinned version. `npm audit` must stay clean, because pr-unit blocks on
    the audit.
  - Files in the replays module: `export/encoder-choice.ts` (pure, testable),
    `export/export-controller.ts`, `export/sink-stream.ts` (a `WritableStream` that calls
    `exportWrite`).
  - The probe tries `VideoEncoder.isConfigSupported` for `avc1.640028` (High), `avc1.4d0028`
    (Main) and `avc1.42e028` (Baseline) with the export's width, height and fps; Mediabunny's
    `canEncodeVideo` is the cross-check.
  - The bitrate is fixed for now (1080p60: 16 Mbit/s); presets come with [[308]].
  - The flow's fake engine draws the frame number and colour bars deterministically, without
    game data.
  - Per `/test-gates`, the flow uses real WebCodecs. It belongs in pr-ui only if it runs stably
    within the time limit; otherwise it goes in a tier outside smoke.
- Not in scope: sound ([[305]], [[306]]), UI options ([[303]], [[308]]), ffmpeg ([[313]]).
- Expected manual residue: export a 30-s demo with the real engine and open the MP4 in VLC and the
  Windows player. Check picture quality, absence of artefacts and the correct length.
- Depends on: [[282]], [[300]], [[299]].

## Acceptance Criteria

- [ ] **AC1** — When the probe reports High unsupported and Main supported,
      `chooseVideoEncoder(probe, platform)` picks `avc` with the Main profile codec string.
- [ ] **AC2** — On `linux`, `chooseVideoEncoder` always sets `hardwareAcceleration` to
      `'prefer-software'` (table-driven unit test over all cases).
- [ ] **AC3** — With no H.264 profile supported, `chooseVideoEncoder` returns
      `{ tier: 'unavailable', reasonKey: 'replays.export.unavailable.noH264' }`.
- [ ] **AC4** — Exporting 90 frames at 30 fps from the fake engine with real Mediabunny and
      WebCodecs in the UI harness produces an MP4 under `.ui-verify/`: flow
      `replays-integrated-export`.
- [ ] **AC5** — That MP4, read back with Mediabunny `Input`, has 90 video packets.
- [ ] **AC6** — That MP4 lasts 3.0 s ± 1 frame.
- [ ] **AC7** — That MP4's timestamps are strictly monotonic at `i/30`.
- [ ] **AC8** — While `await source.add(sample)` is pending (backpressure), the controller calls no
      further `step` (unit test with fake encoder and target).
- [ ] **AC9** — At most 4 `export.write` calls are in flight at once.
- [ ] **AC10** — Each `VideoFrame` is created in the same task as its `q2l_step`, with no `await`
      in between.
- [ ] **AC11** — Each `VideoFrame` is closed after `add`; the unit test counts zero open frames at
      the end.
- [ ] **AC12** — Unless configured otherwise, the export uses `fastStart: false` (moov at the end,
      written back through the sink at its position). The choice is justified in the concept.
- [ ] **AC13** — `npm audit --omit=dev` reports no new findings of moderate or higher.
- [ ] **AC14** — The flow is registered in `scripts/flows/areas.json`.
- [ ] **AC15** — The new dependency and its licence are noted for the third-party list ([[317]]).

## Open Questions

1. Fast start: keep `fastStart: false` as the default, or use `'fragmented'` so a crashed export
   still leaves a readable file?

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
