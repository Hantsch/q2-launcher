# Sprint S33 — Testplan (manual residue only)

Only what cannot be automated. Everything else is covered by the tests listed in `review.md`.

## 1. Story 198 AC1–AC4 — the staged game on a real X11 window manager

**Why manual:** the keeper's protocol (X-Resource PID lookup, `_NET_WM_STATE_ABOVE`, `_MOTIF_WM_HINTS`,
`ConfigureWindow`) is unit-tested against spec bytes, and the failure path is proven by a flow. Whether a
real window manager honours it (game above the launcher, no frame, client area exactly on the stage rect,
blur lowering, overlay above the game) needs a real X server and WM. Decision Q5: no Xvfb harness.

**Preparation:**

- A Linux machine in an **X11** session (not Wayland) with a normal window manager, and the launcher
  started on it as the README describes.
- An installation with a Q2PRO engine and at least one demo in the Demos view.

**Steps:**

1. Open a demo in the Demos view so it plays on the stage (the game window sits over the stage area).
2. Click the playback buttons, drag the timeline, change the speed, send a console command, open the
   detail panel.
3. Look at the game window's edge and compare it with the stage rectangle.
4. Click another application so the launcher loses focus; then click back on the launcher.
5. Enter cinema mode and use the overlay with mouse and keyboard.
6. Drag or minimise the launcher while a demo plays, then bring it back.

**Expected:**

- Step 2: the game stays visible on top of the launcher over the stage after every control.
- Step 3: no frame or title bar; the game's client area covers the stage rect exactly.
- Step 4: while the launcher is unfocused the game no longer sits above the other application; clicking
  back puts it above the launcher again.
- Step 5: the overlay is shown above the game and keeps mouse and keyboard.
- Step 6 (park geometry, left open by design): the game is parked off-screen and returns to the stage;
  note whether the window manager clamps the parked window back on screen. A clamp is a finding for a
  follow-up, not a failure of this walk ([TD-023](../../TECH-DEBT.md)).
- If cinema is entered before the game window was found, the game may end up above the overlay once;
  note it as a finding (also [TD-023](../../TECH-DEBT.md)).
- If the window cannot be found or the X server cannot be reached, the demo still plays and the Demos view
  shows the visible "could not keep the game on top" reason (already proven by flow
  `replays-stage-x11-unreachable`; only mention it if seen here).
