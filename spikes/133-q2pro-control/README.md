# Story 133 spike — steering Q2PRO on Windows

This is a throwaway spike harness. It lives outside `src/`, is not part of the
shipped app, is not wired into any build or test, and will not survive the
story once its acceptance criteria are decided one way or the other. Read
`harness.mjs`'s top-of-file comment for the exact mechanism (self-rescheduling
console-exec-file loop, exactly-once command delivery via an engine-side `if`
guard on a sequence cvar, and `$cl_demopos` as the playback-position readback).

## Prerequisites

- A Q2PRO installation as installed by the launcher itself: the pinned build
  `q2pro-nightly-win64`, version `r3834~601a8df8`, per
  `content/q2_community_content/engines/manifest.json`. Do not use an
  arbitrary Q2PRO build — the console command surface this spike depends on
  (`pause`, `seek`, `timescale`, `if`, the `$cl_demopos` macro) was not
  verified against any other build.
- A demo of at least ~45 s: the scripted run ends with an absolute `seek 30`,
  and a shorter demo simply finishes there ("Demo finished").
- Your own demo file, copied by hand into that installation's
  `<gamedir>/demos/` folder. The harness does not provide, download or record
  a demo file — for licensing reasons a demo is not shipped with the repo or
  the spike.

## Running the scripted mode

The scripted run drives a fixed script (`pause`, `pause`, `seek +10`,
`seek -10`, `seek 30`, `timescale 2`, `timescale 1`) after a 3s warm-up, then
exits and writes a results file.

For a `.mvd2` demo it runs a longer script instead, 3 s per step so you can
watch it: pause, relative and percent seeks, switching the chased player
(`cmd invnext`/`cmd invprev`), toggling chasecam (`cmd chase`), chasing the
quad carrier (`cmd chase q`) and timescale. The engine's `[MVD] ...` replies
land in the logfile.

```
node spikes/133-q2pro-control/harness.mjs --q2pro <path>\q2pro.exe --game <path>\<gamedir> --demo mydemo.dm2 --run scripted
```

## Running interactively

The interactive run instead reads console commands you type into the
harness's own stdin (not the game window), one per line, and sends each one
through the same control-file mechanism, printing the ACK latency it observes:

```
node spikes/133-q2pro-control/harness.mjs --q2pro <path>\q2pro.exe --game <path>\<gamedir> --demo mydemo.dm2 --run interactive
```

Press Ctrl+C to end the run (this also ends the scripted run early if needed).

## CLI flags

- `--q2pro <path>` — path to `q2pro.exe`. Required.
- `--game <path>` — path to the installation's game directory (the folder
  that itself contains a `demos/` subfolder). Required.
- `--demo <filename>` — filename of the demo, relative to
  `<gamedir>/demos/`, e.g. `mydemo.dm2`. Required.
- `--wait <frames>` — engine frames between control-loop reschedules.
  Optional, default `5`.
- `--run scripted|interactive` — which mode to run. Optional, default
  `scripted`.

## What to watch for by eye during the interactive run

The harness only observes what the engine echoes to its logfile — it cannot
see the game window. While driving an interactive run, watch the actual
Q2PRO window for:

- The in-game demo progress indicator (enable it with `scr_demobar 1` if not
  already on) — does it move, freeze under `pause`, and jump correctly on
  `seek`?
- FPS, via `cl_showfps 1` — does the polling/exec loop cost visible
  framerate?
- Whether your own key binds still work normally while the loop is running.
- Whether typing in the in-game console (the backtick console) is undisturbed
  — i.e. the harness's own commands don't interleave with or clobber what you
  type there.
- Behavior across a map change that happens inside the demo (if the demo
  spans more than one map) — does the control loop keep re-executing and
  does playback control keep working afterwards?
- Behavior at the demo's end — does the loop end cleanly, error, or leave
  stray files/processes behind?

## Where results land

Each run (scripted or interactive) writes one JSON file to
`spikes/133-q2pro-control/results/<timestamp>.json`, containing per-command
latencies, position samples, CPU samples, logfile growth, and any duplicate
ACKs observed. `RESULT.md` in this same folder is the template where the
human-readable go/no-go verdict is written up from those numbers — it is not
generated automatically.
