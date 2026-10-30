---
id: 284
title: 'Spike: a demo frame renders in the Electron renderer'
status: done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want to start the WASM engine in an Electron window with the
launcher's security settings and see a demo as a picture in a canvas, so that it is settled that
the integrated mode is technically viable and what it costs in memory and load time.

Spike, timebox 2 days: delivers `spikes/284-demo-frame-in-electron/RESULT.md` with measurements and
a recommendation, no production code.

Context:

- [concept §8.5](../../concepts/integrated-demo-player.md) (file system and game data), [concept §8.6](../../concepts/integrated-demo-player.md) (embedding in Electron),
  [concept §8.3](../../concepts/integrated-demo-player.md) (renderer), risks R2 (RAM through MEMFS), R8 (synchronous load
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

- [x] **AC1** — In a spike window with the launcher's `webPreferences` and the CSP
      `script-src 'self' 'wasm-unsafe-eval'`, the WASM module compiles with zero
      `securitypolicyviolation` events in the log.
- [x] **AC2** — With the installation's paks fetched over the spike scheme and written to
      `/q2/baseq2/` in MEMFS, `demo <name>` shows a picture of the map within 10 s;
      `Q2L_SPIKE_Q2DIR=<path> npm run engine:smoke` exits 0 and writes
      `spikes/284-demo-frame-in-electron/results/frame.png`.
- [x] **AC3** — After 10 s of real-time playback, `results/metrics.json` records data load time
      (ms), duration of the `demo` call (ms, UI block), renderer RAM before/after
      (`process.getProcessMemoryInfo`), WASM heap size, measured fps and `cspViolations`; a check
      script exits 0 when `fps > 0` and `cspViolations === 0`.
- [x] **AC4** — With `script-src 'self'` and no `'wasm-unsafe-eval'`
      (`npm run engine:smoke -- --no-wasm-csp`), `WebAssembly.instantiate` fails with a CSP error,
      the command exits non-zero and the log shows the error.
- [x] **AC5** — `RESULT.md` recommends MEMFS on the main thread or a worker with WORKERFS, backed
      by the measurements, and answers R8: does the `demo` call block the UI for more than 500 ms?
- [x] **AC6** — `RESULT.md` lists deviations from concept §8.5/§8.6 as change proposals and the
      consequences for [[289]] and [[290]].
- [x] **AC7** — `git status --short src/` is empty.

## Open Questions

- ~~MEMFS on the main thread or a worker with WORKERFS? (decided from AC5's recommendation)~~
  starting variant decided → Decisions (Sprint); the final recommendation is AC5's.

## Decisions (Sprint)

- The spike builds and measures **MEMFS on the renderer's main thread** only; the worker + WORKERFS
  variant is assessed in `RESULT.md` against the measured numbers (RAM delta vs pak bytes, longest
  long task) and recommended only if they cross R2's or R8's line, because concept §7 puts the engine
  host on the main thread for direct calls and same-document `VideoFrame(canvas)`, and a worker would
  also need OffscreenCanvas plumbing that is a story of its own.
- "A picture of the map" (AC2) is detected automatically: a `capturePage()` sample counts when ≥ 50%
  of its pixels have luma > 16 **and** it differs from the sample 500 ms earlier in ≥ 2% of pixels,
  because the static console/loading background would pass a plain non-black test.
- R8's "UI block" is the longest `PerformanceObserver('longtask')` entry between engine start and
  the first picture (plus their sum), because `+demo` on the command line runs inside the engine's
  start and no `q2l_*` command export exists before [[294]].
- fps is the count of `requestAnimationFrame` callbacks over the 10 s playback window, counted by a
  wrapper the page installs before importing the engine, because mashed's main loop is
  `emscripten_set_main_loop` on rAF.
- Renderer RAM comes from `process.getProcessMemoryInfo()` in the spike's own sandboxed preload,
  cross-checked with `app.getAppMetrics()` for the renderer pid, because AC3 names that API and the
  page has no node.
- The spike window copies `rendererWebPreferences` verbatim except `preload` (its own
  `preload.cjs`), because the launcher's preload would bring the whole IPC allowlist into a spike.
- The CSP travels as a response header on every spike-scheme response, `PRODUCTION_CSP`'s text
  copied with only `'wasm-unsafe-eval'` added to `script-src`; `--no-wasm-csp` uses the copy
  unchanged, because the launcher sets its CSP the same way and AC4 must prove the header bites.
- Default demo is `tests/engine/demos/move-fire.dm2` from [[283]] (shareware map, also in retail
  pak0), overridable by `--demo <path relative to Q2L_SPIKE_Q2DIR>`, because it is the only demo
  known to exist on every machine.
- The run is made twice when possible: shareware cache (reproducible) and, if
  `C:\Games\Q2Pro` (or `Q2L_SPIKE_Q2DIR`) has a retail `baseq2/pak0.pak`, the retail data, because R2's
  RAM question is about the ≈180 MB retail pak, not the shareware one.
- The window is shown offscreen with `backgroundThrottling: false`, as the ui-verify harness does,
  because a hidden window throttles rAF and would zero the fps.
- The shareware cache path is taken from [[283]]'s resolver in `scripts/engine/fetch-data.mjs`
  (exported there if it is not yet), never re-derived, and the spike never downloads, because the
  path rule has one owner.
- `results/frame.png` and `results/metrics.json` (per run, named by data source) are committed as the
  evidence, formatted with prettier, like spikes 183/185.
- A "not viable" outcome (no picture, CSP cannot be satisfied, RAM or block far over budget) is a
  valid spike result: `RESULT.md` says so plainly and the sprint re-cuts 288–291 per the sprint notes.

## Plan

Throwaway spike in `spikes/284-demo-frame-in-electron/` — outside `src/`, no production code, no
CHANGELOG line. Prerequisites: `resources/engine/q2pro.{js,wasm}` ([[281]]) and the shareware cache
or a retail install ([[283]]).

1. **D1 — harness.** `harness.mjs` launches Electron on a spike main; the main registers the
   privileged `q2spike://` scheme (standard, secure, supportFetchAPI) and serves `app/` (page),
   `engine/` (from `resources/engine/`, `.wasm` as `application/wasm`), `data/<n>` (paks and the demo,
   an allowlist built once in main, modelled on the news-image branch of
   `createRendererProtocolHandler` in `src/main/lib/renderer-source.ts`). The page fetches the data,
   writes it into MEMFS in `preRun`, starts the engine with the story's args, and reports CSP
   violations, long tasks, rAF count, heap and memory through the spike preload. Main samples
   `capturePage()`, writes `results/frame.png` + `results/metrics.json`, exits 0/non-zero.
   `check.mjs` gates the metrics. `package.json`: `engine:smoke`.
2. **D2 — run + RESULT.md.** Run shareware (+ retail if present), the `--no-wasm-csp` negative,
   `check.mjs`, `git status --short src/`; write `RESULT.md` with AC5 (MEMFS vs worker, R8 answer)
   and AC6 (deviations from §8.5/§8.6 as change proposals, consequences for [[289]] and [[290]]).

Order: D1 → D2. Files: `spikes/284-demo-frame-in-electron/*`, `package.json` (script only), maybe
one export in `scripts/engine/fetch-data.mjs`.

## Deliverables

- [x] **D1 — Spike harness `npm run engine:smoke`.** Node ESM + Electron built-ins only, no `src/`
      import (copy what is needed, with a comment naming the source). Files:
      `spikes/284-demo-frame-in-electron/{harness.mjs, main.cjs, preload.cjs, app/index.html,
app/boot.js, check.mjs, README.md}`, `package.json` (script
      `"engine:smoke": "node spikes/284-demo-frame-in-electron/harness.mjs"`), and only if needed one
      `export` of the cache-path resolver in `scripts/engine/fetch-data.mjs` ([[283]]).
  - `harness.mjs` resolves inputs and spawns `electron` (from `node_modules`) on `main.cjs`, passing
    paths via env; it forwards stdout/stderr and the exit code. Stops with a clear message when
    `resources/engine/q2pro.{js,wasm}` is missing ("run npm run engine:build") or when neither
    `Q2L_SPIKE_Q2DIR` nor the [[283]] cache (`baseq2/pak0.pak`) exists ("run npm run engine:data").
    Flags: `--no-wasm-csp`, `--demo <relpath under Q2L_SPIKE_Q2DIR>` (default
    `tests/engine/demos/move-fire.dm2`), `--label <name>` (results suffix, default `shareware` or
    `retail`), `--seconds 10`.
  - `main.cjs`: `protocol.registerSchemesAsPrivileged` for `q2spike` (standard, secure,
    supportFetchAPI); `protocol.handle` serves `q2spike://app/…` from `app/`,
    `q2spike://app/engine/…` from `resources/engine/`, `q2spike://app/data/<index>` from a fixed list
    built in main (`baseq2/pak*.pak` of the data dir + the demo) — index lookup only, unknown → 404,
    never a renderer path. Every response, 404 included, carries the CSP header: the copied
    `PRODUCTION_CSP` text with `'wasm-unsafe-eval'` added to `script-src`, or verbatim with
    `--no-wasm-csp`. `BrowserWindow` 1024×768, `webPreferences` copied from
    `src/main/window-shared.ts` `rendererWebPreferences` (contextIsolation, sandbox, no node,
    webSecurity, spellcheck false) with `preload: preload.cjs` and `backgroundThrottling: false`;
    shown offscreen left of all displays (as `scripts/lib/harness.mjs` positions its window), never
    focused. A manifest endpoint `q2spike://app/data/manifest.json` lists `{ index, vpath, size }`.
  - `preload.cjs` (sandboxed): `contextBridge` exposes `spike.memory()` →
    `process.getProcessMemoryInfo()` and `spike.report(obj)` → `ipcRenderer.send` to main.
  - `app/boot.js`: installs a `securitypolicyviolation` listener, a `longtask` PerformanceObserver
    and a rAF-counting wrapper **before** `import('./engine/q2pro.js')`; fetches the manifest and every
    file (times total data load ms), records `spike.memory()` before; calls the factory with a
    `canvas` element `id="canvas"`, `arguments` = `+set basedir /q2 +set homedir /q2home +set s_enable 0
+set cl_autopause 0 +set scr_showpause 0 +set cl_demowait 1 +demo <name>` and a `preRun` that
    creates `/q2/baseq2/` (+ `demos/`) and writes each file with `FS.writeFile`; catches the
    factory's rejection and reports it (message + name). Reports `engineStart`, `heapBytes`
    (`HEAPU8.length`) and memory after playback.
  - `main.cjs` polls `capturePage()` every 250 ms; "first picture" = a sample with ≥ 50% pixels at
    luma > 16 that differs in ≥ 2% of pixels from the sample 500 ms earlier. On first picture it
    plays `--seconds` more (real time), writes `results/frame-<label>.png` (also copied to
    `results/frame.png` for the run) and `results/metrics-<label>.json` (copied to
    `results/metrics.json`): `{ label, cspMode, dataLoadMs, dataBytes, files, timeToPictureMs,
longestLongTaskMs, longTaskTotalMs, rendererMemBefore, rendererMemAfter, appMetricsWorkingSet,
heapBytes, fps, cspViolations, cspViolationSamples, engineError, wasmSha256, wasmBytes,
electronVersion, gpu: app.getGPUFeatureStatus().webgl2 }`. Exit 0 only with a picture within 10 s of
    engine start, `cspViolations === 0` and no engine error; otherwise non-zero with the reason
    (CSP error message included) on stderr. Hard timeout 60 s; the app always quits.
  - `check.mjs [file]` (default `results/metrics.json`): exit 0 iff `fps > 0 && cspViolations === 0`,
    else 1 with the failing field.
  - `README.md`: prerequisites, commands, flags, what lands in `results/`.
  - Acceptance: `npm run engine:smoke` with the shareware cache exits 0 and writes
    `results/frame.png` + `results/metrics.json` with every field above; `npm run engine:smoke --
--no-wasm-csp` exits non-zero and its log names the CSP/`WebAssembly` error; `node
spikes/284-demo-frame-in-electron/check.mjs` exits 0 on the first, 1 on a metrics file with
    `fps: 0`; `npm run lint` and `npm run format:check` are green; `git status --short src/` empty.
- [x] **D2 — Run and `RESULT.md`.** Run unattended: shareware run; retail run with
      `Q2L_SPIKE_Q2DIR=C:\Games\Q2Pro --label retail` if that install has `baseq2/pak0.pak`
      (otherwise record "retail not measured" + why); `--no-wasm-csp` run (keep its log as
      `results/no-wasm-csp.log`); `check.mjs` on each metrics file; `git status --short src/`. Then
      `npx prettier --write spikes/284-demo-frame-in-electron` and write
      `spikes/284-demo-frame-in-electron/RESULT.md` (mirror `spikes/185-control-latency/RESULT.md`),
      every number citing its `results/*` file:
  - AC1: CSP used, `cspViolations` per run. AC2: time to first picture, exit codes. AC3: table of all
    metrics per run, `check.mjs` exit codes. AC4: the negative run's exit code and error line.
  - AC5: recommendation MEMFS-on-main-thread vs worker + WORKERFS, argued from renderer RAM delta vs
    data bytes (R2, extrapolated to the 1 GiB cap of [[289]]) and the longest long task; an explicit
    yes/no to R8 "does the `demo` call block the UI > 500 ms?".
  - AC6: deviations from concept §8.5/§8.6 as change proposals (e.g. args, MEMFS layout, CSP needs,
    MIME, Emscripten's `#canvas` selector vs a launcher DOM id) and consequences for [[289]]
    (manifest shape, whole-file fetch, `Content-Length`) and [[290]] (canvas id/target, sizing, rAF).
  - AC7: the `git status --short src/` output (empty). "Manual residue": look at
    `results/frame*.png`.
  - Acceptance: `RESULT.md` has one section per AC, cites only numbers present in `results/`.
    Files: `spikes/284-demo-frame-in-electron/RESULT.md`, `spikes/284-demo-frame-in-electron/results/*`.

## Model Hints

- D1 → deliverable-hard — a new Electron path (privileged custom scheme + response-header CSP +
  sandboxed preload + Emscripten ES6 factory with MEMFS `preRun`) where a subtle slip makes the
  numbers lie: CSP not on the HTML response (AC1 passes vacuously), long-task/rAF observers installed
  after the engine import (block and fps undercounted), or a picture test fooled by the console
  background.

Review: → default — AC4's negative run proves the CSP actually applies, and the picture test is
specified with its motion condition, so the remaining risk is shape and citation, which a default
review checks against `results/`.

## Acceptance Tests

A spike's evidence is an unattended automated probe run, not a vitest/ui:flow test: the harness is
the test, `RESULT.md` + `results/*` its report. No launcher surface is involved (developer harness
outside `src/`), so `ui:flow` does not apply.

- AC1 → probe `npm run engine:smoke` › `results/metrics.json` `cspMode = wasm-unsafe-eval`,
  `cspViolations === 0`, `engineError === null` → RESULT.md "AC1".
- AC2 → probe `npm run engine:smoke` (and `Q2L_SPIKE_Q2DIR=C:\Games\Q2Pro npm run engine:smoke --
--label retail`) › exit 0, `timeToPictureMs ≤ 10000`, `results/frame.png` written → RESULT.md "AC2".
- AC3 → probe same run › all metrics fields; `node spikes/284-demo-frame-in-electron/check.mjs` exit 0
  → RESULT.md "AC3".
- AC4 → probe `npm run engine:smoke -- --no-wasm-csp` › non-zero exit, `results/no-wasm-csp.log`
  contains the CSP/`WebAssembly` error → RESULT.md "AC4".
- AC5 → RESULT.md "AC5" section, backed by the AC3 metrics (memory delta, longest long task).
- AC6 → RESULT.md "AC6" section.
- AC7 → command `git status --short src/` (empty) in D2's run → RESULT.md "AC7".
- Manual residue: look at `results/frame*.png` — the map is recognisable and correctly textured
  (no black surfaces, no wrong colours); judging texture correctness needs eyes, the automated test
  only proves a moving, non-black picture.

## Done

Spike delivered: `spikes/284-demo-frame-in-electron/` (`npm run engine:smoke`, `check.mjs`, `RESULT.md`, `results/*`). The WASM engine runs in an Electron window with the launcher's `webPreferences` under `script-src 'self' 'wasm-unsafe-eval'`: first picture in 0.8 s (shareware) / 1.9 s (install), 60 fps, 0 CSP violations; without `'wasm-unsafe-eval'` the compile fails with a CSP error (exit 1). Verdict: integrated mode is viable; MEMFS on the main thread recommended, renderer RSS about 2.2x data size.

Change type: docs

Commit message: `284: spike demo frame in Electron (engine:smoke, CSP, MEMFS, metrics, RESULT.md)`

Verification: narrow gate — typecheck, lint, `vitest run --changed HEAD` (7781 passed), prettier check green; `git status --short src/` empty; no ui:flow applies (developer harness outside `src/`). AC1-AC4 proven by the probe runs (`results/metrics-*.json`, `results/no-wasm-csp.log`, `check.mjs` exit 0 on every good file); AC5-AC7 by RESULT.md sections and the empty `git status`. Review: default stage, 1 cycle.

Decisions:
- Review found the R8 `0 ms` unproven; added a 120 ms long-task positive control, a 5 ms heartbeat stall probe and `factoryCallMs`. Result: no long task over 50 ms, but a real 206-242 ms stall (unattributed) — still under 500 ms, so R8 is "no", with a loading state recommended.
- The C:\Games\Q2Pro install has a shareware-size pak0 (63 MB total, not ~180 MB retail); added `--pad-mb` and a synthetic 180 MB run for R2; RESULT.md says so plainly.
- Picture test hardened: two consecutive passing polls plus a `playbackMotion` check at the end.
- Cache resolver `resolveCacheDir` already exported from `scripts/engine/data.mjs`; imported there, `fetch-data.mjs` unchanged.
- `gpu` is null in Electron 43 (no `webgl2` key); `gpuFeatureStatus` recorded instead.

Manual residue: look at `results/frame*.png` — frames show a corridor/crates with the blaster close-up, not a map overview; texture/colour correctness needs eyes (retail frames not re-viewed after the fix round).

tiers: D 3 / hard 1 · review default · cycles 1 · agents 7
