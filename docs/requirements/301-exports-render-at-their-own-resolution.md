---
id: 301
title: Exports render at their own resolution
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

I export in 1920×1080 (or 1280×720) no matter how large the stage area in the launcher is right
now. The video has the chosen resolution, and I do not have to resize the window.

Context:

- [concept §10.2](../concepts/integrated-demo-player.md) (export resolution separate from the
  visible canvas), [concept §8.3](../concepts/integrated-demo-player.md) (size).
- Engine: `src/unix/video/emscripten.c` in the MashedD fork (`mode_changed`, `window_resized_cb`,
  `canvas_resized_cb`). The buffer size follows CSS size × DPR and is reported through
  `R_ModeChanged` and `SCR_ModeChanged`.
- Stage: `src/renderer/src/modules/replays/components/DemoStage.tsx` (4:3 fit via `fitAspect`,
  `stage-fit.ts`).
- Capture entry from [[300]]: `q2l_capture_begin(seed, width, height)`.
- Constraints:
  - Engine patch: a `capture_fixed_size` flag in `emscripten.c` makes the resize callbacks ignore
    CSS changes. `q2l_capture_begin` sets `emscripten_set_canvas_element_size(TARGET, w, h)` and
    calls `mode_changed()`.
  - A pure check `validateExportSize` lives in `src/shared/replays/export-config.ts`.
  - Letterboxing is CSS on the canvas container only, with no second canvas.
  - `npm run engine:smoke -- --capture 1920x1080 --frames 5` writes the frames as PNG to
    `.engine-test/`.
- Not in scope: the selection UI ([[303]]); aspect ratios other than 16:9 and 4:3.
- Expected manual residue: look at the smoke-run PNGs. Is the HUD proportional, is the picture
  sharp and not stretched?
- Depends on: [[300]].

## Acceptance Criteria

- [ ] **AC1** — With a canvas at CSS size 800×600 and DPR 1, `q2l_capture_begin(1, 1920, 1080)`
      sets `canvas.width × canvas.height` to 1920×1080, and the engine reports 1920×1080.
- [ ] **AC2** — During that capture, the CSS size stays 800×600.
- [ ] **AC3** — A `ResizeObserver` event on the stage during a 1920×1080 capture leaves the buffer
      size at 1920×1080.
- [ ] **AC4** — After `q2l_capture_end()`, the buffer size is CSS × DPR again, and the engine gets
      `R_ModeChanged` with the stage size.
- [ ] **AC5** — A 16:9 export on a 4:3 stage shows the picture letterboxed on the stage, without
      distortion.
- [ ] **AC6** — At export height 1080, `scr_scale` is set so the HUD has the same size relative to
      the picture height as at 480 px with `scr_scale 1`.
- [ ] **AC7** — After the export, `scr_scale` is back at its previous value.
- [ ] **AC8** — Export sizes outside 320×240…3840×2160 are refused with
      `fail('replays.export.error.resolution')` (unit test).
- [ ] **AC9** — An odd width or height is refused the same way, because H.264 needs even
      dimensions.
- [ ] **AC10** — `npm run engine:smoke -- --capture 1920x1080 --frames 5` exits 0 and writes five
      1920×1080 PNGs to `.engine-test/`.
- [ ] **AC11** — Concept §10.2 records the `scr_scale` formula that was settled.

## Open Questions

1. Which `scr_scale` formula gives the same relative HUD size at every export height (AC6)?

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
