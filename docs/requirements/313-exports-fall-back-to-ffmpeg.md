---
id: 313
title: Exports fall back to ffmpeg when WebCodecs cannot encode
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user on a system without H.264 encoding through WebCodecs I still want to export an MP4, so
that the export does not fail because of my platform or driver.

Context:

- **Decision 4 stands:** the fallback through a bundled ffmpeg (Node) is set.
  [concept §10.4](../concepts/integrated-demo-player.md) ranks it as **tier 3**, behind WebCodecs
  H.264 (tier 1) and the AAC polyfill (tier 2).
- **Scope depends on the matrix from [[282]]** (`spikes/282-webcodecs-matrix/RESULT.md`). If that shows tier 1 or
  2 on Windows and Linux, this story drops to P3 (open question F9); the sprint review decides
  before it starts.
- **Bandwidth (concept §10.4):** a raw 1080p RGBA frame is 8.3 MB, ≈ 500 MB/s over IPC at 60 fps.
  Variants:
  - A: WebCodecs encodes an intermediate (VP9 in software, assumption) that ffmpeg transcodes to
    H.264.
  - B: raw frames at reduced export speed, possibly I420 (3.1 MB per frame).
  - C: no ffmpeg — an MP4 with VP9/Opus.
- **Licence:** L5 (LGPL vs GPL build, libx264 is GPL) and L6 (patents) in
  [concept §12](../concepts/integrated-demo-player.md) await legal clarification. **Ships only
  behind a developer flag until they are cleared.**
- Model for a fetched binary: `scripts/fetch-7za.mjs` with `extraResources` in
  `electron-builder.yml` (`resources/bin`) and `src/main/lib/resource-path.ts`.
- Export sink (handle, positioned writes) from [[299]]; per-frame audio PCM from [[305]].
- Constraints:
  - Main `src/main/modules/replays/export-ffmpeg.ts` starts `ffmpeg` with `spawn` and a fixed
    argument array — no shell string, no renderer values in arguments except validated numbers.
    Input on `stdin` (variant A: IVF/WebM packets, B: `rawvideo`), audio through a second pipe or
    a temp WAV, output into the export handle's file.
  - Contract-first IPC in `src/shared/modules/replays.ts`: `exportFfmpegOpen`, `exportFfmpegPush`
    (bytes as `Uint8Array`, backpressure through the reply promise), `exportFfmpegFinish`,
    `exportFfmpegAbort`.
  - Renderer: `ExportController` gets a third sink `FfmpegSink`; tier selection stays in
    `encoder-selection.ts` ([[306]]); progress reports `encoder: 'ffmpeg'` (concept §10.6).
  - A running ffmpeg export is cancelled in the existing `before-quit` path
    (`src/main/shutdown.ts`).
  - The binary exists for Windows and Linux; when it is missing, the tier is visibly disabled with
    its reason.
- Not in scope: shipping in release builds while L5/L6 are open (`electron-builder.yml` changes
  only in [[316]] / [[317]] after clearance); live recording ([[314]]); other containers or codecs.
- Depends on: [[299]], [[305]].

Expected manual residue: playing an ffmpeg MP4 in the Windows player and in VLC.

## Acceptance Criteria

- [ ] **AC1** — Before implementation starts, `spikes/313-ffmpeg-variant/RESULT.md` records the
      chosen variant (A, B or C) with measured throughput (frames/s at 1080p60 and 720p30) and the
      reason; without this file the build does not start.
- [ ] **AC2** — With `Q2L_EXPORT_FFMPEG=1` and `Q2L_EXPORT_FORCE_TIER=ffmpeg`, an export produces
      an MP4 that Mediabunny `Input` reads as `avc` video and `aac` audio
      (`npm run test:engine -- --only=export-ffmpeg`).
- [ ] **AC3** — The duration of that MP4 differs from the range by ≤ 1 frame.
- [ ] **AC4** — Without the flag, when the probe would need tier 3, the dialog does not offer it
      and shows the reason `replays.export.unavailable.noVideoEncoder` as visible text
      (`npm run ui:flow -- replays-export-ffmpeg-unavailable`).
- [ ] **AC5** — Without the flag, no ffmpeg process starts.
- [ ] **AC6** — Cancelling a running ffmpeg export closes `stdin`, terminates the child after a
      timeout, deletes the partial file and leaves no ffmpeg process in the process list.
- [ ] **AC7** — Frame and packet data reaching main over IPC is validated by zod (handle, size,
      sequence number); a packet without an open export handle is refused, and the renderer never
      passes a path (`npx vitest run src/main/modules/replays/export-ffmpeg.test.ts`, which also
      pins the fixed argument array).
- [ ] **AC8** — `npx vitest run src/renderer/src/modules/replays/export/encoder-selection.test.ts`
      covers tier 3 with and without the flag.
- [ ] **AC9** — `npm run fetch:ffmpeg` downloads a pinned ffmpeg build into `resources/bin/`
      (gitignored like `7za`), checks its SHA-256 and documents which licence variant the build is.
- [ ] **AC10** — A test fails while `electron-builder.yml` contains an ffmpeg filter and the
      clearance mechanism from [[317]] has not cleared L5.
- [ ] **AC11** — The flag is documented in the export section of
      `docs/systems/replays-module.md`.

## Open Questions

- Which variant (A, B or C), once the [[282]] matrix and the throughput measurement are in?
- Is this story still needed (F9), or does it drop to P3?
- L5/L6: legal clarification (not legal advice) — LGPL or GPL build, patent licences for software
  encoding. Who clears them, and by when?

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
