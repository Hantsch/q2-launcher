# Story 286 - result: audio is pulled from the DMA mixer

Harness `spikes/286-dma-audio-pull/` (`harness.mjs`, see `README.md`), demo `tests/engine/demos/move-fire.dm2`, 48 kHz
(`s_khz 48`), driver `web` (`s_driver web`, `s_enable 1`). Capture: 600 steps at 60 fps, seed 1, 2 runs. Real time: 60 s per
transport, one run each. All figures are read from `results/counts.json`, `results/pcm-hashes.json`, `results/realtime.json` and
`results/realtime-sab.json`. One machine, one audio device; no repetition, so no variance is known.

## Summary and recommendation

**Viable.** Engine patch 0008 adds a web sound driver whose DMA ring the host pulls with `q2l_audio_take`. In capture mode every
`q2l_step(ms)` yields exactly `48 * ms` frames (600 of 600 steps, 0 mismatches) and two runs produce a byte-identical PCM stream.
In real time the engine's own loop plus an AudioWorklet plays it, with 16 (port) and 24 (SAB) under-runs in 60 s whose cause is not isolated (below)
and a 135 ms pull-to-speaker latency. Recommendation: **the same driver for both modes**; capture (story 305) steps the engine
and takes the frames of each step, real time (story 293) reports the worklet's play position and pulls. For the transport,
**start with the port** (no cross-origin isolation needed, no measured difference to SAB: latency is equal, under-runs are within run-to-run variation); SAB only if a measurement at story 293
shows the port costing something. Whether the real-time output is _pleasant_ (sync, clicks) was not judged (Manual residue).

## Interface

All three exports are `EMSCRIPTEN_KEEPALIVE` in `src/unix/sound/web.c` and listed in `-sEXPORTED_FUNCTIONS` (with `_malloc`,
`_free`, so the host can allocate the destination).

| Export                                    | Purpose                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `int q2l_audio_take(int16_t *dst, int n)` | Copies painted stereo S16LE frames `[taken, s_paintedtime)` into `dst`, at most `n`; returns the count.      |
| `void q2l_audio_consumed(int frames)`     | Real time: total stereo frames the host has played. Sets `dma.samplepos`. Ignored while capturing.           |
| `void q2l_audio_capture(int on)`          | On: drops what was painted, moves play position onto `s_paintedtime`, steps own it. Off: back to `consumed`. |

**Units.** `q2l_audio_take` and `q2l_audio_consumed` count **frames** (one frame = L+R = 4 bytes). `dma.samplepos` inside the engine
counts **mono samples** (2 per frame); `q2l_audio_consumed` converts (`frames * 2 mod dma.samples`). The ring is `0x8000` frames
(`dma.samples` 65536), about 682 ms at 48 kHz; only the last ring's worth of painted audio is still intact, so `take` clamps a
host that fell more than one ring behind. `take` also follows `s_paintedtime` going back when `DMA_GetTime` chops it near 2^30.

**Play position decides how far the mixer paints.** `DMA_Update` paints up to `DMA_GetTime() + mixahead`, and `DMA_GetTime()` is
`samplepos / 2` plus one ring per observed wrap. The driver therefore only writes `samplepos`:

- Real time: `samplepos` follows the host's `q2l_audio_consumed`; the mixer runs ahead by `s_mixahead` (default).
- Capture: hooks in `q2l_step` (`src/unix/q2l_step.c`) around `CL_Frame`:
  - `snddma_web_step(msec)` before `CL_Frame`: forces the client active (`CL_Activate` + `S_Activate`), adds
    `speed * msec` to a carry and raises `target` by `carry / 1000` frames (remainder kept, so 17/16/17 ms never drifts).
  - `snddma_web_paint_to(endtime)` is called from `DMA_Update`: returns `target` while capturing, so the mixer paints up to the
    step's end although `samplepos` still sits at its start (at the end it would snap `s_paintedtime` back and paint nothing).
  - `snddma_web_settle()` after `CL_Frame`: mixes once more with `S_Update` if `CL_Frame` did not reach `target` (it mixes only
    on frames it renders or while minimized), then moves `samplepos` to `target`.
- `DMA_Update` sums `soundtime + (int)(sec * dma.speed)` in integers; as a float it would round past 2^24 frames and the
  paint-to time would stop advancing by exactly the play position. This change is in `dma.c` and also applies to the desktop
  engine's mixer (identical result below 2^24 frames).

**Worklet ring and transport** (`worklet.js`, `app/boot.js`). The pump (every `requestAnimationFrame`) calls
`q2l_audio_consumed(consumed)` then `q2l_audio_take`, converts S16 to Float32 (`/ 32768`) and hands 1024-frame blocks to the
`engine-player` AudioWorklet, which plays 128-frame quanta and reports `consumed` and `underruns`:

- **port** (default): planar-stereo Float32 blocks (transferred) over `MessagePort`; the worklet reports back every 4th quantum.
- **sab**: a 16384-frame interleaved Float32 `SharedArrayBuffer` ring plus a 3-slot `Int32Array` control block (`written`,
  `consumed`, `underruns`, via `Atomics`). Needs `crossOriginIsolated`; the harness serves COOP `same-origin` + COEP
  `require-corp` and exits 1 naming the reason otherwise.
- An under-run is a quantum that got fewer than 128 frames after the first block arrived (counting starts at the first block,
  not at engine boot).

**Limits.**

- Capture needs `s_mixahead 0` (set on the command line in capture mode); with the default, the mixer paints ahead and a step
  would yield more than its own frames.
- A step must stay below one ring (`0x8000` frames, about 682 ms at 48 kHz) or `DMA_GetTime` cannot see the wrap.
- While the client is `ca_loading`, `CL_Frame` renders no frame, so such steps are skipped by the frame counter; the harness
  steps until 3 consecutive steps render one frame before counting (`warmupSteps` 3). Audio during loading was not measured.
- `q2l_audio_consumed` is ignored while capturing; capture owns the play position.
- `q2l_audio_capture(1)` discards unread audio; call it before the first counted step.

## Patches

| File                                                                               | Purpose                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/patches/0008-snddma-web-driver-and-host-pulled-audio-exports.patch`        | New `snddma_web` driver and the three exports (344 lines, 5 files, below).                                                                                                                                                                                     |
| - `src/unix/sound/web.c` (new)                                                     | Driver, ring, `q2l_audio_*`, `snddma_web_step`/`paint_to`/`settle`.                                                                                                                                                                                            |
| - `src/client/sound/dma.c`                                                         | Registers `snddma_web` in `s_drivers`; integer mix-ahead sum; `snddma_web_paint_to` hook in `DMA_Update`.                                                                                                                                                      |
| - `inc/client/sound/dma.h`                                                         | Declares the three hooks (`__EMSCRIPTEN__` only).                                                                                                                                                                                                              |
| - `src/unix/q2l_step.c`                                                            | Calls `snddma_web_step` before and `snddma_web_settle` after `CL_Frame` (when `USE_SNDDMA`).                                                                                                                                                                   |
| - `meson.build`                                                                    | Builds `web.c` for the web target; exports `_q2l_audio_take/_consumed/_capture`, `_malloc`, `_free`.                                                                                                                                                           |
| `spikes/lib/` (`engine-window.mjs`, `engine-launch.mjs`, `page.js`, `preload.cjs`) | Frame shared by spikes 284, 285 and 286: privileged scheme + production CSP + hidden window; Electron launch and engine-input resolution; page helpers (data load, report, CSP watch); preload. Each spike keeps its own `main.mjs`, page and result handling. |
| `spikes/286-dma-audio-pull/`                                                       | `harness.mjs`, `main.mjs`, `worklet.js`, `app/boot.js`, `app/index.html`, `README.md`, `results/`.                                                                                                                                                             |

The shared frame took 284 and 285 from `main.cjs` to `main.mjs` (their `preload.cjs` moved into `spikes/lib/`); 285's `boot.js`
and both harnesses were adjusted to import it. 286 adds an `autoplay-policy` switch and the COOP/COEP headers through the frame's
`switches` and `headers` options.

## Measurements

**Capture** (`counts.json`, `pcm-hashes.json`): `driver` `web`, `sEnable` 1, `fps` 60, `seed` 1, `warmupSteps` 3.

| Figure             | Value                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `steps`            | 600                                                                                                                                          |
| `mismatches`       | 0 (`got[i]` equals `expected[i]` for every step)                                                                                             |
| cadence            | steps of 17/16/17 ms give 816/768/816 frames (`48 * ms`; the same 50 ms per 3 steps as 17/17/16); `expected` and `got` hold only 816 and 768 |
| `nonZeroSamples`   | 959174 of about 960000 interleaved samples                                                                                                   |
| PCM SHA-256, run 1 | `34dee5bb6a3f2f5765198d4459156b36832d29eb05495357a9d72136fe16e490`                                                                           |
| PCM SHA-256, run 2 | `34dee5bb6a3f2f5765198d4459156b36832d29eb05495357a9d72136fe16e490`                                                                           |
| `equal`            | true                                                                                                                                         |

Same engine seed; the PCM is reproducible byte for byte on this machine. `results/capture-run1.wav` is run 1's PCM.

**Real time** (60 s each, focused window, demo looped through `nextserver`):

| Figure                | port (`realtime.json`) | sab (`realtime-sab.json`) |
| --------------------- | ---------------------- | ------------------------- |
| `seconds`             | 60                     | 60                        |
| `underruns`           | 16                     | 24                        |
| `underrunsPerMinute`  | 16                     | 23.99                     |
| `latencyMs`           | 135.3                  | 135.3                     |
| `nonSilentBlocks`     | 2813 of 2813           | 2812 of 2812              |
| `crossOriginIsolated` | false                  | true                      |

Caveats, stated plainly:

- **The under-run count varies between runs and the cause is not isolated.** The port run gave 24 earlier and 16 now; the SAB run gave 24. They
  appeared in both transports and look start-up related: a 15 s run earlier showed the same count (not saved as a result file), so they do not
  seem to grow with time. None of the candidate causes was tested. If they are start-up only, `underrunsPerMinute` is an artefact of the 60 s window, not a rate.
- **No measured port-vs-SAB difference beyond run-to-run variation**: latency is equal (135.3 ms); under-runs are 16 (port) vs 24 (SAB) in single 60 s runs, and the port also gave 24 in an earlier unsaved run. The port recommendation rests on needing no cross-origin isolation, not on a measured advantage.
- **`nonSilentBlocks` is weak evidence of audibility.** Every block of both runs is non-silent, and the peaks reach full scale
  (32768), so the check cannot tell a good mix from a constantly loud one. It proves the pipe carries non-zero data, no more.

## Risk R6: do `48 * ms` samples come out of every step

**Yes in capture mode**, 600 of 600. The mechanism: `s_mixahead 0` removes the mixer's look-ahead, and the forced activation
removes the 0.125 s floor `DMA_Update` applies while `!cls.active`, so `s_paintedtime` ends each step exactly on `target`, which
rises by `speed * msec / 1000` with the remainder carried. Without either, the mixer paints more (or the sound is dropped because
`s_active` stayed false).

**It does not hold in real time with the default `s_mixahead`.** There the mixer paints ahead of the play position, steps are
not tied to audio, and what `take` returns per call depends on the pump's cadence and the worklet's consumption. Frames per
step are not a real-time property; real time is a continuous stream, and 293 should not try to cut it per step.

## Open points for story 293

- **Transport**: port vs SAB. Latency is equal (135.3 ms); under-runs differ (16 vs 24) but the count varies between runs, so one run each shows no transport difference. Port needs nothing else. SAB needs COOP/COEP,
  and **the launcher has no cross-origin isolation today** (`crossOriginIsolated` is false without the harness headers); adding
  it touches every response and any cross-origin resource. Choose the port unless a measurement says otherwise.
- **Autoplay**: the harness used the Chromium switch `autoplay-policy=no-user-gesture-required`. Production must not rely on it:
  create or `resume()` the `AudioContext` on the user's play click.
- **Latency**: 135.3 ms from painted to speaker (`(painted - consumed) / 48` plus `baseLatency` + `outputLatency`). The split between mix-ahead, block size
  and device latency was not measured. Whether it is acceptable for sync with the picture is a Manual residue.
- **Client activation**: in real time `s_active` follows `cls.active`, so the window must be focused (the harness focuses it);
  an unfocused or background launcher view paints with the 0.125 s floor or drops sounds. 293 needs a rule for it.
- **Volume**: not touched by this spike; a launcher volume would be a gain on the worklet side or the `s_volume` cvar. Open.
- The 16-24 under-runs: isolate before the story claims glitch-free start.

## Open points for story 305 (recorded video)

- **Timestamps per step**: the audio of step `i` is the `48 * ms_i` frames returned by that step's `take`; timestamps follow from
  the running frame sum, not from `i * 1000 / fps` (17/16/17 ms steps).
- **`timescale != 1`**: not tested. A scaled step changes the game's `msec`, and which `ms` the driver should receive (wall or
  game time) is open.
- **Step below about 682 ms** (one ring); a longer step must be split.
- **Loading frames** (`ca_loading`): no frame is rendered; the steps still advance audio time, so video and audio need the
  same frame/step bookkeeping, as in 285's warm-up.

## Manual residue

Listening to the real-time run was **not judged by any automated check**: sync with the picture, and absence of clicks and
dropouts, need an ear (and the 16-24 under-runs, if audible, would be a glitch at start). `nonSilentBlocks` and `underruns` are the only automated
signals, and they do not cover it.

## Source tree untouched

`git status --short src/` prints nothing (run after writing this file): the spike changes only `engine/patches`, `spikes/` and
the spike's own results.
