---
id: 303
title: I export a demo range as a video with progress and cancel
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

From the demo player I choose "Export video…", pick a range, a resolution and a frame rate, watch
the progress and can cancel at any time. In engine mode I see why export is not available there.

Context:

- [concept §10.3](../concepts/integrated-demo-player.md) (range export: seek, 500 ms pre-roll, end
  at `toMs` or `eof`), [concept §10.6](../concepts/integrated-demo-player.md) (progress and
  cancel), [concept §9.2](../concepts/integrated-demo-player.md) (export only in integrated mode,
  visible reason).
- Comment marks: `src/renderer/src/modules/replays/components/TimelineComments.tsx`,
  `src/shared/replays/demo-comments.ts`.
- UI kit: `src/renderer/src/components/ui/Modal.tsx`, `ProgressBar.tsx`, `RadioGroup.tsx`,
  `controls.tsx`.
- Controller from [[302]], sink from [[299]], resolution from [[301]].
- Constraints:
  - Components in the module: `export/ExportDialog.tsx` and `export/useExport.ts`. The states run
    idle → preparing → running → finishing → done | cancelled | failed.
  - A pure `resolveExportRange(selection, comments, durationMs)` lives in
    `src/shared/replays/export-config.ts`.
  - "Show in folder" uses a contract-first `export.reveal({ handle })` that stays valid for a
    while after `finish`; the renderer never sends a path.
  - Flow `scripts/flows/replays-integrated-export-dialog.mjs` uses the fake engine and
    `Q2L_UI_SAVE_FILE`.
  - The dialog follows `/renderer-guidelines` and `/design-tokens`: built on `Modal`, with a
    focus trap and a visible focus.
- Not in scope: sound options and bitrate or HUD presets ([[308]]); export in engine mode.
- Expected manual residue: with the real engine, export the range between two comments. Is it the
  right excerpt, does the progress look plausible, and does "Cancel" leave no file?
- Depends on: [[302]], [[297]].

## Acceptance Criteria

- [ ] **AC1** — In engine mode with a demo playing, "Export video…" is visible and disabled, with
      the text "Export is only available in integrated mode."
      (`replays.player.unavailable.exportEngineMode`) next to it.
- [ ] **AC2** — In integrated mode the dialog offers these range choices: whole demo, from the
      current position, between two comment marks, from–to.
- [ ] **AC3** — The dialog offers resolution (1080p, 720p), frame rate (60, 30) and aspect ratio
      (16:9, 4:3).
- [ ] **AC4** — The defaults are whole demo, 1080p60, 16:9.
- [ ] **AC5** — While an export runs, the dialog shows frames x/y, percent, ETA and the encoder
      tier.
- [ ] **AC6** — While an export runs, the timeline controls are locked, with a visible note.
- [ ] **AC7** — "Cancel" ends the export after the current frame.
- [ ] **AC8** — After a cancel, the target file does not exist.
- [ ] **AC9** — After a cancel, playback stands paused at the position it had before the export.
- [ ] **AC10** — Exporting the range 10–20 s at 30 fps gives an MP4 with 300 ± 1 frames.
- [ ] **AC11** — In that MP4, the first frame shows demo time 10.0 s (the fake engine draws the
      frame number into its pattern).
- [ ] **AC12** — A finished export shows "Done" with "Show in folder", which reveals the file
      through the handle.
- [ ] **AC13** — When `chooseVideoEncoder` reports `unavailable`, "Start" is disabled and shows the
      reason text from [[302]].
- [ ] **AC14** — `npx vitest run src/shared/replays/export-config.test.ts` covers every range kind
      and its edge cases.
- [ ] **AC15** — `npm run ui:flow -- replays-integrated-export-dialog` passes for AC2–AC13.
- [ ] **AC16** — `npm run ui:verify` reports no new axe violations.
- [ ] **AC17** — `CHANGELOG.md` `## Unreleased` has one line: "Export a demo or a part of it as
      MP4 video".

## Open Questions

1. Export defaults (concept open point F7): 1080p60, or 1080p30? Is the HUD on in exports?

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
