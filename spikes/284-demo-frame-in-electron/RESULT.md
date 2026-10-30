# Story 284 D2 - result: a demo frame renders in Electron

Harness `spikes/284-demo-frame-in-electron/` (`npm run engine:smoke`), Electron 43.8.4 on Windows 11, engine
`resources/engine/q2pro.wasm` (sha256 `aa92eb37...4a1b`, 1013566 bytes; `wasmSha256`, `wasmBytes` in every metrics file),
demo `tests/engine/demos/move-fire.dm2` (19754 bytes), 1024x768 offscreen window, 10 s playback. Four runs:
**shareware** = `results/metrics-shareware.json`, **retail** = `results/metrics-retail.json` (`C:\Games\Q2Pro`, pak0 + pak1 +
pak2), **retail-180mb** = `results/metrics-retail-180mb.json` (the retail data plus 117 MB of zero padding, see AC5),
**no-wasm** = `results/metrics-no-wasm.json` + `results/no-wasm-csp.log`. One run each; no repetition, so no variance is known.

**The "retail" install is not retail-size.** The paks in `C:\Games\Q2Pro\baseq2` total 63.0 MB (pak0 49951322 + pak1 12992754 +
pak2 45055 bytes). Its pak0 is the shareware-size pak, so the real retail data (about 180 MB) was **not available** to this spike.
The 63.0 MB run is real data at the wrong size; the 180 MB run is a synthetic stand-in (AC5).

## Verdict

**Viable, and it costs one CSP token.** The engine boots, loads the game data into MEMFS and plays a demo at 60 rAF/s inside the
launcher's own security settings (sandbox, context isolation, no node, production CSP) with exactly one change: `'wasm-unsafe-eval'`
in `script-src`. First picture after 1889 ms (shareware), 1912 ms (retail), 1900 ms (retail-180mb). The page stalls for about
206 to 242 ms around engine start (`maxLoopGapMs`), which the `longtask` observer does not report; that is under the 500 ms of R8.
The open cost is **renderer memory**: renderer RSS grows by about 2.2 times the data size, which at story 289's 1 GiB cap
extrapolates to about 2.3 to 2.6 GiB (AC5). Recommendation: **MEMFS on the main thread** for the first cut, with a loading state
that expects a freeze of a quarter second, and memory as the one risk story 289 must measure again at real size.

## AC1 - CSP and the engine under it

CSP served on every response (`PRODUCTION_CSP` of `src/main/lib/renderer-source.ts` copied by value, `main.cjs`):

`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`

| Run       | `cspMode`          | `cspViolations` | `engineError` |
| --------- | ------------------ | --------------- | ------------- |
| shareware | `wasm-unsafe-eval` | 0               | null          |
| retail    | `wasm-unsafe-eval` | 0               | null          |
| no-wasm   | `no-wasm`          | 2               | RuntimeError  |

The only directive that changes is `script-src`; `style-src 'self'` needed no relaxation (the page sets styles through CSSOM, which
`style-src` does not govern; no inline style, no `unsafe-inline`). Wasm is served as `application/wasm` over the privileged `q2spike`
scheme (standard, secure, supportFetchAPI).

## AC2 - time to first picture

| Run          | `timeToPictureMs` | Exit code | Frame file                       |
| ------------ | ----------------- | --------- | -------------------------------- |
| shareware    | 1889              | 0         | `results/frame-shareware.png`    |
| retail       | 1912              | 0         | `results/frame-retail.png`       |
| retail-180mb | 1900              | 0         | `results/frame-retail-180mb.png` |

Limit 10000 ms; `failures` is `[]` in all three. "First picture" = two consecutive polls (every 250 ms) that each show a window
capture with at least 50% bright pixels (luma > 16) that differs in at least 2% of pixels from the capture 500 ms earlier;
`timeToPictureMs` is the time of the first poll of the pair. A pixel counts as changed when `|dR|+|dG|+|dB|` against the earlier
capture exceeds `CHANGED_THRESHOLD` (24, of a possible 765). The time spans engine start to first picture on the main-process clock;
the 90 to 94 ms data fetch (`dataLoadMs`) comes before it. After the playback window the harness takes one more capture and compares
it with one 500 ms earlier: `playbackMotion` is 71.2% (shareware), 71.1% (retail), 70.0% (retail-180mb); a value under 2% fails the
run.

**What I see in the frame (my own reading of `results/frame.png`, the shareware run; I did not re-read the other two PNGs after this
round).** A first-person view of the demo: a dim rust-brown room with stacked crates carrying a skull emblem, a corridor with a ramp
on the left, a Quake II blaster at the bottom right (red charge cells), a small crosshair in the centre, `100` health with a red cross
and a weapon icon along the bottom, a thin grey progress bar reading `47%`. It is a **blaster close-up inside a room, not a map
overview**. Colours look plausible, not channel-swapped. A tiny icon in the top-right corner I cannot identify.

**Manual residue:** someone must open `results/frame-*.png` and confirm they look right. The harness proves "bright, changing and
still moving at the end", not "correct".

## AC3 - metrics per run

| Metric                                             | shareware                | retail                   | retail-180mb             |
| -------------------------------------------------- | ------------------------ | ------------------------ | ------------------------ |
| `dataLoadMs`                                       | 90                       | 94                       | 93                       |
| `dataBytes` (fetched) / `padBytes`                 | 49971076 / 0             | 63008885 / 0             | 63008885 / 122683392     |
| files (`files[]`)                                  | pak0, demo               | pak0, pak1, pak2, demo   | as retail                |
| `timeToPictureMs`                                  | 1889                     | 1912                     | 1900                     |
| `longestLongTaskMs` / `longTaskTotalMs`            | 0 / 0                    | 0 / 0                    | 0 / 0                    |
| `longTaskControlObserved` / `longTaskEntriesTotal` | true / 1                 | true / 1                 | true / 1                 |
| `maxLoopGapMs` (engine start to first picture)     | 205.7                    | 214.4                    | 242.4                    |
| `maxLoopGapWholeRunMs`                             | 205.7                    | 214.4                    | 242.4                    |
| `factoryCallMs` / `factoryResolveMs`               | 1.2 / 196                | 1.5 / 207                | 1.6 / 231                |
| `fsWriteMs`                                        | 8                        | 11                       | 39                       |
| `playbackMotion`                                   | 0.712                    | 0.711                    | 0.700                    |
| `rendererMemBefore` residentSet / private (KB)     | 64960 / 23108            | 65044 / 23144            | 65200 / 24196            |
| `rendererMemAfter` residentSet / private (KB)      | 231448 / 271480          | 194560 / 231676          | 496748 / 534452          |
| `appMetricsWorkingSet` renderer / GPU / total KB   | 231460 / 122540 / 584708 | 194564 / 122680 / 530512 | 496760 / 124100 / 836464 |
| `heapBytes`                                        | 134217728                | 134217728                | 134217728                |
| `fps`                                              | 60                       | 60                       | 60                       |
| `cspViolations`                                    | 0                        | 0                        | 0                        |
| `gpu` (`webgl2` key)                               | null                     | null                     | null                     |

`check.mjs` (exit 0 iff `fps > 0`, `cspViolations === 0`, `longTaskControlObserved` and `playbackMotion >= 0.02`): exit 0 on
`metrics.json`, `metrics-shareware.json`, `metrics-retail.json` and `metrics-retail-180mb.json`; exit 1 on `metrics-no-wasm.json`.
The harness's default demo is the repo copy even when `Q2L_SPIKE_Q2DIR` is set (only an explicit `--demo` is resolved against the
retail dir); all runs played the same demo.

## AC4 - negative run: the CSP without `'wasm-unsafe-eval'`

`npm run engine:smoke -- --no-wasm-csp --label no-wasm`: **exit code 1** (`PIPESTATUS[0]`), log `results/no-wasm-csp.log`. Error line:

`[engine error] RuntimeError: Aborted(CompileError: WebAssembly.instantiate(): Compiling or instantiating WebAssembly module violates the following Content Security policy directive because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: "script-src 'self'".)`

plus `securitypolicyviolation` events: `{"directive":"script-src","blockedURI":"wasm-eval","sourceFile":"q2spike"}` (`cspViolations` 2,
`timeToPictureMs` null, `failures` has three entries: engine error, CSP violations, no picture). So the production CSP **as it
stands blocks the engine**; the token is required, not optional.

## AC5 - MEMFS on the main thread vs worker + WORKERFS

**Data used.** The install's paks total 63.0 MB and pak0 is the shareware-size pak: retail (about 180 MB) was **not available**.
The `retail-180mb` run is a **synthetic stand-in**: the retail data plus a 117 MB zero-filled `/q2/baseq2/pad.bin` generated in the
page (`--pad-mb 117`; not fetched, not a pak, so the engine ignores it), 185692277 bytes in MEMFS in total (`dataBytes` +
`padBytes`). Caveat: the padding is zeros, so Windows memory compression or page sharing could make its resident size look smaller
than incompressible pak data would; the measured slope shows no sign of that, but real data could only be at least as large. It is
also one file, not a set of paks, and the engine never reads it.

Numbers (`metrics-shareware.json`, `metrics-retail.json`, `metrics-retail-180mb.json`; KB = 1024 bytes as `getProcessMemoryInfo`
reports, ratios are my arithmetic):

| Run          | Data in MEMFS (MiB) | Renderer RSS after (MiB) | Renderer private after (MiB) | Private delta / data bytes |
| ------------ | ------------------- | ------------------------ | ---------------------------- | -------------------------- |
| shareware    | 47.7                | 226                      | 265                          | about 5.1                  |
| retail       | 60.1                | 190                      | 226                          | about 3.4                  |
| retail-180mb | 177.1               | 485                      | 522                          | about 2.8                  |

**Method.** Least-squares line of renderer RSS (MiB) against data in MEMFS (MiB) through the three points: slope 2.21, intercept
91 MiB; private memory gives slope 2.20, intercept 129 MiB. The 50 MB point sits above the 63 MB one (a 36 MiB inversion), so the
small points are noise-dominated and the line is anchored by the padded run. **Extrapolated to the 1 GiB cap of story 289:** RSS
91 + 2.21 x 1024, about 2.3 GiB (private about 2.3 GiB). Using only the two larger points (63 and 185.7 MB), slope 2.52, the result
is about 2.6 GiB (private about 2.6 GiB). So expect **about 2.3 to 2.6 GiB** in the renderer at the cap: an order of magnitude from
three points and one demo, not a prediction. A plausible reason for more than 1x (inferred from `boot.js`, not measured): each file
is fetched as a `Uint8Array`, then copied by `FS.writeFile` into MEMFS, while the `files` array stays reachable from the `preRun`
closure, so two copies live. `heapBytes` is a constant 134217728 (128 MiB) in all runs: the MEMFS file contents are not in the wasm
heap.

**R8 "does the `demo` call block the UI for more than 500 ms?" - No, but not for the reason first given.** The first version
reported 0 ms from `longtask`, which is unproven on its own: the observer only fires above 50 ms and had no positive control. Now:
a deliberate 120 ms busy loop before the engine import **is** observed (`longTaskControlObserved` true in every run, so the
observer works), and it is the only entry (`longTaskEntriesTotal` 1), so the engine start produced no task over 50 ms by that
measure. An independent 5 ms heartbeat disagrees about "nothing blocks": the largest gap between ticks from engine start to first
picture is **205.7 ms (shareware), 214.4 ms (retail), 242.4 ms (retail-180mb)**, and it is also the whole-run maximum. So the page
does stall for about a fifth to a quarter of a second, and it grows slowly with data size. What I measured of it: the synchronous
engine factory call is 1.2 to 1.6 ms (`factoryCallMs`), the factory resolves after 196 to 231 ms (`factoryResolveMs`), and the
`FS.writeFile` loop takes 8 / 11 / 39 ms (`fsWriteMs`). The gap is therefore not the call itself and not the file copy; I did not
attribute it further (a heartbeat gap with no long task could be one task a little under 50 ms repeated, or compile/instantiate
work between tasks). It is well under 500 ms, and `fps` is 60 afterwards.

**Recommendation: MEMFS on the main thread** for the first cut, with a loading state shown over the stage because of the roughly
0.25 s freeze. A worker is justified only by R2 (memory), and a worker with MEMFS does not reduce it; the saving would come from
WORKERFS, which reads from `File`/`Blob` objects instead of copying and needs the engine built for it (not tested here). This
spike did not open story 289, so I cannot state R2's own threshold: **if the extrapolated 2.3 to 2.6 GiB crosses it, switch to the
worker with WORKERFS**. Cheap first mitigations on the main thread, untested: drop the fetched buffers after `writeFile`, or stream
each file into MEMFS.

## AC6 - deviations from concept 8.5 / 8.6 (`docs/concepts/integrated-demo-player.md`) and what they mean

Proposed changes to the concept (each seen in the harness code; none changes the verdict):

1. **CSP:** `PRODUCTION_CSP` in `src/main/lib/renderer-source.ts` needs `'wasm-unsafe-eval'` in `script-src` (AC4 proves it). The engine
   `.js` glue is a same-origin module, so `'self'` covers it; no `'unsafe-eval'`, no `blob:` script and no `worker-src` was needed on
   the main thread (a worker would need `worker-src 'self'`; untested).
2. **MIME:** the wasm is served as `application/wasm` (`APP_FILES` in `main.cjs`); the launcher's `q2launcher://` handler must map it.
   I did not test what happens with another type.
3. **Engine args** used: `+set basedir /q2 +set homedir /q2home +set s_enable 0 +set cl_autopause 0 +set scr_showpause 0 +set cl_demowait 1 +demo <name>`.
   Sound is off (`Sound initialization disabled` in the log); audio is the spike of story 286. The concept should list these.
4. **MEMFS layout:** `/q2/baseq2/<pak>` (file names lower-cased), `/q2/baseq2/demos/<demo>`, writable `/q2home`. `demo <name>` looks in
   `baseq2/demos/`.
5. **Canvas selector:** the module takes the canvas element through `moduleOptions.canvas`; the spike page uses the DOM id `canvas`,
   which is also Emscripten's default `#canvas` selector. A launcher component id such as `demo-stage-canvas` must be passed as the
   element, not relied on by selector.
6. **GPU reporting:** `app.getGPUFeatureStatus().webgl2` is absent in Electron 43 (`gpu` is `null`); `webgl` is `enabled` and the full
   status is in `gpuFeatureStatus` (also `webgpu: enabled`). WebGL 2 is not provable from that field; the engine log says
   `Using GLSL rendering backend`. A launcher check must not gate on `webgl2`.
7. **Frame detection:** a static console is bright, so "something is visible" is tested as "bright and changing for two polls in a row, and still moving after playback"; the final frame
   still needs the eye (AC2).
8. **rAF:** the harness counts `requestAnimationFrame` by wrapping it before the engine loads; 60/s suggests the engine's main loop is
   rAF-driven, so a hidden or throttled window would stop the game (`backgroundThrottling: false` is set in the harness; not tested
   without it).

Consequences for story 289 (data): a **manifest** of `{ index, vpath, size }` per file (the spike wraps it as `{ files, padMb }`) is enough; the renderer names only an index and
main maps it to a path (`DATA_FILES` in `main.cjs`). Files are fetched **whole** (`arrayBuffer()`), so the 1 GiB cap means up to 1 GiB
resident in the renderer before MEMFS gets its copy (AC5). `size` in the manifest gives the total up front for a progress bar and a
cap check; `Content-Length` was not relied on (the Response is built from a Buffer and the harness never reads the header).
Streaming and range reads were not tried.

Consequences for story 290 (stage): the canvas needs an element handed to the module, CSS sizing (`100vw` x `100vh` here) and a
visible, unthrottled window; the drawing buffer is whatever the engine sets, so the CSS size and the engine's video mode (`vid_*`
cvars, not set here) can disagree and give a scaled picture. Resize behaviour and teardown were not tested.

## AC7 - no change to the product

`git status --short src/` after all runs:

```
(empty)
```

The spike imports nothing from `src/`; the values taken from `src/` are copied by value and named.

## Residue and caveats

- Manual: look at `results/frame-*.png` (AC2).
- One run per label; timings are single samples. `results/metrics.json` and `results/frame.png` are copies of the last run that was not the negative one: the shareware run (the default).
- Not covered by this spike: audio (story 286), a worker build, resizing, quitting the engine, Linux.
