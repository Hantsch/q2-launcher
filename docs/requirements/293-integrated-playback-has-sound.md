---
id: 293
title: Integrated playback has sound
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user in integrated mode I want to hear the demo's sound and set the volume as usual, so that
playback feels no worse than in engine mode.

Context:

- [concept §8.4](../concepts/integrated-demo-player.md) (audio). Spike result and patch: `spikes/286-dma-audio-pull/RESULT.md`, driver
  `snddma_web`.
- Volume today: `src/renderer/src/modules/replays/components/VolumeControl.tsx`, main side
  `src/main/modules/replays/playback-volume.ts`; persisted level `demoVolume` in
  `src/main/modules/replays/persisted.ts` (starts at 70). `/renderer-guidelines`.
- Worklet module as a file in the renderer bundle (`integrated/audio-worklet.ts`, a Vite asset
  URL); whether the `'self'` CSP covers worklets is checked by a test. Ring-buffer protocol from
  the spike (MessagePort blocks without `SharedArrayBuffer`). The `AudioContext` is created on the
  first Play click (user gesture), not at page load.
- Volume persistence: either the existing `demoVolume` path with a mode distinction or a new
  narrow contract-first handler `playbackVolume.remember`.
- Not in scope: audio capture for export ([[305]]), moving `VolumeControl` onto the `DemoPlayer`
  API ([[297]]).
- Depends on: [[286]], [[291]]

Expected manual residue: with the real engine and a retail demo, sound is in sync with the
picture, no clicks, volume and mute work, the level survives a restart.

## Acceptance Criteria

- [ ] **AC1** — During integrated playback, the demo's sounds play through an AudioWorklet on the
      default output (engine started with `s_driver web`, `s_khz 48`).
- [ ] **AC2** — A level or mute change in `VolumeControl` takes effect within the next audio
      block.
- [ ] **AC3** — The level starts at the stored `demoVolume` (else 70), as in engine mode, and is
      stored at session end.
- [ ] **AC4** — While paused the sound is silent (the last buffer does not loop) and resumes with
      playback.
- [ ] **AC5** — Stop or leaving the view suspends or closes the `AudioContext`, and no worklet
      stays active (unit test with a fake `AudioContext`).
- [ ] **AC6** — In a 10 s fake-engine run of `npm run ui:flow -- replays-play-integrated`, the
      worklet's underrun counter (read through a test hook) shows at most 1 underrun per minute.
- [ ] **AC7** — `npm run ui:flow -- replays-volume` stays green (engine mode unchanged).

## Open Questions

- Is the integrated volume persisted through the existing `playbackVolume`/`demoVolume` path with
  a mode distinction, or through a new `playbackVolume.remember` handler?

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
