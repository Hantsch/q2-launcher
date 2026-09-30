---
id: 186
title: a spike proves a launcher overlay can sit over the game
status: done # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

The user wants a third way to watch a demo, **cinema mode**: the game fills the whole screen and the
launcher lays its own controls over it, like a video player — timeline, play/pause, jumps, speed,
leave. Today there are only the small **preview** on the Demos view's stage ([[170]]) and the real
**fullscreen**, where the launcher lets go and only in-game keys steer ([[172]]).

Cinema mode would be the stage stretched over the whole display (borderless, `vid_fullscreen 0`, so
the control loop keeps running and the launcher keeps control) plus a second, transparent,
frameless Electron window on top of it. The mechanism has two parts nobody has tried against the
real engine: whether a launcher window stays **above** a `win_alwaysontop` Q2PRO, and whether it can
take the mouse and keyboard without the game minimising, stuttering or grabbing the cursor.

This story is a **spike**: its result is a decision, not product code.

The approach to test first: the overlay **covers the whole display and takes all input**, so the
game window is never clicked and never gets focus back — mouse movement and keys arrive in the
overlay's own DOM, and the question of the game raising itself above the overlay does not arise.

## Acceptance Criteria

- [x] **AC1** — The recorded result states whether Q2PRO, started borderless and topmost at the full
      geometry of one display, covers that display completely, taskbar included.
- [x] **AC2** — The recorded result states whether a transparent, frameless, always-on-top Electron
      window opened afterwards on that display stays above the game, and what (if anything) puts the
      game back in front of it — focus changes, Alt+Tab, a live `vid_geometry` or `win_alwaysontop`.
- [x] **AC3** — The recorded result states whether the game keeps playing smoothly while the overlay
      has focus and is shown, faded out and shown again, and whether the game ever minimises.
- [x] **AC4** — The recorded result states whether the overlay receives mouse movement, clicks and
      key presses over the game's area, and whether the cursor is visible there.
- [x] **AC5** — The recorded result states whether the display's geometry in physical pixels is
      correct on a scaled display (e.g. 125 %/150 %) and on a secondary monitor, for every such
      configuration the machine has as it is; a configuration it does not have (no second monitor,
      no scaled display) is recorded as not checked, with the reason.
- [x] **AC6** — The recorded result states the same for Linux on X11 where a Linux Q2PRO ([[102]])
      and an X11 session are available, or records that it was not checked and why.
- [x] **AC7** — The recorded result ends in go/no-go and names the stories that follow.

## Open Questions

- [x] **Q1 — Display configurations for AC5:** the run uses the machine as it is, with no hand steps
      (no scaling changes, no monitor plugged in). Whatever it lacks is recorded as not checked;
      AC5 carries that escape clause. (Answered 2026-09-30.)

## Decisions

- **No hand steps.** The agent runs the harness itself on the native Windows session. Input is
  injected with `SendInput`. That is the same input queue real hardware uses, so it is a fair test
  of whether the overlay's DOM gets events. [[169]]'s finding that synthetic keys do not reach
  Q2PRO is about the engine, not about the overlay. The result states that no real hand was on the
  mouse.
- **The harness is an Electron main process** (`npx electron spikes/186-cinema-overlay/harness.mjs`),
  so it has `screen` for display geometry and can open the overlay itself. The overlay reports its
  DOM events through `webContents`' `console-message` event: no preload, no `nodeIntegration`.
- **Linux (AC6)** is expected to be recorded as not checked: [[102]] (a Linux Q2PRO) is still
  `draft`, and this machine has no X11 session.

## Plan

This is a throwaway harness in `spikes/186-cinema-overlay/`, outside `src/`, and nothing imports
it. It follows [[169]]: the same launch arguments and control-file loop (copy what it needs out of
`spikes/169-windowed-stage/harness.mjs`, do not import it), and the same engine (`C:\Games\Q2Pro`,
game `opentdm`, `test.dm2`). The game always ends with `WM_CLOSE`, never a kill, because the
logfile only flushes on a clean exit. Every run removes its own cfg files.

Probes, one run, written to `results/<timestamp>.json` with screenshots:

- **P1 (AC1): the display, covered.** Launch borderless and topmost with `vid_fullscreen 0` at the
  launcher display's **physical** rect (`screen.dipToScreenRect`). Check that the game rect equals
  the display rect. Check with `WindowFromPoint` that the game, not `Shell_TrayWnd`, owns a point in
  the taskbar band. Take a screenshot.
- **P2 (AC2): the overlay stays on top.** Open a frameless, transparent `BrowserWindow` on that
  display at `alwaysOnTop 'screen-saver'`, full bounds, and focus it. Check that `WindowFromPoint`
  returns the overlay at the centre and all four corners. Run two variants: a fully transparent
  background, and one at `rgba(0,0,0,0.01)`. On Windows, a pixel with alpha 0 may let the click
  through to the game.
- **P3 (AC2): what brings the game back in front.** Run four perturbations in turn: another window
  takes focus and the overlay gets it back, Alt+Tab (`SendInput`), a live `vid_geometry` resend,
  and a live `win_alwaysontop 0` then `1`. After each one, record who owns the centre point,
  whether the game is foreground, and whether it is `IsIconic`.
- **P4 (AC3): the game keeps playing.** Hold three 10 s phases: overlay shown and focused, controls
  faded (CSS opacity 0), controls shown again. In each phase, measure the demo-clock rate from the
  loop's `POS` lines against the wall clock, the longest gap between them, and a render fps if the
  build has an fps macro. Sample `IsIconic` every 250 ms.
- **P5 (AC4): the overlay takes input.** Use `SendInput` to move the mouse across the game area,
  left-click, and press a few keys. Record what the overlay logged. Record `GetCursorInfo`
  (`CURSOR_SHOWING`) over the game area, and `GetClipCursor` against the virtual screen, which
  shows whether the game has trapped the cursor.
- **P6 (AC5): the geometry on every display.** Record every display's `scaleFactor` and physical
  rect. Repeat P1's geometry check on every display present. Record any configuration the machine
  lacks as not checked.

`RESULT.md` then brings it together: the verdict, a findings table (P1–P6 plus Linux), side
findings, what follows for [[187]] (including input for its Q3/Q4), go/no-go, and the next stories.

## Deliverables

- [x] **D1: the harness.** `spikes/186-cinema-overlay/harness.mjs` (the Electron main process,
      probes P1–P6 as in the Plan), `overlay.html` (the transparent overlay: a dummy control bar
      whose opacity can fade, and `console.log` of every `mousemove`/`mousedown`/`keydown` as JSON),
      `win-probe.ps1` (mirror `spikes/169-windowed-stage/win-probe.ps1`, adding `WindowFromPoint` →
      owning pid, `IsIconic`, `GetCursorInfo`, `GetClipCursor`, and `SendInput` for mouse
      move/click/keys/Alt+Tab), and `README.md` (usage, mirror 169's). Acceptance: one run
      completes, ends the game with `WM_CLOSE`, leaves no cfg files in the game dir, and writes a
      results JSON that answers P1–P6.
- [x] **D2: the result.** `spikes/186-cinema-overlay/RESULT.md`, mirroring
      `spikes/169-windowed-stage/RESULT.md`: run conditions (build, displays with scale factors),
      a verdict, a findings table with one row per P1–P6 plus a Linux row (not checked, and why),
      side findings, consequences for [[187]], and **go/no-go with the follow-up stories named**.
      The `results/*.json` and screenshots it cites are kept. Acceptance: every AC1–AC7 question has
      an explicit answer, or an explicit "not checked" with its reason.

## Model Hints

Both deliverables run on the default tier.

Review: → default

## Acceptance Tests

- AC1–AC7 → **manual residue:** these are recorded findings from a spike against a real Q2PRO
  binary and a real desktop (window z-order, focus, DPI), which no test harness can reproduce. The
  evidence is `spikes/186-cinema-overlay/RESULT.md` and its `results/*.json` and screenshots:
  - AC1 → P1 row
  - AC2 → P2 and P3 rows
  - AC3 → P4 row
  - AC4 → P5 row
  - AC5 → P6 row
  - AC6 → the Linux row
  - AC7 → the verdict and the follow-ups

## Done

Spike run once on the native Windows session (3 displays, primary 3840x2160 @150%). Harness, overlay page, probe script and RESULT.md live in `spikes/186-cinema-overlay/` with the kept `results/2026-09-30T12-17-40-155Z.json` and screenshots. Verdict: go for the Windows primary display; caveats and five unnumbered follow-ups are in RESULT.md.

Commit message: `186: spike - transparent overlay over borderless full-display Q2PRO (go, Windows primary)`

Verification: narrow gate — `npm run typecheck` green, `npx vitest run --changed HEAD` green (no test files affected; change is spikes/ + docs only). No e2e flow (spike, no product code). No cfg files or stray processes left; game ended with WM_CLOSE. Changelog: none (no user-facing change).
Review (default tier): first pass UNCLEAR — RESULT.md overclaimed (no-op `vid_geometry` resend, overlay focus in P4 unproven, 250 ms poll floor on gap measure, cursor-clip artifact, P6 DPI pattern, leftover Q3/Q4 admission). All fixed in RESULT.md (text only, no harness re-run); not re-reviewed, 1 cycle.
AC to evidence (all `manual residue`, real engine + desktop): AC1 P1 row, AC2 P2+P3 rows, AC3 P4 row (focus not established), AC4 P5 row, AC5 P6 row (fresh launch on a secondary not checked), AC6 Linux row (not checked: story 102 draft, no X11), AC7 verdict + follow-ups.
Open: P4 never sampled foreground; keyboard focus over the game is unestablished — a follow-up story should measure it.

tiers: D 2 / hard 0 · review default · cycles 1 · agents 6
