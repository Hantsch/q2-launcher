---
id: 312
title: Engine and export failures end in a clear message
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user I want a broken demo, missing game data, a graphics failure or a full disk to give me a
clear message while the launcher stays usable, so that a player failure never freezes the app or
leaves partial files behind.

Context:

- `PlayerEvent` `error` (an i18n key, never prose) in
  [concept §9.1](../concepts/integrated-demo-player.md), the state struct's `error_seq` / `error`
  in [concept §9.3](../concepts/integrated-demo-player.md), cancel reasons in
  [concept §10.6](../concepts/integrated-demo-player.md), the manifest size cap in
  [concept §8.5](../concepts/integrated-demo-player.md).
- Engine errors go through `Com_Error` → `longjmp` (concept §8.2); the hook in `Com_Error` /
  `CL_Disconnect` comes from [[294]].
- The launcher's shutdown path: `src/main/shutdown.ts` (`before-quit`).
- CLAUDE.md: main sends i18n keys, never prose; renderer-local engine errors get keys too.
- Constraints: one error mapper `mapEngineError(stateError, demoState): PlayerEvent` in
  `src/renderer/src/modules/replays/integrated/errors.ts` maps engine texts through a pattern
  table to keys; unknown → `replays.integrated.error.engine` with the shortened text as a detail
  parameter. Context loss: `webglcontextlost` with `preventDefault()`, `webglcontextrestored` →
  new engine instance (Emscripten's GL objects are invalid after a restore). Main maps `ENOSPC`
  and similar in `export-sink.ts` to keys (like the `replays.play.error.*` keys in
  `demo-play.ts`). The fake engine from [[296]] gets switches (`failOn: 'load' | 'frame' | 'oom'`).
- Not in scope: resuming cancelled exports; telemetry.
- Depends on: [[296]], [[303]].

Expected manual residue: on a real GPU, a driver reset or sleep/resume during playback — does the
player recover through Retry?

## Acceptance Criteria

- [ ] **AC1** — A truncated `.dm2` played in integrated mode emits `error` with
      `replays.integrated.error.demoCorrupt`; the stage shows the text and the timeline is locked.
- [ ] **AC2** — After the failure in AC1 another demo plays without a restart.
- [ ] **AC3** — A manifest without `pak0.pak`, or a demo whose map is missing, emits
      `replays.integrated.error.missingData` with the map or file name as a parameter, plus a
      visible "Play in engine mode" hint.
- [ ] **AC4** — A manifest over the size cap is refused by main in `integrated.prepare` with
      `replays.integrated.error.dataTooLarge`, before any data is loaded.
- [ ] **AC5** — A WebGL context loss during playback (simulated with `WEBGL_lose_context`)
      pauses the player and shows `replays.integrated.error.gpuLost` with "Retry".
- [ ] **AC6** — Retry after a context loss rebuilds engine and session and resumes at the last
      position.
- [ ] **AC7** — A context loss or encoder failure during an export cancels it
      (`output.cancel()`, `export.abort`), deletes the partial file and shows
      `replays.export.error.gpuLost` or `replays.export.error.encoder`
      (`npm run ui:flow -- replays-export-context-loss`: no file in the target folder).
- [ ] **AC8** — An `export.write` failing with `ENOSPC` ends the export with
      `replays.export.error.diskFull` and deletes the partial file
      (`npx vitest run src/main/modules/replays/export-sink.test.ts`).
- [ ] **AC9** — Quitting the launcher during an export waits in `before-quit` for the cancel (at
      most 5 s) and leaves no partial file.
- [ ] **AC10** — A failed engine allocation (OOM, simulated through a small `MAXIMUM_MEMORY` test
      build or the fake engine) emits `replays.integrated.error.outOfMemory` and discards the
      engine instance.
- [ ] **AC11** — `npx vitest run src/renderer/src/modules/replays/integrated/errors.test.ts` maps
      every key named above, `npm run ui:flow -- replays-integrated-errors` shows the text for each
      `failOn` case, and `npm run test:engine -- --only=corrupt-demo` gives `demoCorrupt` for the
      truncated test demo with the real engine.
- [ ] **AC12** — Every key is in `locale/en.json`, and the "Limitations" section of
      `docs/systems/replays-module.md` names the known limits (size cap, MVD2 status).

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
