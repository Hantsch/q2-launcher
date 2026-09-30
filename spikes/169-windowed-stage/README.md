# Story 169 spike — Q2PRO on the launcher's stage

Throwaway spike, outside `src/`, not wired into any build or test. Result: [RESULT.md](RESULT.md).

- `harness.mjs [q2pro.exe] [game] [demo]` — one run over probes P1–P8 (windowed launch geometry,
  starvation of queued commands, OOB `cmd`, live geometry/topmost/fullscreen, unfocused playback,
  console spam rate, `quit`). Defaults: `C:/Games/Q2Pro/q2pro.exe`, `opentdm`, `test.dm2`. Opens a
  game window for ~40 s and switches it to fullscreen once. Writes `results/<timestamp>.json`.
- `stop-probe.mjs <plain|empty|noop|unalias|next|restart>` — how the control loop can be stopped so
  queued commands run, and whether a queued `exec` restarts it (P9/P10).
- `win-probe.ps1 -ProcessId <pid> [-Activate <pid>]` — DPI-aware window rect / topmost / foreground
  probe used by the harness.

Every run removes its own cfg files from the game dir; the logfile is `<game>/logs/q2l_s169.log`.
