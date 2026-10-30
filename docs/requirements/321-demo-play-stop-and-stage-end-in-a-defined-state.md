---
id: 321
title: Demo play, stop and stage restore end in a defined state
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Overdue rows TD-008, TD-010, TD-011, TD-019, TD-029 and TD-030 are edge cases of demo playback in
the `replays` module: a play that fails without saying so, a stop that never finishes, a stage that
is not restored, a dialog that shows stale values. Each one leaves the user looking at a state that
does not match what happened.

## Acceptance Criteria

- [ ] **AC1** — "Play anyway" on a demo whose mod game directory is missing shows a play error with
      a reason; main does not fail with an unhandled ENOENT on `q2l_back.cfg` (TD-008).
- [ ] **AC2** — A second Play while one is starting is refused, and a failed `trustMod` does not
      start playback (TD-019); `replays.modWarning.error` is either shown somewhere or deleted.
- [ ] **AC3** — A stop whose kill succeeds without an `exit` event leaves Stopping within a bounded
      time and returns the UI to idle; a stop refused from the action bar shows the refusal (TD-011).
- [ ] **AC4** — Quitting the launcher while a staged demo runs restores the stage values in the
      config; a settings change during playback and a switch back from fullscreen restore the
      latest geometry, not a stale one (TD-010, TD-029). `+-X` in `vid_geometry` is parsed or
      refused, with a test.
- [ ] **AC5** — The replace dialog shows the current value; the missing-mod confirmation is cleared
      when the selection changes; Join is disabled for a server the filter hides (TD-030).
- [ ] **AC6** — Rows TD-008, TD-010, TD-011, TD-019, TD-029 and TD-030 are removed from
      `docs/TECH-DEBT.md`.

## Open Questions

~~TD-010's "Alt+Enter can race a queued switch": fix it here, or record it as manual residue if~~ answered → Decisions (Sprint)
  the flow harness cannot reproduce it?

## Decisions (Sprint)

- **(User)** Alt+Enter race with a queued switch: fix it with a test; if the flow harness cannot reproduce it, declare manual residue with the reason
- Quit while a staged demo runs (AC4): the game keeps running (story 163: "never kills the
  process"); at `onBeforePlaybackRelease` the launcher hands the engine the session's original
  restore-cvar values as a last console line so the engine's own write-on-exit persists them, and
  the pending restore record carries the game's pid so `applyPending` waits while it is alive —
  killing the game on quit would revert story 163, and a pid-blind `applyPending` is the bug itself.
- `+-X` (AC4): parsed, not refused — `stageGeometry` emits one sign per origin (`200x100-1920+0`),
  because Q2PRO reads each origin with `strtol` after a `+`/`-` check, which reads `-1920` but not
  `+-1920`; `parseGeometry` accepts both forms; a real negative-origin monitor stays manual residue.
- Play anyway on a missing game dir (AC1): `demo-play` refuses before staging with a new key
  `replays.play.error.gameDirMissing` on both platforms, because Windows rethrows the write failure
  and Linux only warns — one platform-neutral check is the defined state.
- `replays.modWarning.error` (AC2): shown, not deleted — a failed `trustMod` keeps the missing-mod
  dialog open with that key as a visible error, because a refused trust is a state the user must see.
- Action-bar stop refusal (AC3): a sticky error toast via `toastOutcomeError`, not `toastRefusal`,
  since story 322 may delete `toastRefusal` concurrently; the shell's existing `case 'stop'` in
  `ActionBar.tsx` is fixed in place because the stop handling already lives there.
- Stop without `exit` (AC3): main settles the stop itself 5 s after a successful kill, through the
  same session-end path an `exit` takes, so the renderer needs no timer of its own.
- Alt+Enter race (User decision applied): fixed and proven by a `windows-channel.test.ts` unit test;
  the real-surface reproduction is manual residue because the stub engine has no window or key
  input and synthetic keys never reach Q2PRO.
- Settings change / switch back (AC4, TD-029 "unobserved"): "settings change" means any stage rect
  or display scale reported while a demo plays; tests pin latest-wins first and code changes only
  where red, plus a forced re-send on leaving fullscreen, because the engine's window after a
  fullscreen exit is not known to match `sentGeo`.
- Join for a filtered-out server (AC5): the Join target resolves against the visible rows on the
  list and watchlist tabs, because the effect-based selection clear leaves one enabled render and
  the watchlist target is never reconciled.
- TD-030's fourth item (an even count of pending pause toggles lets a stale readback clear the
  chain early, `optimistic-timeline.ts`) is outside AC5: it is re-filed as a new TECH-DEBT row when
  TD-030 is removed, because its fix needs a pause-chain redesign and AC6 must not drop it silently.
- AC2's double Play and trust failure, AC3's stop refusal and AC5's selection-change reset are
  proven by component tests, not flows: none is triggerable deterministically in the seeded app (a
  modal blocks the selection; a refusal, a failed state write and a double click within one await
  are races or injected failures).

## Plan

Six overdue replays edge cases, each fixed where it lives, each with its own test; main first,
renderer second, docs last.

1. D1 main: refuse Play on a missing mod game dir before anything is staged (TD-008).
2. D2 renderer: `runPlay` single-flight, failed `trustMod` does not play and shows
   `replays.modWarning.error`, missing-mod confirmation reset on selection change (TD-019, TD-030).
3. D3 main: a stop whose kill succeeds settles within 5 s without an `exit` (TD-011).
4. D4 shell renderer: an action-bar stop refusal becomes a visible toast (TD-011).
5. D5 main (hard): quit while a staged demo runs leaves the original stage values on disk (TD-010).
6. D6 main: single-sign negative origins; latest geometry wins after a settings change and after
   leaving fullscreen (TD-010, TD-029).
7. D7 main: a user Alt+Enter racing a queued fullscreen switch ends in a defined mode (TD-010).
8. D8 renderer: the replace dialog keeps the pending quick-edit value visible (TD-030).
9. D9 servers renderer: Join is disabled for a server the filter hides (TD-030).
10. D10 docs: six TECH-DEBT rows out (one item re-filed), replays system doc, one CHANGELOG line.

Flows extended (no new flow): `replays-mod-warning`, `replays-stage`,
`replays-edit-unreadable-sidecar`, `servers-filter-search`.

## Deliverables

- **D1 — Play on a missing mod game dir is refused with a reason (main).** Today "Play anyway" on
  a demo whose mod game dir does not exist throws ENOENT from
  `src/main/modules/replays/playback-channel/windows-channel.ts:383` (`writeAtomic(backCfgPath…)` in
  `start()`), which `src/main/modules/replays/demo-play.ts` (catch around `prepare`, ~:340-356)
  rethrows; on Linux (`linux-channel.ts:82`) it only warns. Add a check in `demo-play.ts` before any
  copy is staged or the channel is prepared: the play's resolved game dir is missing →
  `fail('replays.play.error.gameDirMissing', { mod: <gameDir> })`, beside the existing
  `replays.play.error.*` constants (~:81-89). Add the key to the key union in
  `src/shared/modules/replays.ts` (~:518) and to `src/renderer/src/modules/replays/locale/en.json`
  (`play.error` block), user wording such as "The mod folder {{mod}} does not exist in this
  installation." The renderer already shows play errors (`useDemoPlay.ts` `setError` → action-bar
  note `actionbar-action-error`). Tests: `src/main/modules/replays/demo-play.test.ts` › "playing a
  demo whose mod game dir is missing is refused with a reason and stages nothing"; extend flow
  `scripts/flows/replays-mod-warning.mjs` with a step: Play anyway on the missing-mod demo shows
  `actionbar-action-error` with the reason (seed the demo's mod without a game dir if the fixture
  has one).

- **D2 — Play is single-flight and a failed trust does not play (renderer).** In
  `src/renderer/src/modules/replays/ReplaysView.tsx`: `runPlay` (~:476-518) gets an in-flight guard
  (a ref set before the first await, cleared in `finally`), so a second Play while one starts
  starts nothing. "Play anyway" (~:1060-1068, `trustModWarningMod(modGameDir).finally(() => void
  play(true))`) plays only when the trust `Outcome` is ok; on failure the dialog stays open and
  shows `replays.modWarning.error` (add it to `locale/en.json` under `modWarning`, e.g. "Could not
  remember this mod. Try again or cancel.") as a visible line in
  `src/renderer/src/modules/replays/components/ModMissingConfirmDialog.tsx` (new optional `error`
  prop, `role="alert"`). `confirmingModMissing` (useState ~:441; `modOffer`/`installError` are set
  beside it ~:507-510) resets when `selectedId` changes. Tests: `ReplaysView.test.tsx` › "a second
  Play while one is starting starts nothing", › "a failed trust does not play and shows why", ›
  "changing the selection closes the missing-mod confirmation";
  `components/ModMissingConfirmDialog.test.tsx` › "an error is shown as an alert".

- **D3 — A stop whose kill succeeds settles without an exit event (main).**
  `src/main/modules/replays/playback-stop.ts`: after `launch.terminatePlayback()` returns `true`
  (~:59-77) start `STOP_KILL_SETTLE_MS = 5000`; if no launch state `exited`/`failed` arrived by
  then, settle (`pending = false`) and end the session through the same path an `exit` takes
  (playback state `ended` to the renderer, follower end, cvar restore) — find that path in
  `src/main/modules/replays/index.ts` (~:535) and inject it as a dep, do not duplicate it; a real
  exit before the timer clears it. The renderer's `playback-store.ts` already leaves Stopping on
  `ended`. Use injected timers as the existing `STOP_EXIT_TIMEOUT_MS` tests do. Tests:
  `src/main/modules/replays/playback-stop.test.ts` › "a kill without an exit event ends the session
  after the settle time", › "an exit before the settle time ends the session once".

- **D4 — An action-bar stop refusal is visible (shell renderer).**
  `src/renderer/src/components/shell/ActionBar.tsx` `case 'stop': void demo.stop()` (~:90) discards
  the `LocalizedMessage | null` it returns. Show a non-null result as a sticky error toast with
  `toastOutcomeError(pushToast, { ok: false, error })` from `src/renderer/src/lib/toast.ts` (see
  `AppShell.tsx` for how `pushToast` is obtained). Test:
  `src/renderer/src/components/shell/ActionBar.test.tsx` › "a refused stop from the action bar
  shows the reason".

- **D5 — Quit while a staged demo runs leaves the original stage values (main).** Story 163 keeps
  the game running on launcher quit (`src/main/services/launch.ts` `releasePlaybackSession`, "never
  kills"); the engine then writes the stage `vid_fullscreen`/`vid_geometry` on its exit, and the
  next start's `applyPending` (`src/main/modules/replays/session-cvar-restore.ts` ~:324, pending
  file `SESSION_CVARS_PENDING_FILE`) may run before that write. Fix both sides: (a) in
  `src/main/modules/replays/index.ts`, register `launch.onBeforePlaybackRelease` (`launch.ts` ~:291;
  runs before stdin ends, so a last console line still reaches the engine) so a live staged session
  sends one line setting every `SESSION_RESTORE_CVARS` name (`demo-play.ts:51`) back to the value
  snapshotted for this session — the engine's write-on-exit then persists the originals; (b) the
  pending record stores the game's pid, and `applyPending` leaves the file alone while that pid is
  alive (injected `isAlive(pid)`, default `process.kill(pid, 0)`), retrying on an interval until it
  is gone; a record without pid restores at once as today. Tests: `session-cvar-restore.test.ts` ›
  "a pending restore waits while the recorded game is still running", › "a pending restore without
  a pid restores at once"; `src/main/modules/replays/index.test.ts` › "releasing a staged session
  hands the engine its original stage values"; extend flow `scripts/flows/replays-stage.mjs` with a
  last step: close the app while the staged demo runs; once the stub exits, its `q2config.cfg` holds
  the pre-session `vid_fullscreen`/`vid_geometry` lines (if `scripts/lib/stub-engine.cjs` does not
  write archived cvars on exit, add that).

- **D6 — Q2PRO-readable origins and latest geometry wins (main).**
  `src/main/modules/replays/stage.ts` (~:77) emits `${w}x${h}+${x}+${y}`, so a negative origin is
  `+-1920`, which Q2PRO's `strtol`-after-sign parse reads as 0. Emit one sign per origin
  (`200x100-1920+0`); `src/main/modules/replays/geometry.ts` `parseGeometry` accepts `[+-]N` and
  still reads the old `+-N`. In `stage-follow-session.ts` / `stage-follow.ts`, pin with tests that
  (i) a stage report or display-scale change during playback replaces the desired geometry, also
  after a failed send (the retry sends the latest, not the failed one), and (ii) leaving fullscreen
  (`setSuspended(false)`) places the latest reported rect at once and re-sends it even when it equals
  `sentGeo`; change code only where those tests are red. Tests: `stage.test.ts` › "a display left of
  the primary gives a single-sign origin" (replaces the `+-1920` expectation ~:88);
  `geometry.test.ts` (create if absent) › "both origin forms parse"; `stage-follow-session.test.ts` ›
  "a stage moved during fullscreen is placed when fullscreen ends", › "leaving fullscreen re-sends
  the geometry"; `stage-follow.test.ts` › "a retry after a failed send places the latest geometry".

- **D7 — A user Alt+Enter racing a queued fullscreen switch ends in a defined mode (main).**
  `src/main/modules/replays/playback-channel/windows-channel.ts`: the switch state is `mode`
  (`stage`/`entering`/`fullscreen`), `enteringSwitchesMode`, `unackedSwitchSeq` (~:100-125),
  `reachFullscreen`, and the ACK/timeout handling (~:290-340). Case: a launcher fullscreen switch is
  queued or in flight and the user presses Alt+Enter in the game (fullscreen readback before the
  switch's ACK, or a toggle back to window). Write the failing tests first in
  `windows-channel.test.ts` with its simulated engine (`engine.state.fullscreen = true` ~:849;
  queued-drop cases ~:697): the switch is not lost, the user is not toggled back out of fullscreen,
  queued non-switch commands are not dropped beyond today's documented rule, and `onDisplayChange`
  reports the mode the engine is in. Then fix. Check `linux-channel.ts` for the same race and fix it
  the same way if present (test in `linux-channel.test.ts`). Tests: `windows-channel.test.ts` › "a
  user Alt+Enter while a fullscreen switch is queued ends in fullscreen once", › "a user Alt+Enter
  back to window while the switch is in flight reports the window mode".

- **D8 — The replace dialog shows the value being written (renderer).**
  `src/renderer/src/modules/replays/demo-editor-store.ts`: `quickEdit` (~:362) shows an overlay;
  when the write needs confirmation, `park()` (~:203-216) copies it to `drafts[id].pendingOverlay`,
  then `enqueue`'s `finally` (~:171-189) deletes `quickPending[id]`, so the detail panel's
  rating/favourite fall back to the old `row.sidecar.values` while `ReplaceSidecarDialog` is open.
  Keep `quickPending[id]` while `drafts[id].replace` is set; Cancel (`dropReplace` ~:300-308) still
  drops it; Confirm (`confirmEdit` ~:344) proceeds as today. Tests: `demo-editor-store.test.ts` › "a
  quick edit waiting for replace confirmation keeps showing the new value", › "cancelling the
  replace shows the stored value again"; extend flow
  `scripts/flows/replays-edit-unreadable-sidecar.mjs` with a step: quick-edit the rating, and while
  the replace dialog is open the rating control shows the new value.

- **D9 — Join is disabled for a server the filter hides (servers renderer).**
  `src/renderer/src/modules/servers/useServerJoin.ts` resolves the target via `resolveServer`
  (~:42) over the unfiltered `entries` (`src/renderer/src/modules/servers/ServersView.tsx`
  ~:113-118); the filtered list is `visible = filterServers(sortedRows, filter)` (~:145). Resolve
  the Join target against the visible rows on the list and the watchlist tab, so
  `joinAction.disabled` is true in the same render the filter hides the server. Update
  `docs/systems/servers-module.md` if it states when Join is enabled. Tests:
  `ServersView.actionbar.test.tsx` › "Join is disabled once the filter hides the selected server";
  `ServersView.watchlist.test.tsx` › "a watchlist server hidden by the filter cannot be joined";
  extend flow `scripts/flows/servers-filter-search.mjs` with a step: select a server, type a search
  that hides it, the action-bar Join is disabled.

- **D10 — Docs.** `docs/TECH-DEBT.md`: remove rows TD-008, TD-010, TD-011, TD-019, TD-029, TD-030
  and add one row (next free id, since `S37`, area `replays`, low, source
  `[story 321](requirements/321-demo-play-stop-and-stage-end-in-a-defined-state.md)`): "An even
  count of pending pause toggles lets a stale readback clear the chain early
  (`optimistic-timeline.ts`)". `docs/systems/replays-module.md` (Persisted state / Limitations):
  the quit-time stage restore (last console line + pid-guarded pending record), the single-sign
  `vid_geometry` origin, the stop settle bound, the missing-game-dir refusal. `CHANGELOG.md`
  `## Unreleased` → `### Fixed`, one line, e.g. "- Demo playback: play, stop and quitting always
  end in a clear state." Check: `node scripts/check-docs.mjs` passes.

## Model Hints

- D5 → deliverable-hard: the restore races a separate process's write-on-exit across launcher runs
  (story 163 keeps the game alive), so an ordering slip in `onBeforePlaybackRelease` or the pid
  guard silently brings the stage values back.
- Review: → story-review-hard — a quit restore that rewrites the file while the engine is still
  alive passes fake-timer unit tests and a default review yet loses to the engine's write-on-exit;
  likewise a D7 fix that passes its test by dropping the queued switch.

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/demo-play.test.ts` › "playing a demo whose mod game dir is
  missing is refused with a reason and stages nothing"; e2e `scripts/flows/replays-mod-warning.mjs`
  › replays-mod-warning (D1 step)
- AC2 → component `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "a second Play while
  one is starting starts nothing", › "a failed trust does not play and shows why";
  `src/renderer/src/modules/replays/components/ModMissingConfirmDialog.test.tsx` › "an error is
  shown as an alert" (not triggerable in the seeded app — see Decisions)
- AC3 → unit `src/main/modules/replays/playback-stop.test.ts` › "a kill without an exit event ends
  the session after the settle time", › "an exit before the settle time ends the session once";
  component `src/renderer/src/components/shell/ActionBar.test.tsx` › "a refused stop from the
  action bar shows the reason"; the normal stop path stays walked by e2e
  `scripts/flows/replays-stop.mjs` › replays-stop
- AC4 → unit `src/main/modules/replays/session-cvar-restore.test.ts` › "a pending restore waits
  while the recorded game is still running", › "a pending restore without a pid restores at once";
  `src/main/modules/replays/index.test.ts` › "releasing a staged session hands the engine its
  original stage values"; e2e `scripts/flows/replays-stage.mjs` › replays-stage (D5 step);
  unit `src/main/modules/replays/stage.test.ts` › "a display left of the primary gives a single-sign
  origin"; `src/main/modules/replays/geometry.test.ts` › "both origin forms parse";
  `src/main/modules/replays/stage-follow-session.test.ts` › "a stage moved during fullscreen is
  placed when fullscreen ends", › "leaving fullscreen re-sends the geometry";
  `src/main/modules/replays/stage-follow.test.ts` › "a retry after a failed send places the latest
  geometry"; `src/main/modules/replays/playback-channel/windows-channel.test.ts` › "a user Alt+Enter
  while a fullscreen switch is queued ends in fullscreen once", › "a user Alt+Enter back to window
  while the switch is in flight reports the window mode"
- AC4 → manual residue: a real Alt+Enter in Q2PRO racing a queued switch — the stub engine has no
  window or key input and synthetic keys never reach Q2PRO (User decision).
- AC4 → manual residue: real Q2PRO places a window at a single-sign negative origin on a monitor
  left of the primary — needs that monitor layout and the real engine.
- AC5 → unit `src/renderer/src/modules/replays/demo-editor-store.test.ts` › "a quick edit waiting
  for replace confirmation keeps showing the new value", › "cancelling the replace shows the stored
  value again"; e2e `scripts/flows/replays-edit-unreadable-sidecar.mjs` ›
  replays-edit-unreadable-sidecar (D8 step); component
  `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "changing the selection closes the
  missing-mod confirmation"; component
  `src/renderer/src/modules/servers/ServersView.actionbar.test.tsx` › "Join is disabled once the
  filter hides the selected server", `src/renderer/src/modules/servers/ServersView.watchlist.test.tsx`
  › "a watchlist server hidden by the filter cannot be joined"; e2e
  `scripts/flows/servers-filter-search.mjs` › servers-filter-search (D9 step)
- AC6 → doc check: `node scripts/check-docs.mjs` green and the six rows absent from
  `docs/TECH-DEBT.md` (D10; a row deletion has no behaviour, the review checks the diff)

Coverage: AC1 D1 · AC2 D2 · AC3 D3+D4 · AC4 D5+D6+D7 · AC5 D2+D8+D9 · AC6 D10.

## Done
