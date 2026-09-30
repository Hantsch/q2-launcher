# Story 186 spike — result

Run on 2026-09-30 (single run, one machine) against the pinned Q2PRO build (`q2pro r3834~601a8df8`,
Dec 11 2025) at `C:\Games\Q2Pro`, game `opentdm`, demo `test-demo-for-launcher.dm2`, Windows 11,
Electron 43.4.0, `cl_maxfps 125`. Three displays: primary 3840×2160 at **150 %** scale
(`0,0`, 2560×1440 DIP) and two secondary 2560×1440 displays at scale **1** (physical `3840,391` and
`-2560,378`). All pixel values are physical pixels (the probe is DPI-aware).

**No real hand was on the mouse.** All mouse and key input in P5 was injected with `SendInput`
(harness → `win-probe.ps1`). `SendInput` feeds the same input queue as hardware, so the overlay's
DOM saw genuine `mousemove`/`mousedown`/`keydown` events. The engine-side limit from story 169
(synthetic keystrokes never reach Q2PRO) is irrelevant here: the question is whether the *overlay's*
DOM receives input, not the game. Whether a real mouse behaves identically was not checked.

Evidence: `results/2026-09-30T12-17-40-155Z.json` (the only run), screenshots
`results/2026-09-30T12-17-40-155Z-P1-game.png`, `…-P2-transparent.png`, `…-P2-dim.png`,
`…-P5-after-input.png`. Harness: `harness.mjs`, `overlay.html`, `win-probe.ps1` (see `README.md`).

## Verdict

**Go, for the primary display on Windows.** A transparent, frameless, always-on-top Electron window
placed over a borderless full-display Q2PRO wins hit-testing over the game at the centre and all four
corners, receives mouse and keyboard, shows the cursor, and the demo keeps playing at ~60 fps while
the game never holds focus and is never minimised.

**But** these are not solved and must not be assumed away: (1) the overlay stays on top only as
long as nobody re-asserts the game's topmost flag — a live `set win_alwaysontop 1` put the game back
in front (P3); (2) the live `vid_geometry` route put the game at the wrong rect on both secondary
displays (P6), so multi-monitor placement needs its own answer; (3) **keyboard focus was not
established as held**: after P3 the foreground was another app and P4 does not sample it, so "the
overlay has focus during playback" is unproven (see P4). Linux is not checked. The go rests on what
was measured: overlay topmost and hit-test owner (P2), game playing under a shown topmost overlay
(P4), overlay DOM receiving injected input (P5).

## Findings

| # | Question (AC) | Result |
| --- | --- | --- |
| P1 | Game covers the display (AC1) | **Yes, exact.** `vid_geometry 3840x2160+0+0` with borderless/no-title/always-on-top → game rect `0,0 3840×2160` == the display's physical rect, topmost, no caption. It also owns the point in the taskbar band (`1920,2124`, taskbar at y 2088–2160), i.e. it covers the taskbar. Screenshot `…-P1-game.png`. |
| P2 | Overlay on top of the game (AC2) | **Yes.** Overlay rect `0,0 3840×2160`; `WindowFromPoint` owner is the overlay at centre and all four corners, for both a fully transparent background and `rgba(0,0,0,0.01)`. Transparent alone is enough (no near-invisible fill needed); the harness kept `fullyTransparent`. Overlay foreground, topmost, not captioned, not iconic. Screenshots `…-P2-transparent.png`, `…-P2-dim.png`. |
| P3 | What brings the game back in front (AC2) | **Only a live `win_alwaysontop 1` — among the perturbations tried, which are weaker than the wording suggests.** Overlay stayed the centre hit-test owner after: another app taking focus (VS Code, pid 26372), `overlay.focus()`, Alt+Tab, Alt+Tab + refocus, a live `set vid_geometry` re-send, and `win_alwaysontop 0`. Caveats: the "`vid_geometry` re-send" sent the **identical** geometry the game already had (harness `geo(D)`), so it is effectively a no-op and "did not reorder" is proven only for a no-op; and `gameIsForeground` was false in every step, so Alt+Tab and the focus steal ran while the game was never foreground and **cannot show whether the game re-raises itself** when it is activated. P6's live moves to other rects did not record z-order at all. After `win_alwaysontop 1` the **game owned the centre** (both windows topmost, game placed above); an overlay refocus restored the overlay. The game was never foreground and never iconic in any step. After Alt+Tab the foreground stayed with the other app and `overlay.focus()` did **not** regain it (steps `afterAltTab+overlayRefocus`, `afterFinalOverlayRefocus`) — yet the overlay still owned hit-testing, because topmost, not focus, decides that. |
| P4 | Game keeps playing, never minimises (AC3) | **Yes for a shown, topmost overlay; focus not established.** Never iconic and never invisible (0/38 samples in each phase). ~60 fps mean (59.4 / 60 / 60). Longest gap between `POS` lines 267–284 ms — this sits at the harness's own 250 ms poll cadence (`pollLog` stamps a whole batch with one time), so only stalls above ~270 ms are detectable; shorter hitches are invisible to this measurement. The phase is labelled "overlay shown and focused" (`overlayShownFocused`) but focus was **not confirmed**: after P3 the foreground was another app (`afterFinalOverlayRefocus`: foreground `other:26372`) and P4 does not sample foreground. AC3's "while the overlay has focus" is therefore unproven; what was measured is smoothness with the overlay topmost and shown. Fading the control bar to opacity 0 and back had no effect on any of these. Demo clock: 1.14 / 1.03 / 1.03 demo-s per wall-s — see the caveat below. |
| P5 | Overlay gets mouse and keys, cursor visible (AC4) | **Yes.** Overlay logged 7 `mousemove`, 1 `mousedown`, 3 `keydown` (`KeyA`, `KeyW`, `Space`) for the injected input; the cursor stayed visible (`showing: true`, not hidden) over the game area. **Cursor clip:** before the input the clip was `0,0 3840×2160` (the primary only); afterwards `-2560,0 8960×2160`, which is exactly the union of the three displays' physical rects from Electron (x −2560…6400, y 0…2160), i.e. the cursor was simply unclipped. Nothing here shows the pointer being trapped or mis-clipped. The "virtual screen" reference (`-3840,0 13440×2747`) is unreliable: it is exactly 1.5× the true union (8960 → 13440, x −2560 → −3840, 1831 → 2747), the primary's scale. `win-probe.ps1` calls `SetProcessDPIAware()` (line 67) yet `GetSystemMetrics` still returned scaled values, so why is unresolved; the `clipIsFullVirtualScreen: false` flag in the JSON is an artifact of it. Not measured: whether the game grabs the cursor during play (the pre-input clip to the primary suggests something did, and it was released by the time of the after-input read; who did what was not established). Screenshot `…-P5-after-input.png`. |
| P6 | Geometry on scaled and secondary displays (AC5) | **Primary exact, secondary wrong.** Re-applying the primary geometry live: game rect == display (`0,0 3840×2160`). Live `vid_geometry` to the secondary at `3840,391` (2560×1440): game landed at `5760,587 3840×2160`. That is exactly the requested position and size × 1.5 (3840→5760, 391→586.5≈587, 2560×1440→3840×2160), the primary's scale: a DPI-scaling effect of the live route (the request was treated as DIPs of the primary), not just "a wrong rect". To the secondary at `-2560,378`: game landed at `0,0 2560×1440`: size as requested (not ×1.5), position on the primary. That is **not** consistent with the ×1.5 explanation (which would give `-3840,567 3840×2160`); a clamp of the negative position or dependence on the window's previous placement (it started this step at `5760,587`) are candidates but neither was tested, so this landing is unexplained. Neither equals its display. **Not checked:** a fresh launch with the geometry on a secondary display (only the live route was tried); a secondary display with a scale other than 1; overlay placement on a secondary (the overlay was only placed on the primary). |
| Linux | X11 (AC6) | **Not checked.** Story 102 (Linux Q2PRO) is still draft and there is no X11 session on this machine. Wayland expected to be unable to place or stack windows this way; unverified. |

### Demo-clock rate (P4)

The three windows measured 1.14, 1.03 and 1.03 demo-s per wall-s, i.e. the demo clock ran up to 14 %
*faster* than the wall clock. The JSON does not show why, and nothing in the harness sets
`timescale`. What is known: `cl_demopos` is read with 0.1 s resolution and the timestamps are when
the harness read the (buffered) logfile lines, so over a ~10 s window the quantisation and batching
error is a few percent — enough to explain 1.03, **not** 1.14. The 1.14 window is the first one, right
after the `demo` restart (`demoFrom` 0.3 s); a start-up catch-up burst is plausible but not measured.
Read this as "playback was not slowed or stalled by the overlay in any phase", not as a measured
playback rate. A stall would show as a rate well below 1 or a large `longestGapMs`; neither occurred.

## Side findings

- **Cursor clip changed from primary-only to unclipped.** Before input the clip was the primary
  (`0,0 3840×2160`); after it was `-2560,0 8960×2160`, the union of all displays, i.e. no clip. Who
  changed it was not established. Cinema mode should not assume the pointer stays confined to the
  game display, but nothing showed a wrong clip; the "virtual screen" metric it was compared with is
  a DPI artifact (P5).
- **Overlay is topmost but not foreground after Alt+Tab.** `overlay.focus()` did not regain
  foreground from another app in this session; keyboard input would then go to that app, not the
  overlay. Mouse hit-testing was unaffected.
- **`win_alwaysontop 1` is the one game-side switch observed to reorder.** An identical-geometry
  `vid_geometry` re-send, focus changes and Alt+Tab did not, but those tests are weak (see P3). Any launcher command that re-sends the window flags mid-playback (e.g. restoring
  the windowed stage from story 169) will lift the game over the overlay.
- Harness limits: single run; `launcherDisplayNote` — the harness is standalone, so "the launcher
  display" was simply the primary. Only one Electron version and one Q2PRO build.

## Consequences for story 187 (cinema mode)

- **Overlay window recipe that worked:** frameless, transparent, `alwaysOnTop`, `skipTaskbar`,
  `focusable: true`, no preload, no nodeIntegration, sized to the display's **physical** rect.
- **Focus/cursor handling (evidence for story 187's open questions Q3/Q4):**
  - **Q3 (click on the picture, double-click):** a click over the picture lands in the overlay, not
    the game (the overlay owns hit-testing at the centre and corners; 1 `mousedown` and 7
    `mousemove` logged in P5), so play/pause-on-click is implementable in the overlay's DOM and
    "nothing" is just as easy. Double-click was not tested. Injected input only.
  - **Q4 (launcher window in cinema mode):** the spike did not involve the launcher window (the
    harness is standalone). Evidence: a topmost overlay over a topmost borderless game stayed the
    hit-test owner while another, non-topmost app took focus (P3), so a launcher window left behind
    on that display stays covered without minimising. Not tested: the launcher itself, minimise/
    restore, a launcher on another display.
  - **Focus and keys:** the overlay does not need focus to be on top or to receive mouse hit-testing;
    it received injected keys in P5, but `overlay.focus()` did not regain foreground from another
    app in P3, and focus during P4 playback was not sampled. Cinema mode should not depend on
    focus being recoverable and needs a visible cue when the overlay is not foreground. The pointer
    stays visible over the game with no extra work. The game is never focused, so in-game binds are moot in cinema mode
  (consistent with story 169's control loop starving them anyway).
- **Never send `win_alwaysontop 1`** while the overlay is up; if it is ever sent, re-raise the
  overlay afterwards (a refocus did this in the run).
- **Multi-monitor:** do not rely on live `vid_geometry` to move the game to a secondary display; cinema
  mode on the primary display only until a secondary-display route is proven.
- The overlay may be near-empty: a fully transparent background hit-tests as well as a 1 % fill.

## Go / no-go

**Go** for story 187 on the **Windows primary display**. **No-go / open** for secondary displays,
scaled secondaries, and Linux until the follow-ups below settle them.

Proposed follow-up stories (titles only, numbers unassigned):

1. *Cinema mode places the game on a secondary display* — fresh-launch geometry on a secondary
   display, including a scaled one, and the overlay placed to match.
2. *Cinema mode checks the cursor during play* — measure whether the game grabs/clips the pointer while the overlay is up (the pre-input clip was the primary only); the earlier "wrong clip" suspicion was a DPI-metric artifact.
3. *Cinema mode survives losing keyboard focus* — foreground recovery after Alt+Tab, plus a visible
   cue when the overlay is not foreground.
4. *Cinema mode on Linux* — depends on story 102; X11 first, Wayland stated as unavailable.
5. *The overlay is checked with a real mouse and keyboard* — confirm P5 without `SendInput`.

## Acceptance criteria

| AC | Answer |
| --- | --- |
| AC1 display covered | Answered (P1): yes, exact on the primary, including the taskbar band. |
| AC2 overlay on top / what brings the game back | Answered (P2, P3): overlay on top; only live `win_alwaysontop 1` lifted the game over it, but the identical-geometry re-send was a no-op and the game was never foreground during Alt+Tab/focus steal, so self-re-raise on activation is untested. |
| AC3 keeps playing, never minimises | Partly answered (P4): yes with the overlay topmost and shown; "while the overlay has focus" **unproven** (foreground not sampled, another app was foreground after P3); stalls under ~270 ms undetectable; rate figure carries the caveat above. |
| AC4 mouse, keys, cursor | Answered (P5): yes with injected input; cursor visible; clip went from primary-only to unclipped (not a defect). Focus during the input not separately established. Real hardware not checked. |
| AC5 scaled / secondary geometry | Partly answered (P6): primary exact, live route wrong on both secondaries (first landing = request × 1.5; second unexplained). Fresh launch on a secondary and overlay on a secondary **not checked** (not attempted). |
| AC6 Linux X11 | **Not checked**: story 102 draft, no X11 session here. |
| AC7 go/no-go + follow-ups | Answered above. |
