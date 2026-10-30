---
id: 290
title: The engine canvas sits on the demo stage
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user in integrated mode I want the demo's picture to appear right in the stage area of the
Demos view, moving and scaling with the window, so that I no longer manage a second window.

Context:

- [concept §7](../concepts/integrated-demo-player.md) (engine host), [concept §8.3](../concepts/integrated-demo-player.md) (canvas size, DPR).
- Today's stage: `src/renderer/src/modules/replays/components/DemoStage.tsx` (4:3 area, `fitAspect`
  from `stage-fit.ts`, `useStageReport`). In engine mode it reports its rect to main; in integrated
  mode it hosts the canvas.
- Engine artefacts under `/engine/` ([[288]]); the ES6 module from `-sMODULARIZE -sEXPORT_ES6` is
  loaded with dynamic `import()`. Canvas target and resize callbacks in
  `vendor/q2pro-mashed/src/unix/video/emscripten.c` (`TARGET "canvas"`, `window_resized_cb`,
  `mode_changed`).
- New module files: `src/renderer/src/modules/replays/integrated/engine-loader.ts` (singleton),
  `integrated/EngineCanvas.tsx`, `integrated/engine-module.ts` (TS type of the engine interface),
  and `integrated/fake-engine.ts` — a fake engine drawing a WebGL2 test pattern behind the same
  interface, chosen by a harness switch like the stub engine (`scripts/lib/stub-engine.cjs`,
  `scripts/lib/fixture.mjs`); unit tests and flows use it.
- Keyboard: Emscripten's html5 callbacks are registered on the canvas element; a needed engine
  patch goes into `engine/patches/`. No `requestPointerLock` in integrated mode.
- `/renderer-guidelines`, `/design-tokens`, `/ui-verify`; new flow registered in
  `scripts/flows/areas.json`.
- Not in scope: game data, starting a demo ([[291]]), sound ([[293]]), fullscreen/cinema ([[309]]).
- Depends on: [[288]]

Expected manual residue: with the real engine (after [[291]]) move and resize the window — the
picture stays sharp, no flicker.

## Acceptance Criteria

- [ ] **AC1** — In mode `integrated`, `DemoStage` renders `<canvas data-testid="replays-engine-canvas">` in the 4:3 area instead of the placeholder.
- [ ] **AC2** — In mode `engine`, `DemoStage` behaves as today (existing tests and
      `npm run ui:flow -- replays-stage` green).
- [ ] **AC3** — After a resize, the canvas buffer size equals CSS size × `devicePixelRatio`
      (rounded), and the engine receives the new size (the fake counts resize calls).
- [ ] **AC4** — Starting a second demo does not instantiate the WASM module again (loader
      singleton, test with a fake loader).
- [ ] **AC5** — Leaving the Demos view or stopping the demo stops the rAF loop and makes the
      engine release demo resources (`disconnect`); quitting the app discards the instance.
- [ ] **AC6** — On `webglcontextlost` the stage shows the visible text "The 3D view was lost.
      Press Play to restart." (`replays.integrated.error.contextLost`) instead of a black picture.
- [ ] **AC7** — Typing in the list's filter field during playback does not reach the engine
      (`npm run ui:flow -- replays-integrated-canvas`).
- [ ] **AC8** — `npm run ui:verify` is green and has a screenshot of the Demos view with the
      canvas; `src/architecture.test.ts` stays green (no cross-module imports).

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
