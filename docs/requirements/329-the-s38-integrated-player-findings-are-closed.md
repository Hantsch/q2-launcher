---
id: 329
title: The S38 integrated-player findings are closed
status: draft
created: 2026-10-31
---

## Requirement

The S38 review left nine findings in the integrated player (TECH-DEBT TD-070 to TD-078). Most sit
in code that S39's player API and export stories build on: the engine's pause/resume exports, the
context-loss path, the game-data containment check and the integrated test harness. They are closed
before that code grows, so the new stories do not inherit them. TD-075 (no CI lane for the engine
build) stays open: the engine lane is local by design.

## Acceptance Criteria

- [ ] **AC1** — The engine build emits no warning about invalid runtime methods, and a simulated
      WebGL context loss pauses and resumes the engine's main loop through exported functions (TD-070).
- [ ] **AC2** — After a context loss in integrated mode, Play starts a demo without a prior Stop;
      engine mouse-look is either working or removed with no dead handler left (TD-071).
- [ ] **AC3** — A swap of the pinned game-data path or one of its parents after the check is refused,
      and a junctioned `baseq2`/mod directory that yields no files ends in a visible refusal instead
      of an empty manifest (TD-072).
- [ ] **AC4** — Every package the test support imports is declared in `package.json` (TD-073).
- [ ] **AC5** — Patch 0008's integer mix-ahead change applies only under `__EMSCRIPTEN__`; the native
      build's `DMA_Update` is unchanged (TD-074).
- [ ] **AC6** — `fetch-data.mjs` has tests for its failing exit code and its `.tmp` cleanup, and story
      283's text names `demo1` (TD-076).
- [ ] **AC7** — The `dataTooLarge` flow triggers the refusal without writing a file over 1 GiB (TD-077).
- [ ] **AC8** — The engine-play test overlap is gone, the mode flow covers the Settings switch's lock
      step, and tests cover the switch's busy and error states (TD-078).
- [ ] **AC9** — TD-070 to TD-074 and TD-076 to TD-078 are removed from `docs/TECH-DEBT.md`.

## Open Questions

- TD-071: restore engine mouse-look in integrated mode (pointer lock on click) or drop it, since the
  launcher's own controls steer playback?

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
