---
id: 187
title: I watch a demo in cinema mode
status: done # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

Spike [[186]] ended in **go for the Windows primary display**
(`spikes/186-cinema-overlay/RESULT.md`). Its caveats shape the Decisions below.

A running demo has three ways to be watched, and I choose between them from the timeline:

- **Preview**: the demo plays small on the Demos view's stage, the timeline beneath it, as today
  ([[170]]).
- **Cinema mode** (new): the demo fills the whole screen, and the launcher lays its controls over it
  like a video player. I steer it with the mouse over those controls, without leaving the picture.
- **Fullscreen**: the game's real fullscreen, where only in-game keys and the console steer it, as
  today ([[172]]).

In cinema mode the controls appear when I move the mouse and fade out when I leave it still, like a
video player's. Leaving cinema mode returns the demo to the preview.

## Acceptance Criteria

- [x] **AC1** — The timeline offers the three modes (preview, cinema mode, fullscreen) with visible
      labels (i18n keys); the current mode is recognisable without relying on colour alone.
- [x] **AC2** — Choosing cinema mode moves the running demo over the whole display the launcher window
      is on, without restarting playback.
- [x] **AC3** — In cinema mode an overlay shows position/duration, click-to-seek, play/pause, ±jump,
      speed, fullscreen and a "leave cinema mode" control; each acts on the running demo the way the
      timeline does.
- [x] **AC4** — The overlay's controls appear when the mouse moves and fade out after a few seconds
      without movement (the delay is fixed in Decisions); they stay visible while the pointer rests on
      them or the demo is paused.
- [x] **AC5** — While the overlay has focus, keys steer the demo like a video player (the key set is
      fixed in Decisions), and Esc leaves cinema mode.
- [x] **AC6** — Leaving cinema mode returns the demo to the preview at the stage's current geometry,
      and the timeline in the launcher works again.
- [x] **AC7** — Choosing fullscreen from cinema mode enters [[172]]'s fullscreen; its "back to
      window" action returns to the preview.
- [x] **AC8** — When the demo ends or the game exits while in cinema mode, the overlay closes and the
      launcher shows the ended state as today.
- [x] **AC9** — Where the stage is unavailable (Wayland, [[170]]), the cinema-mode control stays
      visible, is disabled and says why as visible text (i18n key).
- [x] **AC10** — When the launcher window is not on the primary display, the cinema-mode control
      stays visible, is disabled and says why as visible text (i18n key) (Decision D-Display).

## Open Questions

- [x] **Q1 — Fade-out delay:** 3 s. (Answered 2026-09-30.)
- [x] **Q2 — Keys in the overlay:** the video-player set, see Decisions. (Answered 2026-09-30.)
- [x] **Q3 — A click on the picture:** nothing, beyond showing the controls; the same goes for a
      double-click. (Answered 2026-09-30.)
- [x] **Q4 — The launcher window:** stays where it is, covered, not minimised. (Answered 2026-09-30.)
- [x] **Q5 — The console-command field:** preview only. (Answered 2026-09-30.)
- [x] **Q6 — The launcher on a secondary display:** the cinema control is disabled with a visible
      reason (AC10). (Answered 2026-09-30.)
- [x] **Q7 — Linux:** try it on X11, unverified against a real engine; only Wayland is disabled
      (AC9). (Answered 2026-09-30.)

## Decisions

- **Fade:** the controls hide after `CINEMA_IDLE_MS = 3000` without mouse movement or a key press.
  They stay while the pointer rests on the control bar or the demo is paused.
- **Keys (overlay has focus):** Space or K toggles pause. ←/→ jump ±10 s, Shift+←/→ jump ±60 s.
  `,`/`.` step to the next slower/faster `SPEED_STEPS` value. F enters fullscreen and Esc leaves
  cinema mode. Every key also shows the controls.
- **A click or double-click on the picture** only shows the controls.
- **The launcher window** is left where it is. The spike showed that a covered window stays
  covered; minimising it would trigger the stage follower's park.
- **The console field** ([[166]]) is preview-only.
- **D-Display:** cinema mode fills the **primary** display only (spike P6: live `vid_geometry` to a
  secondary display lands wrong). A launcher on any other display disables the control, with a
  visible reason (follow-up: the spike's follow-up #1).
- **Linux:** X11 is attempted but not verified against a real engine (the spike's follow-up #4, after
  [[102]]). Wayland reuses `replays.stage.unavailable.wayland`.
- **Never `win_alwaysontop 1` while the overlay is up** (spike P3). Cinema pins the stage follower
  to the display rect, so the follower stays the single writer of `vid_geometry` and sends no
  topmost flag while pinned.
- **Cinema is launcher-side:** the game stays windowed (`vid_fullscreen 0`). The playback channels'
  `'stage' | 'fullscreen'` state machine is untouched. The mode shown is fullscreen if the channel
  is fullscreen, else cinema if the overlay is open, else preview.
- **The overlay window is a shell service.** Modules never touch `BrowserWindow`
  (ARCHITECTURE.md "Adding a module" step 3), so the window is exposed to the replays module as a
  narrow `app.cinemaWindow` service, like the main-window observer. It is not a module
  editing the shell for itself.
- **The overlay reuses the existing preload and CSP.** Module events are already broadcast to every
  window (`src/main/services/broadcast.ts`). The overlay gains no privilege over the main window.
- **Out of scope:** recovering focus after Alt+Tab, and a cue when the overlay is not in the
  foreground (the spike's follow-up #3). A real-mouse check (#5) and cursor grab (#2) are also out.

## Plan

Order: shared pure → main pure → overlay entry → window service → main wiring → launcher UI →
overlay UI. The first four Ds only add code nobody calls yet; D5 wires it, and D6/D7 make it
reachable and carry the e2e flows.

1. **D1 shared:** `src/shared/replays/cinema.ts` — idle delay, key → timeline-action map, speed
   step up/down, availability type.
2. **D2 main pure:** `cinema.ts` (availability + physical display rect, harness knob
   `Q2L_UI_CINEMA_DISPLAY`), and a follower `pin(geometry|null)` that freezes the topmost flag.
3. **D3 overlay entry:** second electron-vite renderer input `cinema.html` plus a transparent boot
   root.
4. **D4 window service:** `src/main/cinema-window.ts` (the spike's recipe) behind `app.cinemaWindow`;
   the window hardening is extracted from `window.ts` and shared.
5. **D5 main wiring (hard):** contract (`playback.cinema`, `playback.display.read`, grown display
   event incl. speed and cinema availability), `cinema-controller.ts`, and the `playback-control`
   state hook. Fullscreen-from-cinema closes the overlay; session end closes it.
6. **D6 launcher UI:** a three-mode switch on the timeline, disabled with a reason; the harness
   `waitForWindow`; flows for entering and for unavailable.
7. **D7 overlay UI:** control bar, idle fade, keys; flows for the controls, leaving, and
   fullscreen-from-cinema.

Regression gate before D6's flows: `replays-stage*`, `replays-fullscreen` and `replays-timeline*`
must stay green (D5 changes the display event every session emits, and moves speed into main).

## Deliverables

- [x] **D1 — shared cinema rules.** New `src/shared/replays/cinema.ts` + `cinema.test.ts`, mirroring
      `src/shared/replays/timeline.ts`. No node/DOM/electron imports.
      - `CINEMA_IDLE_MS = 3000`.
      - `cinemaKeyAction(event: {key, code, shiftKey})` returns a `TimelineAction`
        (`timelineActionSchema` from `timeline.ts`), `{kind:'leave'}` or `null`: Space/K →
        `togglePause`, ←/→ → `jump ∓/±10`, Shift+←/→ → `jump ∓/±60`, `,`/`.` → `speed` at the
        next slower/faster `SPEED_STEPS` value given the current speed (clamped at the ends), F →
        `fullscreen`, Esc → leave.
      - `CinemaAvailability = {available:true} | {available:false, reason:{key:string}}`.
      Tests: `cinema.test.ts` › "every overlay key maps to its timeline action", "speed steps clamp
      at 0.25 and 4", "unmapped keys map to nothing".
- [x] **D2 — main pure pieces + follower pin.** New `src/main/modules/replays/cinema.ts` +
      `cinema.test.ts`, mirroring `stage.ts` (its `stageAvailability` and the `Q2L_UI_SESSION_TYPE`
      harness knob at `stage.ts:29`).
      - `cinemaAvailability({stageReason, onPrimary})` returns `CinemaAvailability` (D1's
        `src/shared/replays/cinema.ts`): a stage reason → that key (Wayland reuses
        `replays.stage.unavailable.wayland`); off primary → `replays.cinema.unavailable.notPrimaryDisplay`.
      - `displayGeometry(physicalRect)` returns a `WxH+X+Y` string, like `stageGeometry`.
      - `Q2L_UI_CINEMA_DISPLAY=primary|secondary`, honoured only with `Q2L_UI_HARNESS`, overrides
        `onPrimary`. The harness parks the launcher window off every display.
      - In `stage-follow.ts` (l.77-96) add `pin(geometry|null)` and pass it through
        `stage-follow-session.ts` (l.44). While pinned the follower sends only
        `set vid_geometry <pin>`, freezes `desiredTop` (never `set win_alwaysontop`, l.81) and
        ignores main-window focus and blur. `pin(null)` re-sends the current stage geometry,
        because `sentGeo` is now the cinema rect.
      Tests: `cinema.test.ts` › "availability prefers the stage reason, then the display",
      "the harness knob only applies under Q2L_UI_HARNESS"; `stage-follow.test.ts` › "a pinned
      follower sends the pin geometry and never win_alwaysontop", "unpinning re-sends the stage
      geometry".
- [x] **D3 — overlay renderer entry.** `electron.vite.config.ts` (l.57: a second `rollupOptions.input`
      `cinema`), new `src/renderer/cinema.html` (mirror `src/renderer/index.html`) and new
      `src/renderer/src/cinema/main.tsx`. `main.tsx` boots i18n the way `src/renderer/src/main.tsx:22`
      does and renders an empty root. `html` and `body` are **transparent**, and the app background
      `#0b0b0d` is not imported. Acceptance: `npm run build` emits `out/renderer/cinema.html` and
      `npm run typecheck` is green. The e2e flows in D6 load it.
- [x] **D4 — cinema window shell service.**
      - New `src/main/cinema-window.ts` + `cinema-window.test.ts`, mirroring `src/main/window.ts:139-262`
        and the spike recipe (`spikes/186-cinema-overlay/harness.mjs:122-134,180`).
      - The window is frameless, `transparent`, `skipTaskbar`, `setAlwaysOnTop(true,'screen-saver')`,
        and sized to the primary display's DIP `bounds`. It uses the **same preload and
        webPreferences** as the main window (contextIsolation, sandbox, no nodeIntegration).
      - Under `Q2L_UI_HARNESS` it is `focusable:false`, shown inactive and placed off-screen, like the
        main window at `window.ts:153/252`.
      - Extract the window-open handler and the will-navigate guard (`window.ts:223-241`) into a
        shared `hardenWebContents(win)` that both windows call.
      - Add `RENDERER_CINEMA_URL` next to `src/main/lib/renderer-source.ts:18` (dev:
        `${url}/cinema.html`), plus its test.
      - Expose `app.cinemaWindow = { open(), close(), isOpen(), onClosed(cb) }` in
        `src/main/context.ts`, wired in `src/main/index.ts`.
      - Document the service in `docs/ARCHITECTURE.md` (the "Decisions: shell service" rationale).
      Tests: `cinema-window.test.ts` › "the overlay window uses the main window's preload and
      webPreferences", "under the harness the overlay is not focusable";
      `renderer-source.test.ts` › "the cinema URL resolves in dev and production".
- [x] **D5 — main wiring: enter, leave, fullscreen, session end.**
      - `src/shared/modules/replays.ts`: handler `playbackCinema: 'playback.cinema'` with schema
        `{enter:boolean}.strict()`; handler `playbackDisplayRead`. `ReplaysPlaybackDisplay` (l.126)
        grows additively to `{fullscreen, cinema:boolean, speed, cinemaAvailability}`. Add both to
        `REPLAYS_HANDLER_SCHEMAS` (l.541).
      - New `src/main/modules/replays/cinema-controller.ts` + test, mirroring `playback-timeline.ts`.
        It is the single owner of "cinema open". **Enter:** check availability (refuse with its
        key), then `pin(displayGeometry(primary physical rect))`, then `app.cinemaWindow.open()`,
        in that order, so no focus change reaches the follower unpinned. **Leave** (handler,
        `onClosed`): close the overlay, then `pin(null)`.
      - `src/main/modules/replays/playback-control.ts` + test: `onStateChange` next to
        `onDisplayChange` (l.59). Speed is held in main (it is renderer-only today,
        `playback-store.ts:205`) and updated by `speed` timeline actions. The display event is
        emitted at l.189 and on cinema enter/leave.
      - `src/main/modules/replays/index.ts`:
        - Register the handlers (l.333-351).
        - Compute `onPrimary` and the physical rect next to `geometryAt` (l.253-263):
          `getDisplayMatching(win.getBounds()).id === getPrimaryDisplay().id`, and
          `dipToScreenRect(null, primary.bounds)` with the scaleFactor fallback.
        - Push availability when the main window moves (deduplicated).
        - Wrap `enterFullscreen` (l.342): when it succeeds from cinema, close the overlay and keep
          the pin; the follower is already suspended (l.281). Back to window gives display
          `'stage'`: unpin and resume, so the stage geometry is sent again.
        - `finished`: close and unpin. `ended`: close.
      Tests: `cinema-controller.test.ts` › "enter pins before opening the overlay", "enter
      refuses when unavailable", "the overlay closing leaves cinema and unpins", "fullscreen from
      cinema closes the overlay and back-to-window returns to the stage", "finished and ended close
      the overlay"; `playback-control.test.ts` › "the display event carries cinema, speed and
      availability".
- [x] **D6 — launcher mode switch + enter/unavailable flows.**
      - `src/renderer/src/modules/replays/components/DemoTimeline.tsx` (mirror its fullscreen button
        l.281-307 and the disabled-with-reason pattern l.45-52): replace the lone fullscreen button
        with a three-option radio group, Preview / Cinema / Fullscreen. Each option has a visible
        label and `aria-checked`; the current mode also carries a non-colour marker (check glyph /
        underline). Cinema uses `aria-disabled` and shows the visible reason text when
        unavailable. Choosing Cinema calls `playback.cinema {enter:true}`, and choosing Fullscreen
        keeps today's `fullscreen` timeline action.
      - `playback-store.ts` + test: mode, speed and cinemaAvailability from the display event.
      - `client.ts`: `playbackCinema`, `playbackDisplayRead`.
      - `src/renderer/src/i18n/locales/en.json`: the mode labels and
        `replays.cinema.unavailable.notPrimaryDisplay`.
      - `scripts/lib/harness.mjs`: `waitForWindow(app, 'cinema.html')`, which attaches the
        console/pageerror/CSP listeners of l.396-413. Pick windows by URL, not
        `getAllWindows()[0]`, in any helper this flow uses (`resize()` l.651).
      - New flows `scripts/flows/replays-cinema-enter.mjs` and `replays-cinema-unavailable.mjs`,
        mirroring `replays-stage-view-leave.mjs` (the `launchCount` check at l.180) and
        `replays-stage-unavailable.mjs`.
      Tests: `DemoTimeline.test.tsx` › "the timeline offers preview, cinema and fullscreen with
      the current mode marked", "cinema is disabled with its reason as visible text";
      `playback-store.test.ts` › "the display event sets mode, speed and cinema availability";
      the flows below.
- [x] **D7 — the overlay: controls, idle fade, keys + flows.**
      - Fill `src/renderer/src/cinema/main.tsx` with a new
        `src/renderer/src/modules/replays/cinema/CinemaOverlay.tsx` and `useIdleFade.ts` (+ tests),
        mirroring `DemoTimeline.tsx`'s controls.
      - The control bar shows position/duration, a click-to-seek bar, play/pause, ±10/±60, speed,
        fullscreen and "Leave cinema mode", all calling `playback.timeline`. Leave calls
        `playback.cinema {enter:false}`.
      - It boots from `playbackDisplayRead` and follows the position/display events.
      - `data-controls="visible|hidden"` sits on the overlay root. The controls hide after
        `CINEMA_IDLE_MS`, and stay while the bar is hovered or the demo is paused.
      - Keys go through D1's `cinemaKeyAction` and any key shows the controls. A click on the
        picture only shows the controls.
      - `en.json`: the overlay labels.
      - New flows `scripts/flows/replays-cinema.mjs` and `replays-cinema-fullscreen.mjs`, mirroring
        `replays-fullscreen.mjs`.
      Tests: `useIdleFade.test.ts` › "controls hide after 3 s idle and stay while hovered or
      paused"; `CinemaOverlay.test.tsx` › "each control sends its timeline action", "a click on the
      picture only shows the controls"; the flows below.

## Model Hints

D5 → deliverable-hard. D5 changes the display event that every stage and fullscreen session emits,
and it moves speed into main. It also orders pin → overlay open against main-window focus/blur, so
that the follower never sends `win_alwaysontop` while the overlay is up. Getting that order wrong
lifts the game over the overlay only on real hardware.

Review: → default (the no-topmost and stage-geometry-restored negatives are asserted by the flows
against the stub engine's window log).

## Acceptance Tests

- AC1 → unit `src/renderer/src/modules/replays/components/DemoTimeline.test.tsx` › "the timeline
  offers preview, cinema and fullscreen with the current mode marked"; e2e
  `scripts/flows/replays-cinema-enter.mjs` › "replays-cinema-enter" (labels visible, `aria-checked`
  moves to Cinema).
- AC2 → e2e `scripts/flows/replays-cinema-enter.mjs` › "replays-cinema-enter". It checks that the
  overlay window opens, that the stub's window log has exactly one `set vid_geometry` with the
  primary display's physical rect and no `win_alwaysontop`, and that `launchCount` is unchanged.
  Also unit `src/main/modules/replays/cinema-controller.test.ts` › "enter pins before opening the
  overlay".
- AC3 → e2e `scripts/flows/replays-cinema.mjs` › "replays-cinema". Clicking the overlay's seek bar,
  play/pause, ±jump and speed puts the matching commands in the command log, and Leave closes the
  overlay. Also unit `src/renderer/src/modules/replays/cinema/CinemaOverlay.test.tsx` › "each
  control sends its timeline action".
- AC4 → unit `src/renderer/src/modules/replays/cinema/useIdleFade.test.ts` › "controls hide after
  3 s idle and stay while hovered or paused"; e2e `scripts/flows/replays-cinema.mjs` ›
  "replays-cinema" (`data-controls` goes `hidden` after ~3.5 s, `visible` on mouse move, stays
  visible while paused).
- AC5 → unit `src/shared/replays/cinema.test.ts` › "every overlay key maps to its timeline action";
  e2e `scripts/flows/replays-cinema.mjs` › "replays-cinema" (Space, →, Shift+→ and `.` reach the
  command log; Esc closes the overlay).
- AC6 → e2e `scripts/flows/replays-cinema.mjs` › "replays-cinema". After leaving, the stub gets the
  stage geometry again and a launcher timeline click reaches the command log. Also unit
  `src/main/modules/replays/stage-follow.test.ts` › "unpinning re-sends the stage geometry".
- AC7 → e2e `scripts/flows/replays-cinema-fullscreen.mjs` › "replays-cinema-fullscreen" (F in the
  overlay → `vid_fullscreen 1`, the overlay closes; back to window → stage geometry, mode Preview);
  unit `cinema-controller.test.ts` › "fullscreen from cinema closes the overlay and back-to-window
  returns to the stage".
- AC8 → e2e `scripts/flows/replays-cinema-enter.mjs` › "replays-cinema-enter". The quit lever
  while in cinema closes the overlay window and the launcher shows the ended state. Also unit
  `cinema-controller.test.ts` › "finished and ended close the overlay".
- AC9 → e2e `scripts/flows/replays-cinema-unavailable.mjs` › "replays-cinema-unavailable" (under
  `Q2L_UI_SESSION_TYPE=wayland`, Cinema is visible, `aria-disabled` and shows the reason text); unit
  `DemoTimeline.test.tsx` › "cinema is disabled with its reason as visible text".
- AC10 → e2e `scripts/flows/replays-cinema-unavailable.mjs` › "replays-cinema-unavailable" (a
  second phase under `Q2L_UI_CINEMA_DISPLAY=secondary`: disabled with the not-primary reason); unit
  `src/main/modules/replays/cinema.test.ts` › "availability prefers the stage reason, then the
  display".
- Not covered by any AC, recorded rather than tested: real-engine placement and the z-order on a
  real display rest on spike [[186]]'s P1/P2/P6 evidence, and X11 is unverified (Decisions).

## Done

**Summary.** Timeline gains a Preview / Cinema / Fullscreen radio group. Cinema opens a transparent,
topmost overlay window (`cinema.html`, shell service `app.cinemaWindow`) over the primary display, with the
stage follower pinned to the display rect (never `win_alwaysontop`). The overlay has the control bar,
3 s idle fade, video-player keys and Esc-to-leave. Controller `cinema-controller.ts` owns enter/leave,
fullscreen-from-cinema and session end. Speed now lives in main; the display event carries it.
Review fixes: stale overlay speed (F1), refuse when no stage follower (F2, new key
`replays.cinema.unavailable.noStage`), close window on failed load (F3), refuse in fullscreen (F5),
stage-geometry equality asserted in the AC6/AC7 flows.

**Commit message:** `187: cinema mode - transparent launcher overlay over the primary display, three-mode timeline switch`

**Verification (narrow gate).** `npm run build`, `npm run typecheck` green; `npx vitest run --changed HEAD`
plus the explicit cinema list green; flows `replays-cinema-enter`, `replays-cinema`,
`replays-cinema-fullscreen`, `replays-cinema-unavailable` green, regression `replays-stage`,
`replays-fullscreen`, `replays-timeline{,-burst,-optimistic}` green. After the review fixes the fix agent
re-ran vitest (src/main, src/renderer, src/shared), typecheck, build and six flows, all green.
Review: stage 1 (default) UNCLEAR-leaning-PASS, no AC failing; F1/F2/F3/F5 + flow strength fixed.
AC → test, all ran and passed: AC1 DemoTimeline.test + enter flow; AC2 enter flow + cinema-controller
"enter pins before opening"; AC3 replays-cinema + CinemaOverlay.test; AC4 useIdleFade.test + replays-cinema;
AC5 cinema.test (shared) + replays-cinema; AC6 replays-cinema + stage-follow "unpinning re-sends";
AC7 replays-cinema-fullscreen + controller test; AC8 enter flow + "finished and ended close";
AC9/AC10 replays-cinema-unavailable + DemoTimeline.test / cinema.test (main).
Manual residue: none (real-engine placement/z-order rests on spike 186; X11 unverified, as decided).
**Unfixed, deliberately:** F4 overlay closes on fullscreen-command accept, not on channel confirm (pin could
stick if the engine never goes fullscreen; Windows channel has a fallback); F6 `pin(null)` ignores a minimised
launcher; F7 keys match on `event.code` (layout-independent position); F8 harness-env check is truthy like
`stage.ts:29`. Open gaps: `hasFollower` availability refreshes only on display events; no test asserts
`cinema.css` transparency or `onPrimaryDisplay`/move-watcher dedupe; `replays-cinema` does +60 while paused
(41 s stub demo). Vitest must run from the `C:/` (capital) cwd; lowercase `c:\` fails at `describe`.
Full gate not run (narrow only).

tiers: D 7 / hard 1 · review default · cycles 1 · agents 11
