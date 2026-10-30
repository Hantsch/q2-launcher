---
id: 291
title: A demo plays inside the launcher in integrated mode
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user I want to click "Play" in integrated mode and watch the demo inside the launcher — no
console spam, no PAUSED picture, no engine demo bar — so that playback feels like a built-in
player.

Context:

- [concept §8.3](../concepts/integrated-demo-player.md) (overlays off), [concept §8.5](../concepts/integrated-demo-player.md), [concept §9.5](../concepts/integrated-demo-player.md); success criteria K1 and K3.
- Building blocks: mode and eligibility ([[287]]), `integrated.prepare` and `/engine-data/`
  ([[289]]), `EngineCanvas` and loader ([[290]]).
- Today's play path in the renderer: `src/renderer/src/modules/replays/useDemoPlay.ts` (`play`),
  `playback-store.ts` (`beginSession`, `pendingSeekS`), `client.ts`. Engine behaviour:
  `CL_PlayDemo_f` (`vendor/q2pro/src/client/demo.c`), `cl_demowait`, `cl_autopause`
  (`vendor/q2pro/src/client/main.c` `CL_CheckForPause`), `scr_showpause`, `scr_demobar`
  (`vendor/q2pro/src/client/screen.c`).
- New `src/renderer/src/modules/replays/integrated/integrated-session.ts`: `prepare` → fetch per
  file → `FS.mkdirTree`/`FS.writeFile` → `callMain(args)`, or `q2l_console("demo …")` when the
  engine already runs. Control here only via `q2l_console` (patch with `Cbuf_AddText` if [[284]]
  lacks it); the typed API follows in [[294]]/[[296]]. The console capture for the no-plumbing
  check is `Module.print`/`printErr` into a ring buffer readable by tests.
- Position and timeline are not wired yet: in integrated mode the timeline shows "—" and disabled
  controls with the visible reason `replays.player.unavailable.controlsComingSoon`; [[297]] removes
  it.
- Flow `scripts/flows/replays-play-integrated.mjs` with the fake engine; the real engine is
  checked by `npm run engine:smoke` and later the engine lane ([[304]]). [[287]]'s
  `CHANGELOG.md` line stays one line.
- Not in scope: sound ([[293]]), timeline control ([[297]]), MVD2 ([[319]]), a worker.
- Depends on: [[287]], [[289]], [[290]], [[283]]

Expected manual residue: with a real installation, play a `.dm2`, a `.dm2.gz` and a demo from a
zip in integrated mode — no PAUSED, no console lines, no demo bar, correct picture; judge load time
and UI stalls on a retail map (R8).

## Acceptance Criteria

- [ ] **AC1** — In mode `integrated`, Play on a `.dm2` of the active installation loads the
      manifest files into MEMFS, starts the engine with `+set basedir /q2 +set homedir /q2home +set game <gamedir>` and plays the demo in the canvas.
- [ ] **AC2** — In integrated mode the engine-mode path (`demoPlay` handler, Q2PRO process) is
      not called.
- [ ] **AC3** — A `.dm2.gz` and a zip-entry demo play the same way.
- [ ] **AC4** — During playback the session cvars `scr_showpause 0`, `cl_autopause 0`,
      `con_notifylines 0`, `scr_demobar 0` and `cl_demowait 1` are set.
- [ ] **AC5** — The engine console capture contains no line with `q2l_` or `Execing`.
- [ ] **AC6** — The stage shows the loading state (`replays.integrated.loading`) one animation
      frame before the synchronous `demo` call starts.
- [ ] **AC7** — At the demo's end the last picture stays (no disconnect screen) and the store
      receives `finished`.
- [ ] **AC8** — Stop ends playback, calls `integrated.release` and puts the placeholder back on
      the stage.
- [ ] **AC9** — When `integrated.prepare` refuses (e.g. `dataTooLarge`), the stage shows the
      reason and a one-click "Play in engine mode" action that switches the mode.
- [ ] **AC10** — The interim reason `replays.player.unavailable.integratedNotReady` from [[287]]
      is gone.
- [ ] **AC11** — `npm run ui:flow -- replays-play-integrated` and
      `npm run ui:flow -- replays-play-q2pro` are green; `npm run engine:smoke` still exits 0.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
