---
id: 308
title: I choose export options
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user I want to choose HUD, sound, quality, speed and file name when I export, so that I get
a video that fits its purpose: a highlight clip without HUD, a small video to share, slow motion.

Context:

- Step mode and speed in [concept §10.1](../concepts/integrated-demo-player.md), `HudOptions` in
  [concept §9.1](../concepts/integrated-demo-player.md), open question F7 (defaults) in the
  concept's open points.
- Extends the export dialog from [[303]] (range, resolution, fps, progress, cancel).
- Demo name templates already exist (`src/shared/replays/name-template.ts`,
  `src/main/modules/replays/name-templates.ts`); the export file name template uses the same
  placeholder mechanism.
- Persistence goes through the `replays` slot (`src/main/modules/replays/persisted.ts`,
  forgiving parse), through a new handler pair `exportOptionsRead/Write` written contract-first in
  `src/shared/modules/replays.ts`.
- Constraints: `ExportOptions` (zod) in `src/shared/replays/export-options.ts`:
  `{ hud: 'asPlayback' | 'off' | 'noStatusbar', audio: boolean, preset: 'small' | 'standard' | 'high', speed: 0.5 | 1 | 2, nameTemplate: string }`,
  defaults `asPlayback` / `true` / `standard` / `1` (an assumption until F7 is answered). Proposed
  presets for H.264 1080p60: small 4 Mbit/s + 128 kbit/s, standard 12 + 192, high 24 + 192,
  scaled for 720p. HUD and speed are set by `ExportController` through the bridge before
  `q2l_capture_begin` and reset at `q2l_capture_end` — no lasting cvar change.
- Not in scope: POV choice (MVD2, [[319]]), free bitrate input, containers other than MP4, the
  playback HUD options themselves ([[310]]).
- The `CHANGELOG.md` line is folded into the existing export entry, not a new one.
- Depends on: [[303]].

Expected manual residue: comparing the presets visually (artefacts at "small").

## Acceptance Criteria

- [ ] **AC1** — With "HUD" set to off in the export dialog, the export renders with
      `scr_draw2d 0`, and a golden frame of the test demo shows no HUD pixel area
      (`npm run test:engine -- --only=export-options`).
- [ ] **AC2** — After an export with HUD off, the playback HUD setting is unchanged.
- [ ] **AC3** — With "Sound" off, the MP4 has no audio track (Mediabunny `Input`:
      `getAudioTracks()` is empty) and audio capture does not run.
- [ ] **AC4** — The presets {small, standard, high} use exactly their fixed video and audio
      bitrates (unit test of the preset table in `src/shared/replays/export-options.test.ts`).
- [ ] **AC5** — A preset the encoder probe rejects is visibly disabled, with its reason as text.
- [ ] **AC6** — At speed 0.5× or 2× the video duration is the range duration ÷ speed (± 1 frame)
      and the engine runs with `timescale` set to that value.
- [ ] **AC7** — A file name template such as `{demo}_{from}-{to}_{res}` resolves to the name
      suggested in the save dialog, with no path separators or illegal characters, ending in
      `.mp4` (unit test).
- [ ] **AC8** — Options chosen once are pre-filled the next time the dialog opens, also after a
      restart (`npm run ui:flow -- replays-export-options`).
- [ ] **AC9** — An unreadable stored `exportOptions` value falls back to the defaults (unit test
      in `src/main/modules/replays/persisted.test.ts`).

## Open Questions

- F7: which defaults — 1080p60 or 1080p30, HUD on or as in playback?
- Sound at speed ≠ 1: the engine mixes with shifted pitch (assumption). If slow motion sounds
  unusable, should sound be visibly disabled for speed ≠ 1?

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
