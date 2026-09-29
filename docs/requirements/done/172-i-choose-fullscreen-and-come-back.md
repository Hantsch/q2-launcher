---
id: 172
title: I choose fullscreen and come back
status: done # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

Fullscreen is my deliberate choice: a **fullscreen button in the timeline** switches the running demo
to fullscreen, and from then on I steer it with my keys — the demo actions from [[167]] — and can
use the game's console, including `quit`. To return, a **"back to window" action** — bindable in the
Controls tab's "Demo playback" category like the others — puts the demo back on the stage ([[170]])
and gives the launcher's timeline control again.

Spike [[169]] found why binds and typed commands do nothing today: on Windows the control loop
([[164]]) re-inserts itself at the front of the command buffer, so everything a key or the console
appends never runs while it lives. [[167]]'s binds are therefore dead on Windows during playback.
The spike also verified the way out: live `vid_fullscreen 1/0` works and returns to the last stage
geometry; stopping the loop releases the queue; a queued `exec` of the loop cfg restarts it — which
is exactly what the "back to window" bind can do (`vid_fullscreen 0` + re-arm the loop).

On Linux the channel is stdin, there is no loop and nothing starves; the fullscreen switch and the
back-to-window action still apply.

## Acceptance Criteria

- [x] **AC1** — The timeline has a fullscreen button; pressing it switches the running demo to
      fullscreen.
- [x] **AC2** — In fullscreen on Windows the control loop is stopped, so bound demo actions, typed
      console commands and `quit` take effect in-game.
- [x] **AC3** — While in fullscreen the timeline shows that the demo is steered by keys (visible
      text, i18n key) instead of stale position/controls.
- [x] **AC4** — The Controls tab's "Demo playback" category offers a bindable "back to window"
      action; binding it writes its engine command into the profile like every other bind, pinned by
      a unit test; the launcher never binds it on its own.
- [x] **AC5** — Pressing the bound "back to window" key in fullscreen returns the demo to the stage
      geometry and the launcher regains control (position updates and timeline commands work again).
- [x] **AC6** — The "back to window" action outside a launcher-started demo playback is harmless (no
      error dialog, no game-state change beyond an engine message).
- [x] **AC7** — Existing profiles get the new action (unbound) through a state migration, as [[167]]
      did for the demo category.

## Decisions (Sprint)

- **(User)** Queued presses: guard the demo actions on a cvar so stale presses are harmless.
- **(User)** Alt+Enter: the launcher detects and follows vid_fullscreen changes made by the user (not only the timeline button).
- **Guard = "position moved since the switch", in a cvar.** Demo actions are wrapped as
  `if x$cl_demopos ne x$q2l_armpos then <cmd>`; the loop's last call before it stops runs
  `set q2l_armpos $cl_demopos`, and the queued presses run in that same buffer pass, so they see an
  unchanged position and do nothing — a plain on/off cvar cannot work, because every command the
  loop inserts runs *before* the appended stale presses, so the cvar would already be armed.
- **`ne`, not `!=`, with an `x` prefix** — the pinned binary's string table has `eq`/`ne`, and the
  `x` keeps an empty `$cl_demopos`/unset `$q2l_armpos` from dropping a token out of the `if`.
- **A paused demo is resumed on the switch** (the renderer sends `togglePause` before `fullscreen`
  when the view reads paused) — a frozen position would keep the guard closed for every key.
- **Fresh presses within one position step after the switch are ignored** (0.1 s at 1×, 0.4 s at
  0.25×) — the price of the guard, accepted because a human's first press comes later.
- **"Back to window" bind = `exec q2l_back.cfg`**; the launcher writes that cfg into the gamedir for
  the session (removed at close, stale-cleaned like the other `q2l_*` files). Its body only acts when
  `q2l_session` is 1 (`+set q2l_session 1` in the demo launch args, a non-archived `set` cvar) and the
  stale guard is open, then runs `vid_fullscreen 0` and, on Windows, `exec q2l_loop.cfg` — outside a
  launcher playback the file is absent and the engine only prints "Couldn't exec" (AC6).
- **Guarded alias bodies are quoted**: `alias-render.ts` quotes a body that contains `$` (today only
  `;`), otherwise Q2PRO would expand the macros once when the profile cfg is exec'd.
- **Return detection (Q2):** the channel leaves fullscreen state only on a fresh `FS 0` sample (the
  POS echo becomes `echo POS $cl_demopos FS $vid_fullscreen`), never on "any POS line" — the
  buffered logfile flushes pre-stop lines late. No timeout: the keys-steer text stays until the user
  returns or the game exits (then the normal `ended` path).
- **Entering on Windows** counts as done on its `ACK`, on `FS 1`, or after the existing 2 s ACK
  timeout of log silence (a stopped loop is the only silent live engine); if the command did not
  actually run, the continuing `FS 0` samples put the channel back on the stage by themselves.
- **Following user switches:** a `FS 1` sample while on the stage enters fullscreen mode (loop
  stopped the same way, without sending `vid_fullscreen 1`); on Linux the 100 ms poll follows both
  directions. On Windows a switch back made *inside* fullscreen (Alt+Enter) cannot be observed —
  the loop is off and only the engine can restart it — so the keys-steer text names the "back to
  window" key, which also works from an already-windowed game.
- **While fullscreen, timeline and console-field sends are rejected** with
  `replays.playback.error.fullscreen` on both platforms and the controls are disabled — one rule for
  the UI instead of a Linux-only exception.
- **The back-to-window action is never disabled by engine scope**, and pause stays enabled in r1q2
  profiles as in [[167]] — launcher playback is Q2PRO-only (sprint decision), so a guarded bind that
  r1q2 cannot parse is harmless there.
- **Existing bound demo rows are upgraded by the migration** when their commands still equal the
  old unguarded catalog text; a user-edited command is left alone.

## Open Questions

- ~~**Q1 — Queued presses:** keys pressed while the loop ran (windowed stage) sit in the queue and all
  fire at once when the loop stops for fullscreen (e.g. three "jump forward" presses). Accept, make
  the demo actions guard on a cvar, or tell the user in-window that keys do nothing there ([[173]])?~~ answered → Decisions (Sprint)
- ~~**Q2 — Detecting the return:** the logfile is buffered ([[169]] side finding) — the launcher must
  detect the re-armed loop from resumed POS output, not from a single trailing line. Timeout and
  what the timeline shows if the user never comes back?~~ answered → Decisions (Sprint)
- ~~**Q3 — Alt+Enter / other fullscreen switches:** if the user toggles `vid_fullscreen` themselves,
  does the launcher notice, or is the timeline button the only supported path?~~ answered → Decisions (Sprint)

## Plan

Mechanism (see Decisions): the fullscreen switch is one guarded command over [[164]]'s channel that
runs `vid_fullscreen 1` and redefines `q2l_loop` to `set q2l_armpos $cl_demopos`, so the loop's next
call arms the stale guard and ends the loop; queued presses then flush in the same pass and are
ignored by the `ne` guard. "Back to window" is a bind to `exec q2l_back.cfg`, a session-only cfg that
runs `vid_fullscreen 0` + `exec q2l_loop.cfg` (Windows). The channel tracks `stage`/`fullscreen` from
`FS n` samples appended to the POS echo.

Order (shared → main → renderer → flow):

1. **D1 catalog (shared):** guard constants, guarded demo commands, new `demoBackToWindow` action,
   `$`-bodies quoted by `alias-render.ts`, a reusable command-buffer simulator for tests.
2. **D2 migration + bind flow:** v5 adds the unbound back-to-window row and upgrades untouched demo
   commands; `demo-actions-bind` flow binds it.
3. **D3 protocol (main, pure):** FS in the POS echo/parser, enter/stop lines, back cfg builder,
   `q2l_session` arg, channel interface additions.
4. **D4 Windows channel (hard):** `stage → entering → fullscreen → stage` state machine.
5. **D5 Linux channel + PlaybackControl + IPC:** Linux mode tracking, `playback.display` event,
   `{ kind: 'fullscreen' }` timeline action, sends rejected while fullscreen.
6. **D6 timeline UI (renderer):** fullscreen button, keys-steer text, disabled controls.
7. **D7 stub engine + e2e flow:** stub learns `vid_fullscreen`/`FS` and appended "key presses";
   `replays-fullscreen` flow walks enter → stale ignored → fresh works → back → quit.

Files by area: `src/shared/replays/demo-guard.ts` (new), `src/shared/config/{action-catalog,
alias-render}.ts`, `src/main/services/migrations.ts`, `src/main/modules/replays/playback-channel/*`,
`playback-control.ts`, `playback-timeline.ts`, `src/shared/replays/timeline.ts`,
`src/shared/modules/replays.ts`, `DemoTimeline.tsx` + `playback-store.ts` + `client.ts`, `en.json`,
`scripts/lib/stub-engine.cjs`, `scripts/lib/fixture.mjs`, `scripts/flows/replays-fullscreen.mjs`.

## Deliverables

- [x] **D1 — guarded demo actions and the back-to-window action (shared).** New
  `src/shared/replays/demo-guard.ts` (pure, no node/DOM): `ARMPOS_CVAR = 'q2l_armpos'`,
  `SESSION_CVAR = 'q2l_session'`, `BACK_TO_WINDOW_CFG = 'q2l_back.cfg'`,
  `guardDemoCommand(cmd) = \`if x$cl_demopos ne x$q2l_armpos then ${cmd}\``, and
  `BACK_TO_WINDOW_COMMAND = 'exec q2l_back.cfg'`. In `src/shared/config/action-catalog.ts` wrap every
  existing `DEMO_ACTIONS` command (pause, the four seeks, and each of the four `if $timescale`
  commands that `speedUpCommand()`/`speedDownCommand()` from `demo-speed.ts` return — wrap per command,
  do not join) with `guardDemoCommand`, and append a `demoBackToWindow` action (command
  `BACK_TO_WINDOW_COMMAND`, unguarded — its cfg guards itself) with
  `labelKey: 'config.actionCatalog.demoBackToWindow.label'` ("Back to window"), `descriptionKey`
  (…".description": "Leaves fullscreen and gives the launcher's timeline control again. Only works
  while the launcher plays a demo."), ASCII `label` identical to en.json; register it in
  `src/shared/config/comment-labels.ts` like the other demo rows (`buildDemoRows` in
  `catalog-rows.ts` maps `DEMO_ACTIONS`, so it follows). Strings in
  `src/renderer/src/i18n/locales/en.json`. In `src/shared/config/alias-render.ts#renderAliasLine`
  quote the body when it contains `;` **or `$`** (Q2PRO expands unquoted `$` when the cfg line runs;
  `alt-layers.ts`/`switch-bind.ts` keep their rule). New test helper `src/test-support/q2-cbuf-sim.ts`
  modelled on `scripts/lib/stub-engine.cjs` lines 136–337: a command buffer with insert (alias/exec/
  `if` branch) vs append (key presses), `;`/newline splitting outside quotes, `$name` expansion outside
  quotes and mid-token (`x$cl_demopos`), `set`/`alias`/`exec` (from an in-memory file map, missing →
  "Couldn't exec <name>")/`wait`/`echo`/`if` with `== != eq ne` (`eq`/`ne` always string), a settable
  `cl_demopos`, and a log of executed non-plumbing commands. Rewrite `demo-speed.test.ts`'s own
  simulator to use it only if that is a drop-in; otherwise leave it. Tests: extend
  `src/shared/config/action-catalog.test.ts` › "each demo action's command text is pinned" with the
  literal guarded strings and `exec q2l_back.cfg`; new `src/shared/replays/demo-guard.test.ts` ›
  "a guarded demo action is ignored at the armed position and runs once the position moved" (sim:
  `q2l_armpos` = `0:12.3`, pos `0:12.3` → nothing; pos `0:12.4` → `seek +10`; unset armpos, playing →
  runs; no demo (empty pos) and unset armpos → nothing, no error beyond engine text);
  `src/main/modules/config/round-trip.test.ts` › "a guarded demo bind survives write and read-back
  quoted" (alias line is `alias <name> "if x$cl_demopos ne x$q2l_armpos then seek +10"`, same catalog
  row back); `render.test.ts` › "the template seeds the demo category unbound and binds no demo
  command" must still pass with the new row.

- [x] **D2 — existing profiles get the new row; the bind reaches the file (main + flow).** New step
  `to: 5` in `MIGRATIONS` (`src/main/services/migrations.ts`, mirror the `to: 4` demo step and its
  `addDemoCategory` helper; bump `STATE_SCHEMA_VERSION` to 5 in `src/shared/constants.ts`, and the
  schema mirror in `scripts/lib/fixture.mjs`/`controls-seed` fixture if they pin 4 — 167 hit that):
  if the profile has a `demo` category, append an unbound `demoBackToWindow` action (`kind: 'bind'`,
  `commands: []`, no key, `categoryId: 'demo'`, `name`/`catalogId` as the v4 step does) when absent;
  for each demo row whose `catalogId` is a demo action and whose `commands` equal that action's
  **pre-172** unguarded commands (hard-code them in the migration as a frozen table, never derived
  from the live catalog), replace them with the guarded catalog commands; `dirty: true` only if
  something changed. Pure, never throws, never touches keys/binds, never re-adds a deleted category.
  Tests in `src/main/services/migrations.test.ts`: › "the v5 migration adds the unbound back-to-window
  row once" (idempotent, no key, no bind) and › "the v5 migration guards untouched demo commands and
  leaves edited ones". Extend `scripts/flows/demo-actions-bind.mjs`: bind a key to "Back to window",
  save, assert the written profile holds the bind resolving (through the generated alias, as the flow
  already resolves `seek`) to `exec q2l_back.cfg`, then unbind and save back.

- [x] **D3 — protocol for fullscreen (main, pure).** In
  `src/main/modules/replays/playback-channel/protocol.ts`: the control file's position line becomes
  `echo POS $cl_demopos FS $vid_fullscreen`; `parseEngineLine`'s `pos` kind gains
  `fullscreen: boolean | null` (`FS 1`/`FS 0`; `null` when absent, so old fixture lines still parse;
  `POS FS 0` = position null); `buildEnterFullscreenLines({ switchMode })` →
  `[...(switchMode ? ['vid_fullscreen 1'] : []), 'alias q2l_loop "set q2l_armpos $cl_demopos"']`
  (the command-cfg lines of an internal guarded command — they bypass `checkLine`, which rejects
  `"`); `buildBackToWindowCfg(platform)` →
  `alias q2l_back_go "vid_fullscreen 0; exec q2l_loop.cfg"` (Linux: `"vid_fullscreen 0"` only),
  `alias q2l_back_live "if x$cl_demopos ne x$q2l_armpos then q2l_back_go"`,
  `if x$q2l_session eq x1 then q2l_back_live`; both `windowsLaunchArgs()` and `linuxLaunchArgs()`
  add `+set q2l_session 1` to `argsBeforeDemo`; the Linux poll line becomes
  `echo POS $cl_demopos FS $vid_fullscreen`. Use the names from `src/shared/replays/demo-guard.ts`
  (D1). In `types.ts` add to `PlaybackChannel`: `enterFullscreen(): Outcome<void>`,
  `display(): 'stage' | 'fullscreen'`, `onDisplayChange(cb): () => void`, and i18n key
  `replays.playback.error.fullscreen` ("The demo is in fullscreen — steer it with your keys.") in
  `en.json`. Tests in `protocol.test.ts` using `src/test-support/q2-cbuf-sim.ts` (D1): › "the switch
  arms the guard so presses queued during the loop are ignored" (loop cfg running, append a guarded
  `seek +60`, enter lines via the control file → loop ends, `vid_fullscreen` is 1, `seek +60` never
  runs; advance pos, append guarded `seek +10` → runs); › "back to window leaves fullscreen and
  re-arms the loop" (exec `q2l_back.cfg` → `vid_fullscreen 0`, loop running, next control file
  executed); › "back to window outside a launcher playback is harmless" (no file → only
  `Couldn't exec q2l_back.cfg`; file present but no `q2l_session` → `vid_fullscreen` unchanged, no
  loop); › "a stale back-to-window press does not undo the switch"; parser cases for `FS` lines;
  `+set q2l_session 1` present in both platforms' `argsBeforeDemo`.

- [x] **D4 — Windows channel follows stage/fullscreen (main).** In
  `src/main/modules/replays/playback-channel/windows-channel.ts` implement D3's interface additions
  with `protocol.ts` builders. `start()`/prepare also writes `q2l_back.cfg`
  (`buildBackToWindowCfg('win32')`) atomically next to the loop cfg; `close()` and stale cleanup
  remove it with the other `q2l_*` files. State `stage | entering | fullscreen`, `display()` maps
  `entering` to `stage`. `enterFullscreen()`: on `stage` enqueue an internal guarded command whose
  command cfg is `buildEnterFullscreenLines({ switchMode: true })` → `entering` (reject when not
  `stage` or finished). `entering` → `fullscreen` on its `ACK`, on a `pos` line with
  `fullscreen: true`, or after `ACK_TIMEOUT_MS` without a line; on entering `fullscreen` rewrite the
  control file **idle** (so `exec q2l_loop.cfg`'s `set q2l_seq 0` cannot re-fire the switch), drop
  and log any queued commands, fire `onDisplayChange('fullscreen')`. On `stage`, a `pos` line with
  `fullscreen: true` (user switched) enqueues `buildEnterFullscreenLines({ switchMode: false })` the
  same way. In `fullscreen`: `send` fails with `replays.playback.error.fullscreen`; position lines
  update nothing; **only** a `pos` line with `fullscreen: false` read after the fullscreen transition
  returns to `stage` (fire `onDisplayChange('stage')`, resume the queue with the next `seq`, which
  still differs from the engine's reset `q2l_seq 0`) — buffered pre-stop lines (`POS …`, `FS 1`,
  `ACK`) that flush late must not count. `Demo finished` in any state behaves as today. Tests in
  `windows-channel.test.ts`, extending its fake engine (re-executes `q2l_ctl.cfg` per tick, honours
  the seq guard, stops ticking when `q2l_loop` is redefined, resumes on a simulated
  `exec q2l_back.cfg`, resets `q2l_seq` to 0 on resume): › "fullscreen stops the loop and the switch
  runs exactly once" (also across resume + seq reset); › "the channel returns to the stage only on a
  fresh FS 0 sample" (fake flushes stale `POS`/`FS 1`/`ACK` lines first, then `FS 0`); › "a missing
  ACK still enters fullscreen after the timeout, and FS 0 samples bring it back"; › "an FS 1 sample on
  the stage follows the user's switch"; › "sends in fullscreen fail with
  replays.playback.error.fullscreen"; › close removes `q2l_back.cfg`.

- [x] **D5 — Linux channel, PlaybackControl, IPC (main + shared).** `linux-channel.ts`:
  `createLinuxChannel({ io, log, gameDirPath })` (pass `gameDirPath` from `playback-control.ts`'s
  `prepare`), writes `q2l_back.cfg` (`buildBackToWindowCfg('linux')` from `protocol.ts`) at `start()`
  and removes it at `close()`; `enterFullscreen()` writes `vid_fullscreen 1`; display follows every
  `pos` line's `fullscreen` flag both ways; sends fail with `replays.playback.error.fullscreen` while
  fullscreen. `src/shared/modules/replays.ts`: `REPLAYS_EVENTS.playbackDisplay = 'playback.display'`
  with `ReplaysPlaybackDisplay = { fullscreen: boolean }` (mirror `playbackState`).
  `playback-control.ts`: `enterFullscreen()` (no session → `NO_SESSION`), subscribes to the
  channel's `onDisplayChange`, emits `playback.display`, suspends `playback.position` pushes while
  fullscreen and resumes them on return. `src/shared/replays/timeline.ts`: add
  `z.strictObject({ kind: z.literal('fullscreen') })` to `timelineActionSchema`;
  `buildTimelineCommand` is not called for it — `src/main/modules/replays/playback-timeline.ts`
  routes `fullscreen` to `playback.enterFullscreen()` (widen its `Pick`). Tests:
  `linux-channel.test.ts` › "fullscreen goes over stdin and the display follows FS samples both ways"
  and › "close removes q2l_back.cfg"; `playback-control.test.ts` › "a display change is pushed as
  playback.display and pauses position pushes while fullscreen"; `playback-timeline.test.ts` › "the
  fullscreen action enters fullscreen instead of sending a line"; `timeline.test.ts` schema accepts
  `{ kind: 'fullscreen' }`.

- [x] **D6 — fullscreen button and keys-steer text (renderer).** `src/renderer/src/modules/replays/
  playback-store.ts`: session gains `fullscreen: boolean` (false at `beginSession`) and
  `applyDisplay(p)`; `client.ts` subscribes to `REPLAYS_EVENTS.playbackDisplay` next to
  `playbackState`. `components/DemoTimeline.tsx`: a fullscreen `IconButton` (`size="md"`, inline SVG
  icon, `aria-label` i18n, testid `replays-timeline-fullscreen`) in the transport row, disabled when
  ended; on press, if `view.paused` first run `togglePause`, then `playbackTimeline({ kind:
  'fullscreen' })`, errors into the existing `replays-timeline-error`. While `session.fullscreen`:
  position/duration/seek show nothing stale — render a visible text (testid `replays-timeline-keys`,
  key `replays.timeline.fullscreenKeys`: "Fullscreen: steer the demo with your keys. Your \"Back to
  window\" key (Controls tab, Demo playback) returns it here.") and disable every transport control,
  the speed select and the fullscreen button. Strings in `en.json`
  (`replays.timeline.fullscreen`, `replays.timeline.fullscreenKeys`). The 36px button is covered by
  the existing CLAUDE.md DemoTimeline deviation row. CHANGELOG entry (`### Added`). Tests in
  `DemoTimeline.test.tsx` › "the fullscreen button resumes a paused demo, then enters fullscreen" and
  › "in fullscreen the timeline shows the keys text and disables its controls".

- [x] **D7 — stub engine and the fullscreen flow (scripts).** `scripts/lib/stub-engine.cjs`:
  `vid_fullscreen` as a cvar whose changes are written to the command log (`vid_fullscreen 1`),
  `ne`/`eq` already supported; a key-press file `Q2L_UI_ENGINE_KEYS_FILE` — when it appears, each line
  is **appended** (`addText`, like a bind press), then the file is deleted. `scripts/lib/fixture.mjs`:
  pass that env next to `Q2L_UI_ENGINE_QUIT_FILE` for the replays timeline variant. New flow
  `scripts/flows/replays-fullscreen.mjs` (mirror `scripts/flows/replays-timeline.mjs` for setup/start
  and command-log assertions): start the demo; append guarded `seek +60` (starved); press
  `replays-timeline-fullscreen` → command log has `vid_fullscreen 1`, `replays-timeline-keys` visible,
  controls disabled, `seek +60` never logged; after ≥0.5 s append guarded `seek +10` → logged; append
  `exec q2l_back.cfg` → log has `vid_fullscreen 0`, keys text gone, position advances, a timeline
  jump reaches the log; press fullscreen again, append `quit` → stub exits, timeline returns to idle
  (flow ends where it started). Guarded strings: import nothing from `src`; hard-code them with a
  comment pointing at `src/shared/replays/demo-guard.ts`.

## Model Hints

- D4 → deliverable-hard: a new state machine over a buffered log — returning on a late-flushed
  pre-stop POS line, or leaving a guarded switch in the control file that `exec q2l_loop.cfg`'s
  `q2l_seq 0` reset re-fires, both look right and only fail with the real engine.
- Review: → default (the two plausible wrong implementations — "any POS returns" and `!=` instead of
  `ne` — are pinned by D4's stale-flush test and D1's literal command strings).

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-fullscreen.mjs` › "replays-fullscreen"; unit
  `src/renderer/src/modules/replays/components/DemoTimeline.test.tsx` › "the fullscreen button
  resumes a paused demo, then enters fullscreen" (D5, D6, D7)
- AC2 → unit `src/main/modules/replays/playback-channel/windows-channel.test.ts` › "fullscreen stops
  the loop and the switch runs exactly once"; unit `playback-channel/protocol.test.ts` › "the switch
  arms the guard so presses queued during the loop are ignored"; e2e
  `scripts/flows/replays-fullscreen.mjs` › "replays-fullscreen" (appended `seek +10` and `quit` run)
  (D3, D4, D7); manual residue: real key presses and typed console lines in a real Q2PRO fullscreen —
  synthetic keys do not reach Q2PRO ([[169]] side finding) and CI has no licensed game data.
- AC3 → unit `DemoTimeline.test.tsx` › "in fullscreen the timeline shows the keys text and disables
  its controls"; e2e `scripts/flows/replays-fullscreen.mjs` › "replays-fullscreen" (D6, D7)
- AC4 → unit `src/shared/config/action-catalog.test.ts` › "each demo action's command text is
  pinned"; unit `src/main/services/migrations.test.ts` › "the v5 migration adds the unbound
  back-to-window row once"; e2e `scripts/flows/demo-actions-bind.mjs` › "demo-actions-bind" (D1, D2)
- AC5 → unit `windows-channel.test.ts` › "the channel returns to the stage only on a fresh FS 0
  sample"; unit `protocol.test.ts` › "back to window leaves fullscreen and re-arms the loop"; e2e
  `scripts/flows/replays-fullscreen.mjs` › "replays-fullscreen" (D3, D4, D7)
- AC6 → unit `protocol.test.ts` › "back to window outside a launcher playback is harmless"; unit
  `src/shared/replays/demo-guard.test.ts` › "a guarded demo action is ignored at the armed position
  and runs once the position moved" (D1, D3)
- AC7 → unit `src/main/services/migrations.test.ts` › "the v5 migration adds the unbound
  back-to-window row once" and › "the v5 migration guards untouched demo commands and leaves edited
  ones" (D2)

## Done

**Summary.** The timeline gets a fullscreen button; the guarded switch stops the Windows control loop so bound demo actions, console and `quit` work in-game. Demo actions are guarded by the `q2l_armpos` cvar (`ne` guard) so queued presses are ignored; a bindable "Back to window" action (`exec q2l_back.cfg`) restores the stage and re-arms the loop. State migration v5 adds the unbound row and upgrades untouched demo commands. The Windows and Linux channels track stage/fullscreen from `FS` samples; the stage follower (171) is suspended in fullscreen.

**Commit message:** `172: fullscreen from the timeline, guarded demo actions, bindable back-to-window (v5 migration, FS-aware channels)`

**Verification (narrow gate, twice, after the last edit).** typecheck, build, `npx vitest run --changed HEAD` (218 files, 3721 passed) green. Flows green: replays-fullscreen, replays-timeline, replays-play-q2pro, replays-stage-follow, replays-stage, replays-console-command, demo-actions-bind, controls-subcategory, controls-category-rename-reorder, settings-section-rename-add-cvar. Review: clean Sonnet agent, PASS with reservations, 1 fix cycle.
AC -> test as verified: AC1 replays-fullscreen + DemoTimeline fullscreen test; AC2 windows-channel "fullscreen stops the loop..." + protocol "the switch arms the guard..." + flow; AC3 DemoTimeline keys-text test + flow; AC4 action-catalog pinned + migrations v5 row + demo-actions-bind; AC5 windows-channel "fresh FS 0 sample" + protocol "back to window leaves fullscreen..." + flow; AC6 protocol "outside a launcher playback is harmless" + demo-guard test; AC7 both v5 migration tests. All ran and passed.
Manual residue: real key presses / typed console lines in a real Q2PRO fullscreen (synthetic keys do not reach Q2PRO, no licensed game data in CI).
Pre-existing: flow `controls-extra-keys` is red (key-capture shows "y is already used"; keyboard-focus dependent) on bare HEAD as well, and passed once earlier in this build; not caused by 172.

**Decisions.**
- Review fix: q2l_loop.cfg now starts with `set q2l_armpos ""`, and the Windows back cfg additionally requires a non-empty armpos, so "Back to window" pressed while already windowed no longer starts a second loop chain. Linux cfg unchanged (no loop). Deviates from the D3 cfg text; pinned by "back to window while windowed does not start a second loop".
- Stale FS 0 lines: on a timeout-entered fullscreen an FS 0 is ignored if the switch's ACK follows in the same read batch; FS 1 while entering counts only for our own switch (D4 extras).
- Windows-channel sends while `entering` are accepted, then dropped and logged at fullscreen; the internal switch does not count against QUEUE_CAP.
- Stage follower: `setSuspended` in stage-follow-session, re-places after the 250 ms quiet period on resume; the index.ts wiring has no unit test (inside the register function).
- The fullscreen icon uses lucide `Maximize` instead of inline SVG (repo's icon convention); ConsoleCommandField is not visually disabled in fullscreen, it only gets the rejection error (timeline controls are disabled).
- `flows/replays-play-q2pro.mjs` order assertion updated for `+set q2l_session 1`.
- Unfixed review findings, accepted: a user Alt+Enter racing a queued button switch can drop the switch (narrow); stale-FS0 detection covers only one read batch; `demoActionUnavailableReason` still leaves guarded `pause` ungated on r1q2 (Q2PRO-only playback).

tiers: D 7 / hard 1 · review default · cycles 1 · agents 12
