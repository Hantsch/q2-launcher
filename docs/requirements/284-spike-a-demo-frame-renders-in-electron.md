---
id: 284
title: 'Spike: a demo frame renders in the Electron renderer'
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want to start the WASM engine in an Electron window with the
launcher's security settings and see a demo as a picture in a canvas, so that it is settled that
the integrated mode is technically viable and what it costs in memory and load time.

Spike, timebox 2 days: delivers `spikes/284-demo-frame-in-electron/RESULT.md` with measurements and
a recommendation, no production code.

Context:

- [concept §8.5](../concepts/integrated-demo-player.md) (file system and game data), [concept §8.6](../concepts/integrated-demo-player.md) (embedding in Electron),
  [concept §8.3](../concepts/integrated-demo-player.md) (renderer), risks R2 (RAM through MEMFS), R8 (synchronous load
  freezes the UI), R9 (CSP).
- Engine artefact from [[281]]: `resources/engine/q2pro.js`, `resources/engine/q2pro.wasm`.
- Launcher security: `src/main/window-shared.ts` `rendererWebPreferences` (`contextIsolation`,
  `sandbox`, no node); production CSP in `src/main/lib/renderer-source.ts` `PRODUCTION_CSP` (no
  `'wasm-unsafe-eval'` today).
- Video driver `vid_emscripten`: `vendor/q2pro-mashed/src/unix/video/emscripten.c` (canvas target
  `#canvas`, WebGL2 context). `CL_PlayDemo_f` parses synchronously up to precache
  (`vendor/q2pro/src/client/demo.c`).
- Harness `spikes/284-demo-frame-in-electron/harness.mjs` starts Electron with a `BrowserWindow`
  whose `webPreferences` copy `window-shared.ts` (copied, not imported). A spike scheme
  (`q2spike://`, `protocol.handle`) serves the engine files and, from the installation in
  `Q2L_SPIKE_Q2DIR`, `baseq2/pak*.pak` and the demo — modelled on the image branch of
  `createRendererProtocolHandler`. Without `Q2L_SPIKE_Q2DIR` it uses the shareware cache from
  [[283]] or stops with a clear message. `package.json` script `engine:smoke` runs the harness.
- Engine args: `+set basedir /q2 +set homedir /q2home +set s_enable 0 +set cl_autopause 0 +set
scr_showpause 0 +set cl_demowait 1 +demo <name>`. Screenshot via `webContents.capturePage()` after
  5 s of playback.
- Not in scope: production code under `src/`, the launcher CSP ([[288]]), sound, any control
  beyond the start command, the manifest and token protocol ([[289]]).
- Depends on: [[281]]

Expected manual residue: look at `results/frame.png` — the map is recognisable and correctly
textured (no black surfaces, no wrong colours).

## Acceptance Criteria

- [ ] **AC1** — In a spike window with the launcher's `webPreferences` and the CSP
      `script-src 'self' 'wasm-unsafe-eval'`, the WASM module compiles with zero
      `securitypolicyviolation` events in the log.
- [ ] **AC2** — With the installation's paks fetched over the spike scheme and written to
      `/q2/baseq2/` in MEMFS, `demo <name>` shows a picture of the map within 10 s;
      `Q2L_SPIKE_Q2DIR=<path> npm run engine:smoke` exits 0 and writes
      `spikes/284-demo-frame-in-electron/results/frame.png`.
- [ ] **AC3** — After 10 s of real-time playback, `results/metrics.json` records data load time
      (ms), duration of the `demo` call (ms, UI block), renderer RAM before/after
      (`process.getProcessMemoryInfo`), WASM heap size, measured fps and `cspViolations`; a check
      script exits 0 when `fps > 0` and `cspViolations === 0`.
- [ ] **AC4** — With `script-src 'self'` and no `'wasm-unsafe-eval'`
      (`npm run engine:smoke -- --no-wasm-csp`), `WebAssembly.instantiate` fails with a CSP error,
      the command exits non-zero and the log shows the error.
- [ ] **AC5** — `RESULT.md` recommends MEMFS on the main thread or a worker with WORKERFS, backed
      by the measurements, and answers R8: does the `demo` call block the UI for more than 500 ms?
- [ ] **AC6** — `RESULT.md` lists deviations from concept §8.5/§8.6 as change proposals and the
      consequences for [[289]] and [[290]].
- [ ] **AC7** — `git status --short src/` is empty.

## Open Questions

- MEMFS on the main thread or a worker with WORKERFS? (decided from AC5's recommendation)

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
