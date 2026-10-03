---
id: 198
title: the staged game stays on top on X11
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

A Linux tester on X11 reported that as soon as they use a launcher control while a demo plays on the
stage (pause, seek, speed, console command), the launcher comes to the front and the game window
disappears behind it — the stage shows only its "The demo plays here" placeholder. On Windows the
game stays on top of the launcher and is borderless; on X11 it must behave the same way.

Cause, verified against the Q2PRO source (upstream `nightly`, 2025-12-11): the stage relies on
`win_alwaysontop`, `win_noborder`, `win_notitle` and `win_noresize` ([[170]], `stage.ts`), and the
follower toggles `win_alwaysontop` with the launcher's focus ([[171]], `stage-follow.ts`). Those
cvars exist only in `src/windows/client.c`. The Linux video backends (`src/unix/video/x11.c`,
`sdl.c`) never read them; they only honour `vid_geometry`, by `XMoveResizeWindow`, which does not
raise the window. So on X11 the game is never on top and keeps its window-manager frame. Stories
[[170]], [[171]] and [[187]] all left X11 as "unverified against a real engine".

## Acceptance Criteria

- [ ] **AC1** — On X11, while a demo plays on the stage, using any launcher control (playback
      buttons, timeline, speed, console command, detail panel) leaves the game window visible on top
      of the launcher over the stage.
- [ ] **AC2** — On X11, the staged game window has no window-manager border or title bar, and its
      client area covers the stage rect exactly, as it does on Windows.
- [ ] **AC3** — On X11, when the launcher loses focus to another application, the game no longer
      sits above that application — the same rule the follower applies on Windows today
      (`win_alwaysontop` follows the launcher's focus).
- [ ] **AC4** — On X11, cinema mode ([[187]]) still shows its overlay above the game, and the
      overlay keeps mouse and keyboard.
- [ ] **AC5** — The window the launcher changes is only the game process main itself started for
      this session; no renderer-supplied value can point it at another window.
- [ ] **AC6** — If the launcher cannot reach the X server or cannot find the game window, the demo
      still plays, and the Demos view shows a visible-text reason (i18n key) saying the game could
      not be kept on top of the stage — never a silent failure.
- [ ] **AC7** — Windows behaviour is unchanged: nothing of this runs there, and the existing
      `win_*` launch args and follower lines stay as they are.
- [ ] **AC8** — Wayland behaviour is unchanged: the stage stays unavailable with its existing
      visible reason.

## Decisions

- **D1 — The launcher sets the window state itself over X11 (option 1 of the analysis), not
  through `wmctrl`/`xdotool` and not through a Q2PRO patch.** System tools are often not installed
  and would add a user-visible requirement; a patched Q2PRO conflicts with [[102]]'s "built from
  the same upstream source" rule and would not help users with their own Q2PRO. Main talks to the
  X server directly via a pure-JS X11 protocol client (candidate: the `x11` npm package), so there
  is no native build and no system dependency.
- **D2 — What the launcher sets:** `_NET_WM_STATE_ABOVE` added/removed through an EWMH
  `_NET_WM_STATE` client message to the root window (replaces `win_alwaysontop`), and
  `_MOTIF_WM_HINTS` with no decorations (replaces `win_noborder`/`win_notitle`). Placement stays
  with `vid_geometry`, which X11 already honours.
- **D3 — Finding the window:** Q2PRO's native X11 backend (`vid_x11`) sets only `WM_NAME`
  ("Q2PRO") and **no `_NET_WM_PID`**; the SDL backend does set `_NET_WM_PID`. A lookup by PID via
  `_NET_CLIENT_LIST` alone therefore misses the default Linux backend; see Q1.

## Decisions (Sprint)

- **(User)** Q1: Window lookup via X-Resource `XResQueryClientIds` (must satisfy AC5).
- **(User)** Q2: Hand-written minimal X11 client, no npm dependency.
- **(User)** Q4: Cinema ordering: raise the overlay after the game's pin.
- **(User)** Q5: No X11 machine/Xvfb harness: AC1-AC4 needing a real X server are manual residue; protocol logic is unit-tested. (Q3 park-geometry is unanswerable here: refine decides, residue if X-only.)

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1 — Window lookup:** how does main find the game's window reliably without `_NET_WM_PID`
      — the X-Resource extension (`XResQueryClientIds`, client → PID), `WM_NAME` matching among
      `_NET_CLIENT_LIST` restricted to windows that appeared after launch, or forcing a backend
      (`vid_driver sdl`) for staged sessions? Which one also satisfies AC5?
- [x] answered → Decisions (Sprint) — **Q2 — Library:** is the `x11` npm package maintained and small enough to vendor, or is a
      minimal hand-written client (connect, auth via `~/.Xauthority`, `InternAtom`, `GetProperty`,
      `ChangeProperty`, `SendEvent`) the safer choice?
- [ ] **Q3 — Parking off-screen:** does the follower's park geometry (beyond the virtual desktop's
      right edge, [[171]]) survive on X11 window managers, or do they clamp it on-screen?
- [x] answered → Decisions (Sprint) — **Q4 — Cinema ordering (AC4):** both the overlay (Electron `alwaysOnTop`) and the game would
      carry `_NET_WM_STATE_ABOVE`; which order rule keeps the overlay on top — raise order after
      the pin, or removing ABOVE from the game while the overlay is open?
- [x] answered → Decisions (Sprint) — **Q5 — Verification:** is there an X11 machine (the tester's, or an Xvfb + WM setup in CI) to
      turn AC1–AC4 from manual residue into a test against a real Q2PRO window?

## Plan

<!-- Filled by /refine 198. -->

## Deliverables

<!-- Filled by /refine 198. -->

## Model Hints

<!-- Filled by /refine 198. -->

## Acceptance Tests

<!-- Filled by /refine 198. -->

## Done

<!-- Filled by /build 198. -->
