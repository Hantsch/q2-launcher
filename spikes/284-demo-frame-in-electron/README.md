# Spike 284 - a demo frame renders in Electron

Throwaway harness: starts the WebAssembly engine (`resources/engine/q2pro.{js,wasm}`) in an
Electron window with the launcher's security settings (context isolation, sandbox, no node, the
production CSP) and plays a demo into a canvas, then writes a frame and metrics. Nothing in `src/`
imports it, and it imports nothing from `src/` - the copied values name their source.

## Prerequisites

- `npm run engine:build` - the engine in `resources/engine/`.
- Game data, one of:
  - the shareware cache from `npm run engine:data` (`baseq2/pak0.pak`; path from
    `resolveCacheDir()` in `scripts/engine/data.mjs`, `Q2L_ENGINE_DATA` overrides it), or
  - a retail install: `Q2L_SPIKE_Q2DIR=<dir with baseq2/pak*.pak>`, which wins over the cache.

The harness never downloads anything; it stops with the command to run when an input is missing.

## Commands

```sh
npm run engine:smoke                                  # shareware cache, label "shareware"
Q2L_SPIKE_Q2DIR=C:/Games/Q2Pro npm run engine:smoke   # retail install, label "retail"
npm run engine:smoke -- --no-wasm-csp                 # must fail: the CSP blocks WebAssembly
node spikes/284-demo-frame-in-electron/check.mjs [metrics.json]
```

| Flag            | Default                            | Meaning                                                                                                                                                        |
| --------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--no-wasm-csp` | off                                | serve the production CSP verbatim, without `'wasm-unsafe-eval'` in `script-src`                                                                                |
| `--demo <path>` | `tests/engine/demos/move-fire.dm2` | `.dm2` to play; an explicit path is relative to `Q2L_SPIKE_Q2DIR` when set, else to the repo root; the default stays the repo copy even with `Q2L_SPIKE_Q2DIR` |
| `--pad-mb <n>`  | `0`                                | add an n-MB zero-filled `baseq2/pad.bin` to MEMFS (generated in the page) to size-match retail data                                                            |
| `--label <n>`   | `shareware` or `retail`            | suffix of the result files                                                                                                                                     |
| `--seconds <n>` | `10`                               | real-time playback after the first picture                                                                                                                     |

Exit 0 only when a picture appears within 10 s of engine start, with no CSP violation and no engine
error; otherwise non-zero with the reasons on stderr. Hard timeout 60 s; the app always quits.

"First picture": a window capture (every 250 ms) with at least 50% of pixels at luma > 16 that
differs in at least 2% of pixels from the capture 500 ms earlier, so the static console background
does not count. Two such polls in a row are required; the time is that of the first of the pair. A pixel
counts as changed when its summed per-channel difference `|dR|+|dG|+|dB|` exceeds `CHANGED_THRESHOLD`
(24, of a possible 765). After playback a final capture is compared with one 500 ms earlier
(`playbackMotion`); under 2% fails the run. A 120 ms busy loop before engine start must show up as a
long task (`longTaskControlObserved`), else the run fails.

`check.mjs` exits 0 iff `fps > 0`, `cspViolations === 0`, `longTaskControlObserved` and `playbackMotion >= 0.02` (default file: `results/metrics.json`).

## What lands in `results/`

- `frame-<label>.png` (and `frame.png`) - the window at the end of playback.
- `metrics-<label>.json` (and `metrics.json`):

| Field                                                                        | Meaning                                                                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `label`, `cspMode`                                                           | run label; `wasm-unsafe-eval` or `no-wasm`                                                        |
| `dataLoadMs`, `dataBytes`, `files`                                           | fetching manifest + all data files over `q2spike://`; their MEMFS paths and sizes                 |
| `timeToPictureMs`                                                            | engine start (just before importing `q2pro.js`) to first picture, main-process clock              |
| `longestLongTaskMs`, `longTaskTotalMs`                                       | `longtask` entries overlapping engine start to first picture (page clock)                         |
| `longTaskControlObserved`, `longTaskEntriesTotal`, `longTaskEntriesInWindow` | positive control seen; all entries; those in the window                                           |
| `maxLoopGapMs`, `maxLoopGapWholeRunMs`                                       | largest gap between 5 ms timer ticks, in the window / whole run (no 50 ms threshold)              |
| `factoryCallMs`, `factoryResolveMs`, `engineImportMs`, `fsWriteMs`           | engine factory call (sync) and resolve, module import, MEMFS write loop                           |
| `padBytes`, `playbackMotion`                                                 | zero-filled padding written (`dataBytes` stays fetched bytes); share of pixels changed at the end |
| `rendererMemBefore`, `rendererMemAfter`                                      | `process.getProcessMemoryInfo()` (KB) before data load / at the end of playback                   |
| `appMetricsWorkingSet`                                                       | `app.getAppMetrics()` working set (KB): renderer, GPU process, all processes                      |
| `heapBytes`                                                                  | `HEAPU8.length` of the engine's wasm memory                                                       |
| `fps`                                                                        | `requestAnimationFrame` callbacks per second over the playback window                             |
| `cspViolations`, `cspViolationSamples`                                       | `securitypolicyviolation` events (first five kept)                                                |
| `engineError`                                                                | `{ name, message }` of a factory rejection or uncaught error, else `null`                         |
| `wasmSha256`, `wasmBytes`                                                    | the engine binary that ran                                                                        |
| `electronVersion`, `gpu`                                                     | Electron version; `app.getGPUFeatureStatus().webgl2` (`null` when Chromium omits it)              |
| `gpuFeatureStatus`, `failures`                                               | the full GPU feature status; the reasons the run failed (empty on success)                        |
