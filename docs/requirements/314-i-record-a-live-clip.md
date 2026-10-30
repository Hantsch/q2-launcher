---
id: 314
title: I record a live clip of the playback
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user I want to record what I see and hear during playback with one click, so that I can keep
a spontaneous moment without going through the export dialog.

Context:

- [concept §10.4](../concepts/integrated-demo-player.md), the row "live clip (MediaRecorder)":
  optional and independent of the deterministic export.
- Live sound runs through an AudioWorklet ([[293]]); a `MediaStreamAudioDestinationNode` gives
  the audio track. The picture is `canvas.captureStream(fps)` of the engine canvas ([[290]]).
- Writing to disk goes through the export sink ([[299]]: save dialog, handle, positioned writes).
- MediaRecorder in Chromium can produce `video/mp4;codecs=avc1,mp4a.40.2` (assumption: check with
  `MediaRecorder.isTypeSupported` in Electron 43); the fallback is `video/webm;codecs=vp9,opus`.
- Constraints: `ClipRecorder` in `src/renderer/src/modules/replays/export/clip-recorder.ts` takes
  the canvas stream (30 fps) and the audio stream and holds the `ondataavailable` chunks
  (1 s timeslice). They go through `export.write` once a handle exists, until then into a bounded
  memory buffer (proposal: at most 10 minutes or 1 GB, then an automatic stop with a notice —
  asking for the handle before recording is worse ergonomically). No new IPC channel if
  `export.open/write/finish/abort` from [[299]] is generic; otherwise add one contract-first.
- Not in scope: a "last N seconds" ring buffer; an engine-mode clip (that would need screen
  capture); editing.
- The `CHANGELOG.md` line is one line under `## Unreleased`, or folded into the export entry.
- Depends on: [[293]], [[299]].

Expected manual residue: recording a clip of a real demo — smooth, sound in sync enough for live?

## Acceptance Criteria

- [ ] **AC1** — In integrated mode with a demo playing, pressing "Clip" starts a recording.
- [ ] **AC2** — While recording, the button shows the recording state and the running duration as
      visible text, not only as colour.
- [ ] **AC3** — Pressing again opens the save dialog with a suggested name.
- [ ] **AC4** — After confirming, the file read with Mediabunny `Input` has one video and one
      audio track, and its duration is within ± 0.5 s of the recording time
      (`npm run ui:flow -- replays-clip-record`, fake engine, 3 s recording).
- [ ] **AC5** — When `MediaRecorder.isTypeSupported` refuses MP4, the recording is WebM
      (VP9/Opus), the save dialog suggests `.webm`, and no error is shown.
- [ ] **AC6** — A recording ends cleanly and the save dialog follows when the demo ends, playback
      is stopped or the mode switches.
- [ ] **AC7** — Cancelling the save dialog leaves no file behind.
- [ ] **AC8** — In engine mode "Clip" is visibly disabled with the text "Clip recording is only
      available in integrated mode." (`replays.player.unavailable.clipEngineMode`;
      `npm run ui:flow -- replays-clip-engine-mode`).
- [ ] **AC9** — `npx vitest run src/renderer/src/modules/replays/export/clip-recorder.test.ts`
      covers the MIME choice with the WebM fallback, the buffer limit and the stop at demo end.

## Open Questions

- Buffer limit before the save dialog: 10 minutes / 1 GB, or other numbers?

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
