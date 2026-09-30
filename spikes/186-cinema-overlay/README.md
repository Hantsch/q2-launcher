# Story 186 spike — launcher overlay over a borderless full-display Q2PRO

Throwaway spike, outside `src/`, not wired into any build or test. Nothing imports it.

- `npx electron spikes/186-cinema-overlay/harness.mjs [q2pro.exe] [game] [demo]` — one run over
  probes P1–P6 (borderless topmost game at the primary display's physical rect, transparent overlay
  hit-testing in two background variants, focus/Alt+Tab/live-geometry/topmost perturbations,
  playback with the overlay shown / controls faded / shown again, SendInput mouse+keys against the
  overlay, per-display geometry). Defaults: `C:/Games/Q2Pro/q2pro.exe`, `opentdm`, `test-demo-for-launcher.dm2`.
  Takes ~2 minutes, covers the primary display with a game window and an overlay, moves the mouse
  and types A/W/Space. Writes `results/<timestamp>.json` plus `results/<timestamp>-*.png`.
- `overlay.html` — the transparent overlay: dummy control bar (opacity can fade), every
  mousemove/mousedown/keydown logged as JSON via `console.log` (read by the harness through
  `console-message`; no preload, no nodeIntegration).
- `win-probe.ps1` — long-lived DPI-aware Win32 probe (one command per stdin line): window rect,
  topmost/foreground/iconic, WindowFromPoint owner, cursor + clip, SendInput, screenshots.

The game is ended with WM_CLOSE (the logfile is buffered; never kill). Every run removes its own cfg
files from the game dir; the logfile is `<game>/logs/q2l_s186.log`. Probes fail soft: an error is
recorded under the probe and the rest still run. Configurations the machine lacks are recorded as
"not checked" with the reason.
