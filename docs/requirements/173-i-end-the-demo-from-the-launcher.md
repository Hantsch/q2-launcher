---
id: 173
title: I end the demo from the launcher
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

I can end a playing demo without hunting for the game: the timeline has a **"stop" button** that
quits the game and returns the launcher to idle. Today there is none, and `quit` typed in the game's
console does nothing on Windows while the launcher steers the demo — spike [[169]] found that the
control loop starves every command typed in-game or sent by a key.

In fullscreen ([[172]]) the loop is stopped, so `quit` and binds work there. On the windowed stage
([[170]]) the game's own console and binds stay unusable while the launcher steers it; the launcher
must say so visibly instead of letting the user type into a console that ignores them. Closing the
game window (Alt+F4) works in both modes ([[169]] P11).

## Acceptance Criteria

- [ ] **AC1** — While a demo plays, the timeline shows a stop button; pressing it ends the game
      (`quit` over [[164]]'s channel) and the timeline returns to its idle state.
- [ ] **AC2** — If the game does not exit within a bounded time after the stop, the launcher ends the
      process and still returns to idle.
- [ ] **AC3** — Temporary playback files (copy-in [[160]], control/log files [[164]]) are cleaned up
      the same way as after any other game exit.
- [ ] **AC4** — On the windowed stage on Windows, the launcher states visibly (i18n text near the
      console field or stage) that the game's own console and key binds do not reach the game there,
      and names the alternatives (the console field, fullscreen, Alt+F4).
- [ ] **AC5** — On Linux (stdin channel, no loop) the AC4 hint is not shown, because in-game typing
      works there.

## Decisions (Sprint)

- **(User)** Stop vs. Play: stop in the timeline AND the action bar's "Running" button becomes stop during a demo playback.
- **(User)** Confirmation: stop immediately, no confirmation.
- **Stop is its own module handler `playback.stop`**, not a new `TimelineAction` kind — the timeline
  union maps actions to console lines and is refused once the demo finished, while stop must also
  work after the finish and ends in a process kill, which is main's business (concept §13 lists
  "stop" in its replays IPC handler list).
- **Stop = send `quit` over the channel, then terminate after `STOP_EXIT_TIMEOUT_MS = 5000`** — spike
  169 P8 measured a 0.2–0.3 s exit plus ~0.5 s loop latency, so 5 s is generous without leaving the
  user waiting long.
- **If the channel refuses `quit` (demo already finished → Windows loop stopped, or no live channel),
  the launcher terminates at once** — the line would never be executed, so waiting the timeout only
  delays the same kill.
- **The kill lives in `LaunchService.terminatePlayback()` and only ever touches a playback launch's
  own child** — the stop IPC is a demo control and must never end a normal game or a later launch.
- **Kill = `child.kill()`** (TerminateProcess on Windows, SIGTERM on Linux) — no native WM_CLOSE
  helper; skipping Q2PRO's config write on a killed exit is acceptable for a demo session (and it is
  only the fallback).
- **Cleanup (AC3) reuses the existing exit chain** — the kill produces the process `'exit'` event, which
  already ends the playback session (channel `close()`), removes the staged copy (story 160) and sets
  `exited`; no second cleanup path.
- **Stop is idempotent and shows "Stopping…"**: a second press while waiting is a no-op in main, and
  the renderer disables both stop controls with a "Stopping…" label until the session ends.
- **Action bar**: the primary button becomes an enabled "Stop demo" exactly where it shows "Running"
  today (running launch = shown installation) and a playback session exists in the replays store; the
  shell imports a small replays-module hook, following `EngineUpdateAction`'s precedent — minimal
  shell edit mandated by the (User) decision.
- **The AC4 hint lives under the console field** and shows only while the loop actually starves input:
  Windows, session live, demo not finished (the finish stops the loop, story 164) and not in fullscreen
  (story 172, built before this one) — outside those, in-game typing works and the hint would be false.
- **AC5 is proven by a renderer component test with platform `linux`** — there is no Linux e2e runner
  on the Windows gate machine, and AC5 is a display condition, not a user action.

## Open Questions

- ~~**Q1 — Stop vs. Play:** is the stop button in the timeline only, or does the action bar's
  "Running" button become stop during a demo playback?~~ answered → Decisions (Sprint)
- ~~**Q2 — Confirmation:** stop immediately, or confirm? (A demo is replayable, so probably immediate.)~~ answered → Decisions (Sprint)

## Plan

1. **Main (D1):** `LaunchService.terminatePlayback()` kills the playback launch's own child (and
   nothing else); `src/main/modules/replays/playback-stop.ts` orchestrates stop = `quit` over
   `PlaybackControl.send`, terminate after 5 s (or at once if `quit` is refused), idempotent, timer
   cleared on exit. New module handler `playback.stop` (no-input schema) + renderer client wrapper.
   Cleanup needs no new code: the kill yields `'exit'`, which already drives channel `close()`, the
   staged-copy removal and `exited`.
2. **Timeline stop (D2):** playback store gets `stopping` + `requestStop()`; `DemoTimeline` gets a stop
   `IconButton`; stub engine learns an "ignore quit" lever; new flow `replays-stop` proves the graceful
   path, the forced path and the file cleanup on the real surface.
3. **Action bar stop (D3):** a replays hook `useDemoStop()`; `ActionBar`'s Running button becomes an
   enabled "Stop demo" during a demo session; flow step.
4. **Stage input hint (D4):** visible i18n hint under the console field on Windows while the loop
   starves input (live, not finished, not fullscreen); hidden on Linux; flow step + component tests.

Order D1 → D2 → D3 → D4. No shell edit beyond `ActionBar.tsx` (mandated by the (User) decision).

## Deliverables

- **D1 — main: stop the playback launch (quit, then terminate).**
  Files: `src/main/services/launch.ts`, `src/main/services/launch.test.ts`,
  `src/main/modules/replays/playback-stop.ts` (new), `src/main/modules/replays/playback-stop.test.ts`
  (new), `src/shared/modules/replays.ts`, `src/main/modules/replays/index.ts`,
  `src/renderer/src/modules/replays/client.ts`. Mirror `playback-console.ts` / `createPlaybackConsole`
  for the factory shape and `playbackConsoleSend` for the handler/client wiring.
  - `LaunchService`: keep the spawned `ChildProcess` of a **playback** launch (`start(..., { playback:
    true })`) in a private field, cleared in that launch's own `'exit'`/`'error'` handlers (guard by
    identity, like `endOwnSession`). `terminatePlayback(): boolean` calls `child.kill()` on it and
    returns true; returns false (and kills nothing) when no playback launch is running. A normal
    launch's child is never stored, so it can never be killed. Also `isPlaybackRunning(): boolean`.
  - `createPlaybackStop({ playback: Pick<PlaybackControl,'send'>, launch: { isPlaybackRunning,
    terminatePlayback, onStateChange }, timeoutMs = STOP_EXIT_TIMEOUT_MS /* 5000, exported */ })`
    → `stop(): Outcome<void>`:
    no playback running → `fail(NO_SESSION)` (from `playback-control.ts`); a stop already pending →
    `ok` no-op; else `playback.send('quit')` — ok → arm a `timeoutMs` timer that calls
    `terminatePlayback()`; refused (e.g. demo finished, Windows loop already stopped) →
    `terminatePlayback()` at once, `ok`. A launch state `exited`/`failed` clears the timer and the
    pending flag, so a late timer can never kill a later launch.
  - Handler `REPLAYS_HANDLERS.playbackStop = 'playback.stop'` (doc comment like its neighbours),
    payload `replaysNoInputSchema`, added to the handler→schema map; wired in `index.ts` next to
    `playbackConsoleSend`; `playbackStop()` in the renderer `client.ts`. The module IPC coverage
    test must stay green.
  - Tests (`playback-stop.test.ts`, fake timers): "stop sends quit and does not terminate when the
    game exits in time"; "stop terminates the game when it has not exited after the timeout";
    "a refused quit terminates at once"; "a second stop while pending is a no-op"; "a timer from an
    exited launch never terminates a later one"; "stop without a playback launch is the no-session
    error". (`launch.test.ts`): "terminatePlayback kills only a playback launch's child" and "a
    terminated playback launch ends in exited, like any exit".

- **D2 — timeline stop button + the stop flow.**
  Files: `src/renderer/src/modules/replays/playback-store.ts`,
  `src/renderer/src/modules/replays/components/DemoTimeline.tsx`,
  `src/renderer/src/modules/replays/components/DemoTimeline.test.tsx`,
  `src/renderer/src/i18n/locales/en.json`, `scripts/lib/stub-engine.cjs`, `scripts/lib/fixture.mjs`,
  `scripts/flows/replays-stop.mjs` (new). Mirror `scripts/flows/replays-timeline.mjs` and its
  fixture variant (`REPLAYS_TIMELINE_VARIANT`, `writeReplaysTimelineFixture`, commands.log).
  - Store: session gets `stopping: boolean` (false at `beginSession`); `requestStop()` sets it, calls
    `playbackStop()`, and on a failed/rejected result resets it and returns the error. The session
    still ends only on `state: ended`.
  - `DemoTimeline`: a stop `IconButton` (`size="md"`, lucide `Square`, `FOCUS_RING`,
    `data-testid="replays-timeline-stop"`, label `replays.timeline.stop` "Stop demo") at the end of the
    transport buttons; no confirmation; while `stopping` it is disabled and labelled
    `replays.timeline.stopping` "Stopping…"; an error shows in the existing `replays-timeline-error`
    line. Shown whenever the timeline is (also after the demo finished).
  - Stub engine: while the file named by a new env `Q2L_UI_ENGINE_IGNORE_QUIT_FILE` exists, `quit` is
    logged to commands.log but does not exit (the fixture passes the path, like the quit file).
  - Flow `replays-stop` steps: "the stop button quits the game and the timeline returns to idle"
    (commands.log's last line is `quit`, timeline gone, `q2l_*` control/log files gone from the game
    dir); "a game that ignores quit is ended after the timeout" (create the ignore file, play, stop,
    timeline gone within 5 s + margin, files gone).
  - Tests (`DemoTimeline.test.tsx`): "the stop button calls stop without a confirmation";
    "while stopping the stop button is disabled and says Stopping…".

- **D3 — action bar: Running becomes Stop demo during a demo session.**
  Files: `src/renderer/src/modules/replays/useDemoStop.ts` (new),
  `src/renderer/src/components/shell/ActionBar.tsx`,
  `src/renderer/src/components/shell/ActionBar.test.tsx`, `src/renderer/src/i18n/locales/en.json`,
  `scripts/flows/replays-stop.mjs`. Mirror the shell's existing module import
  (`EngineUpdateAction` from `modules/downloads`).
  - `useDemoStop()` returns `{ active: session !== null, stopping, stop: requestStop }` from the
    replays playback store. In `resolvePrimaryAction`, the branch that today returns the disabled
    `installation.action.running` returns, when `active`, kind `'stop'`, label
    `installation.action.stopDemo` "Stop demo" (or `installation.action.stopping` "Stopping…",
    disabled, while stopping), tone `danger`, enabled; `onPrimary` `'stop'` calls `stop()`. A normal
    game launch still shows the disabled "Running".
  - Flow step "the action bar's Stop demo ends the demo" (click `Stop demo`, timeline gone).
  - Tests (`ActionBar.test.tsx`): "during a demo session Running becomes an enabled Stop demo";
    "a normal running game still shows a disabled Running".

- **D4 — the stage says in-game typing does not reach the game (Windows only).**
  Files: `src/renderer/src/modules/replays/components/ConsoleCommandField.tsx`,
  `src/renderer/src/modules/replays/components/ConsoleCommandField.test.tsx`,
  `src/renderer/src/i18n/locales/en.json`, `scripts/flows/replays-stop.mjs`. Platform read as in
  `components/DemoPlayAction.tsx` (`useLauncher(s => s.appInfo?.platform ?? '')`).
  - Below the field, a visible `<p data-testid="replays-console-stage-hint">` with
    `replays.console.stageInputHint`: "The game's own console and key binds do not reach the game while
    it plays on the stage. Use this console field, switch to fullscreen, or close the game window
    (Alt+F4)." Shown only when platform is `win32` **and** a session exists **and** `view.ended` is
    not true (the finish stops the loop) **and** the session is not in fullscreen — story 172 (built
    before this one) adds its fullscreen marker to `playback-store.ts`; read it there. Not a tooltip.
  - Flow step "the windowed stage says in-game typing does not reach the game" (hint visible while
    playing).
  - Tests (`ConsoleCommandField.test.tsx`): "on Windows the stage hint names the alternatives";
    "on Linux the stage hint is not shown"; "the hint is gone once the demo finished or in fullscreen".

## Model Hints

- D1 → deliverable-hard — new process-kill path in `LaunchService`: a timer racing the `'exit'` event
  must never kill a normal game or a later playback launch, and the kill must still flow through the
  one existing exit chain (session end, staged-copy removal, playtime) rather than a second cleanup.
- D2, D3, D4 → default.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-stop.mjs` › "the stop button quits the game and the timeline returns to idle";
  e2e `scripts/flows/replays-stop.mjs` › "the action bar's Stop demo ends the demo";
  unit `src/main/modules/replays/playback-stop.test.ts` › "stop sends quit and does not terminate when the game exits in time"
- AC2 → e2e `scripts/flows/replays-stop.mjs` › "a game that ignores quit is ended after the timeout";
  unit `src/main/modules/replays/playback-stop.test.ts` › "stop terminates the game when it has not exited after the timeout"
- AC3 → e2e `scripts/flows/replays-stop.mjs` › "a game that ignores quit is ended after the timeout" (control/log files gone);
  unit `src/main/services/launch.test.ts` › "a terminated playback launch ends in exited, like any exit"
- AC4 → e2e `scripts/flows/replays-stop.mjs` › "the windowed stage says in-game typing does not reach the game";
  unit `src/renderer/src/modules/replays/components/ConsoleCommandField.test.tsx` › "on Windows the stage hint names the alternatives"
- AC5 → unit `src/renderer/src/modules/replays/components/ConsoleCommandField.test.tsx` › "on Linux the stage hint is not shown"
  (no Linux e2e runner on the Windows gate machine; display condition, not a user action)

## Done
