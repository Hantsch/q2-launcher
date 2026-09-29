# Story 169 spike — result

Run on 2026-09-29 against the pinned Q2PRO build (`q2pro r3834~601a8df8`) at `C:\Games\Q2Pro`,
game `opentdm`, demo `test.dm2` (~41 s), Windows 11, 3840×2160 primary screen, `cl_maxfps 125`.

Evidence: `results/2026-09-29T14-05-16-147Z.json` (first full run) and
`results/2026-09-29T14-16-56-706Z.json` (full run incl. P4b), plus `stop-probe.mjs` runs quoted
below. All pixel values are physical pixels (the probe is DPI-aware).

## Verdict

**Go** for a launcher "stage": Q2PRO plays a demo as a borderless, always-on-top window the launcher
places, moves and toggles to fullscreen at runtime, all over story 164's existing control channel.

**But** the Windows control loop **starves every command the user issues inside the game** —
console typing, key binds (story 167's demo actions), menu actions — for as long as it runs. That is
why `quit` typed in-game does nothing. Stopping the loop releases them; a command queued behind the
loop (where a bind lands) can restart it.

## Findings

| # | Question | Result |
| --- | --- | --- |
| P1 | Launch windowed at a geometry | **Yes, exact.** `+set vid_fullscreen 0 +set win_noborder 1 +set win_notitle 1 +set win_alwaysontop 1 +set win_noresize 1 +set vid_geometry 960x540+200+150` → window and client both `960×540 @ 200,150`, no caption, topmost, foreground. |
| P2 | Do commands queued behind the loop run? | **No.** `+echo AFTERARG` (after `+exec` of the loop cfg) and a line after the loop call inside the loop cfg never run while the loop lives. Same path as typed console lines and binds (`Cbuf_AddText`, appended), while the loop re-inserts itself at the front every tick. |
| P3 | Local out-of-band `cmd` packet as a loop-free transport | **No.** Neither `ÿÿÿÿcmd\n<line>` nor `ÿÿÿÿcmd <line>` to `127.0.0.1:net_clientport` produced any reaction or log line. |
| P4 | Live `set vid_geometry` | **Yes.** `800x450+400+300` applied, window exactly there ~0.5 s after the write (control-loop latency). |
| P4b | Live `set win_alwaysontop` | **Yes.** 0 → topmost flag cleared, 1 → set again. |
| P5 | Keeps playing unfocused? | **Yes.** Another window foreground, the demo clock kept advancing (12.5 → 16.8 s in the sample window); window stayed topmost at its geometry. |
| P6 | Live `vid_fullscreen 1` / `0` | **Yes.** 1 → `3840×2160 @ 0,0` (~0.45 s ack); 0 → back to the last `vid_geometry` (`800×450 @ 400,300`), still borderless and topmost. |
| P7 | Console spam | **~13 `Execing q2l_ctl.cfg` + ~13 `POS …` lines per second** (wait 5 at ~65 command frames/s). They flood the console and the notify lines. |
| P8 | `quit` through the control file | **Yes**, the game exits within ~0.2–0.3 s. |
| P9 | Loop stop releases the queue (`stop-probe.mjs`) | **Yes.** `plain` (loop keeps running): `AFTERARG` never runs. `empty` (`alias q2l_loop ""`, production's `buildStopFile`) and `next` (stop through a second re-arm alias): the stop's own echo and the queued `AFTERARG` both run. |
| P10 | Restart from inside the game (`stop-probe.mjs restart`) | **Yes.** A queued `exec` of a cfg that re-arms the loop (what an in-game "back to window" bind would do) restarts it; the launcher's next control file is answered again. |
| P11 | Window close while the loop runs | **Yes.** `WM_CLOSE` (what Alt+F4 sends) ends Q2PRO gracefully even with the loop running. |

## Side findings

- **The logfile is buffered despite `logfile_flush 1`.** The last lines only reach the disk when more
  output follows or the engine exits cleanly; a killed engine loses the tail (logs end mid-line). The
  running loop's own POS output keeps it flowing, so story 164 does not notice; anything that stops
  the loop (fullscreen mode, story 172) must not rely on seeing a trailing ACK in the log.
- **Synthetic keystrokes do not reach Q2PRO** from a background process (neither `SendKeys` nor
  scancode `SendInput`), so "typed in-game" is proven through the identical queue position (P2/P9/P10),
  not through real key presses. The user's report (`quit` typed in-game does nothing) matches.
- A guarded command whose line contains `"` breaks the `if … then "…"` guard — story 166's
  per-command cfg already avoids that; the spike harness uses the same route.

## Consequences for the stories

- Windowed stage is the default (170, 171); fullscreen is a deliberate choice (172).
- In fullscreen the launcher **stops the loop**, so binds, the console and `quit` work; a new
  bindable "back to window" action runs `vid_fullscreen 0` and re-arms the loop (172).
- In the windowed stage the game's own console and binds stay starved — the launcher needs its own
  way to end the demo (173), and must say visibly that in-game typing does not reach the game there.
- Presses queued while the loop ran fire all at once when it stops — open question for 172.
- The console spam needs its own story (174).
- Linux (stdin channel, no loop) has no starvation; window placement there is unverified (X11
  expected to work, Wayland cannot position windows) — 170's parity question.
