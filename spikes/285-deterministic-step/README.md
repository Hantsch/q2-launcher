# Spike 285 - the engine steps deterministically

Throwaway harness: in one Electron window (the launcher's security settings and production CSP,
copied from spike 284) it creates a fresh engine instance per run, pauses the engine's own main
loop, steps it with `_q2l_step(ms)` on the demo `tests/engine/demos/move-fire.dm2`, and hashes the
WebGL frame every 15th step. Nothing in `src/` imports it, and it imports nothing from `src/`.

## Prerequisites

- `npm run engine:build` - the engine in `resources/engine/` (with the step patch).
- Game data: `Q2L_SPIKE_Q2DIR=<dir with baseq2/pak*.pak>` (wins), else the shareware cache of
  `npm run engine:data`. The harness never downloads; it stops with a message when both are missing.

## Commands

```sh
node spikes/285-deterministic-step/harness.mjs --runs=2 --seed=1 --renderer=swiftshader
node spikes/285-deterministic-step/harness.mjs --runs=2 --no-seed --renderer=swiftshader
node spikes/285-deterministic-step/harness.mjs --runs=2 --seed=1 --renderer=swiftshader --fps=60
node spikes/285-deterministic-step/harness.mjs --runs=2 --seed=1 --renderer=gpu
```

| Flag                          | Default       | Meaning                                                                        |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------ |
| `--runs=N`                    | `2`           | engine instances created and played in sequence in one renderer process        |
| `--seed=N` / `--no-seed`      | `--seed=1`    | `_q2l_seed(N)` right after init; `--no-seed` leaves the engine's own seed      |
| `--renderer=swiftshader\|gpu` | `swiftshader` | swiftshader adds ANGLE `use-angle=swiftshader` and `enable-unsafe-swiftshader` |
| `--fps=30\|60`                | `30`          | step `i` advances `round((i+1)*1000/fps) - round(i*1000/fps)` ms               |
| `--steps=N`                   | `300`         | counted steps per run                                                          |

## What a run does

Per run: a new 640x480 canvas (backing store and CSS size), a fresh engine instance, args as in 284
plus `+set cl_flares 0 +set cl_async 1 +set r_maxfps 0 +demo move-fire`, the window focused with
background throttling off (so the client is active), `pauseMainLoop()`, then `_q2l_seed`.

Warm-up: map load renders no frame on some steps, so before the counted steps the harness steps
until three consecutive steps each render exactly one frame (`warmupSteps` in the JSON). The counted
steps then each must render exactly one frame (`_q2l_frames_rendered()` delta).

Sampling: after counted step `i`, when `(i+1)` is a multiple of 15, `readPixels` runs in the same
task as the step and the RGBA buffer is hashed with SHA-256 (`frame` = `i+1`). Every 60th frame is
also saved as `results/frame-<renderer>[-run<n>]-<frame>.png` (rows flipped; runs after the first
carry `-run<n>`).

## Result

`results/hashes-<renderer>[-noseed][-60fps].json`:
`{ renderer, seed, fps, steps, runs: [{ framesRendered, warmupSteps, glRenderer, hashes }], identical, firstDifferentFrame }`.
`glRenderer` is the unmasked WebGL renderer string; it shows whether `--renderer=gpu` really got a hardware context.
With `--no-seed` the runs start over a second apart, so the engine's own `time(NULL)` seed differs. PNG names carry
neither fps nor seed and only the first run's are kept: run the seeded 30 fps command last when the PNGs are to be kept.

Exit 0 unless a step renders other than one frame, a sampled frame is a single colour, all sampled
hashes of a run are equal, or - with a seed - the runs' hash lists differ. With `--no-seed` a
difference is reported, not a failure. Hard timeout 540 s; the app always quits.
