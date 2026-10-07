---
id: 174
title: the game console is not flooded by the launcher
status: done # draft -> ready -> in-progress -> done
created: 2026-09-29
---

## Requirement

While the launcher steers a demo on Windows, its control loop ([[164]]) prints about 13
`Execing q2l_ctl.cfg` and 13 `POS m:ss.f` lines per second into the game console (measured in
[[169]], P7). They bury everything else in the console and show up in the notify lines at the top of
the picture — on the stage ([[170]]) that is right over the demo. The launcher's own plumbing must
not be visible in the game.

The position readback itself must keep working: [[164]] reads `POS` lines from the logfile, and the
logfile is buffered — steady output is what keeps it flowing ([[169]] side finding).

## Acceptance Criteria

- [x] **AC1** — While a demo plays under the launcher's control, no launcher plumbing lines
      (`Execing q2l_…`, `POS …`, `ACK …`) appear in the notify lines over the picture.
- [x] **AC2** — The console scrollback is not flooded: either the plumbing lines do not reach it, or
      their rate is reduced to a stated maximum per second (recorded decision).
- [x] **AC3** — Position updates still reach the timeline at least as often as today's
      `POSITION_PUSH_MS` (250 ms), and commands are still acknowledged — pinned by the existing
      channel tests plus a test for the new behaviour.
- [x] **AC4** — Any cvar the launcher changes for this (e.g. `con_notifytime`) is restored after the
      session and does not end up permanently in the user's config.

## Decisions (Sprint)

- **(User)** Chat in demos: the demo's own chat notify lines must stay visible: do NOT use con_notifytime 0 (or anything that hides chat).
- **(User)** Mechanism (Q1) — how can AC1 and visible chat both hold: option (a). While the launcher-controlled session runs, set `scr_chathud 1` and `con_notifylines 0`, and restore both afterwards (AC4). Chat stays visible in Q2PRO's chat HUD. The demo's other notify lines are hidden too (accepted). The Windows loop tick slows to ~200 ms. This is how the Q2 (User) decision above is implemented.
- **Tick = `wait 13`** (named `LOOP_WAIT_FRAMES`), because spike 169 P7 measured ~65 command frames/s, so 13 frames ≈ 200 ms.
- **AC2's stated maximum is 10 plumbing lines/s** at the measured frame rate. On Windows that is one `Execing` plus one `POS` line per tick. On Linux it is the unchanged 100 ms `echo POS` poll. Both land on the same number, and the Linux readback needs no slowing because stdout is not buffered.
- **AC3 holds without new timing code:** `playback-control.ts` pushes `latest()` every `POSITION_PUSH_MS` (250 ms) independently of the tick, and a 200 ms tick still refreshes that value more than 4× per second.
- **The two cvars go as `+set` in both platforms' `argsBeforeDemo`**, after the existing logfile/`sys_console` args and 172's `q2l_session` arg. That path already carries the channel's session cvars and 170's stage args, and it prints nothing, so 174 adds no console lines.
- **They apply for the whole launcher-controlled session, stage and fullscreen alike.** The Linux 100 ms poll keeps echoing `POS` in fullscreen too, and one rule avoids re-toggling cvars inside 172's guarded fullscreen/back-to-window cfg logic.
- **AC4 reuses 170's restore helper.** `con_notifylines` and `scr_chathud` are appended to its name list. The snapshot condition becomes "the launch args set a listed cvar", so every channel playback is snapshotted, with or without a stage rect. 170 built the helper for exactly this and rules out a second mechanism.
- **The first deliverable probes the real binary** (`C:\Games\Q2Pro`). It checks that the chat HUD draws during demo playback, that `con_notifylines 0` really leaves no notify line, and that a pre-existing `seta con_notifylines` in `q2config.cfg` does not override the `+set`. The stub engine renders nothing, so only the real game can show this.
- **A failed probe stops the build.** It is reported, with no silent fallback such as `con_notifytime 0`, because any other mechanism would change a binding (User) decision.

## Open Questions

- ~~**Q1 — Mechanism:** the check against the binary
  (`C:\Games\Q2Pro\q2pro.exe`, `r3834~601a8df8`, string table) found **no quiet path**:
  - `exec` takes no options and prints `Execing %s` on every call — one line per loop tick, as long
    as the Windows loop polls the control file, whatever else changes.
  - `echo` has options (`-c` colour, `-l` print level, `-n` no newline, `-e` escapes), but in Q2PRO
    every print level goes through the graphical console and so into the notify lines; a level only
    changes colour and the logfile's `@` tag (from the source structure, not probed).
  - What the build does offer for the notify area: `con_notifytime`, `con_notifylines`,
    `clearnotify` (all of them hide chat too, which the binding (User) decision rules out) and
    Q2PRO's separate **chat HUD** (`scr_chathud`, `scr_chathud_lines/_time/_x/_y`, `cl_chat_notify`).

  So AC1 (no plumbing in the notify lines) and the (User) decision (chat stays visible) can only both
  hold if chat moves out of the notify lines. That is a design choice, not a detail:
  - **(a) Chat HUD during the windowed session (recommended):** while the loop runs, the launcher
    sets `scr_chathud 1` and `con_notifylines 0`, and restores both afterwards (AC4). Chat stays
    visible, but in Q2PRO's chat HUD instead of the notify lines; **every other notify line of the
    demo (obituaries, server/match messages) is hidden too** for the windowed stage (fullscreen,
    [[172]], stops the loop and would restore them). Scrollback (AC2): tick slowed from `wait 5`
    (~77 ms) to ~200 ms → at most ~10 plumbing lines/s, POS still ≥ 4/s. Needs a first probe D that
    shows the chat HUD draws during demo playback.
  - **(b) Rate only:** keep the notify lines as they are and only slow the tick (~200–250 ms →
    ~8–10 plumbing lines/s). Plumbing stays visible over the picture, so AC1 is dropped or reworded
    to a rate — the story's goal ("must not be visible in the game") is not met.
  - **(c) Split:** do (b) now as a stop-gap and open a new story for a print-free Windows transport
    (e.g. input through Q2PRO's `sys_viewlog` console window — a native route like the one
    [[134]] withdrew).~~ answered → Decisions (Sprint)

- ~~**Q2 — Chat in demos:** is hiding the demo's own chat notify lines acceptable if `con_notifytime`
  is the chosen mechanism?~~ answered → Decisions (Sprint)

## Plan

The plumbing disappears from the picture because chat moves to Q2PRO's chat HUD and the notify lines are off for the session. Slowing the Windows loop caps the scrollback rate. The two cvars are restored through 170's helper. Order: real-binary probe, then protocol/args, then restore wiring.

1. **Probe (D1).** A script under `spikes/174-chat-hud/` launches the real Q2PRO with a demo that contains chat and the two `+set`s. It screenshots the window and reads the cvars back from the logfile.
2. **Protocol (D2).** `protocol.ts` gets `LOOP_WAIT_FRAMES = 13`, `NOTIFY_SESSION_CVARS`, and the two `+set`s in `windowsLaunchArgs()`/`linuxLaunchArgs()`. The tests, the two play flows' expected launch lines and the CHANGELOG follow.
3. **Restore (D3).** `index.ts` appends `NOTIFY_SESSION_CVARS` to 170's restore name list. `demo-play.ts` takes a snapshot whenever the launch args set a listed cvar.

This builds after 170 (restore helper) and 172 (`q2l_session` arg, `FS` echo). 174 changes neither the control file's echo nor any console line.

## Deliverables

- [x] **D1 — The chat HUD shows during demo playback (real-binary probe).**
      Files: `spikes/174-chat-hud/probe.mjs` (new). Mirror `spikes/169-windowed-stage/harness.mjs`
      (launch, window capture) and its `win-probe.ps1`.
  - Launch `C:\Games\Q2Pro\q2pro.exe` windowed with these args:
    - `+set vid_fullscreen 0 +set vid_geometry 800x600+100+100`
    - `+set logfile 2 +set logfile_flush 1 +set logfile_name q2l_probe.log`
    - `+set con_notifylines 0 +set scr_chathud 1`
    - `+demo <a demo that contains player chat>`. Find one under `C:\Games\Q2Pro` or the repo's
      fixtures, and name it in the result.
  - Before the launch, add the line `seta con_notifylines "4"` to that game's `q2config.cfg`. Back
    the file up first and put it back byte-exact afterwards.
  - After the chat moment:
    - Run `echo NL $con_notifylines CH $scr_chathud` through a cfg the probe execs (e.g. `+exec` a
      probe cfg with a `wait` before the echo).
    - Capture a screenshot of the game window.
  - End the game with `WM_CLOSE`, never a kill. The logfile is buffered and only flushes on a clean
    exit.
  - It passes when the log shows `NL 0 CH 1` and the screenshot shows the chat text in the chat HUD
    with no notify lines at the top.
  - Write the verdict, the demo used and the screenshot path into this story's `## Done`. If the
    probe fails, stop and report. Do not substitute another cvar; that is a binding user decision.
- [x] **D2 — The session hides notify lines, enables the chat HUD and ticks at ~200 ms.**
      Files: `src/main/modules/replays/playback-channel/protocol.ts`, `protocol.test.ts`,
      `scripts/flows/replays-play-q2pro.mjs`, `scripts/flows/replays-play-mvd2.mjs`, `CHANGELOG.md`.
  - `protocol.ts`:
    - Add `export const LOOP_WAIT_FRAMES = 13`. Its comment: spike 169 P7 measured ~65 command
      frames/s, so this is ≈200 ms and caps plumbing at ≈10 lines/s. Make it the default of
      `buildLoopCfg` instead of `5`.
    - Add `export const NOTIFY_SESSION_CVARS = ['con_notifylines', 'scr_chathud'] as const`, and
      `notifySessionArgs()`, which returns
      `['+set', 'con_notifylines', '0', '+set', 'scr_chathud', '1']`.
    - Append `notifySessionArgs()` at the end of `argsBeforeDemo` in both `windowsLaunchArgs()` and
      `linuxLaunchArgs()`. It goes after whatever is there already: the logfile/`sys_console` args,
      plus story 172's `+set q2l_session 1` if that has landed.
    - Leave `LINUX_POLL_MS` (100), `POSITION_PUSH_MS` and `ACK_TIMEOUT_MS` unchanged, and add no
      echo or console line.
  - Tests in `protocol.test.ts`:
    - Update › "builds the loop and stop files" to expect `wait 13`.
    - New › "the loop ticks every LOOP_WAIT_FRAMES frames": `buildLoopCfg()[1]` contains
      `wait 13;`, and `LOOP_WAIT_FRAMES * (1000 / 65)` lies in 180–220 ms.
    - New › "both platforms hide notify lines and enable the chat HUD for the session": the pairs
      `con_notifylines 0` and `scr_chathud 1` appear in both `argsBeforeDemo`, and neither
      `argsAfterDemo` contains them.
    - The existing › "never puts +demo in the args and keeps the loop exec after the demo" stays
      green.
  - `windows-channel.test.ts` and `playback-control.test.ts` must pass unchanged. They pin the ACK
    and the 250 ms position push.
  - Flows: in `replays-play-q2pro.mjs` (L101-102) and `replays-play-mvd2.mjs` (L73-74), the
    expected `endsWith` strings gain ` +set con_notifylines 0 +set scr_chathud 1` right before
    ` +demo`, on both platform branches.
  - `CHANGELOG.md` gets a short, user-facing `### Changed` entry: the launcher's plumbing no longer
    scrolls over the demo, and chat shows in the chat HUD.
- [x] **D3 — The notify cvars are restored after the session.**
      Files: `src/main/modules/replays/index.ts`, `src/main/modules/replays/demo-play.ts`,
      `src/main/modules/replays/demo-play.test.ts`, `src/main/modules/replays/session-cvar-restore.test.ts`.
  - It builds on two existing pieces:
    - Story 170's `createCvarRestore({ names, fs, pendingPath })` in `session-cvar-restore.ts`.
      Before launch it snapshots the named `seta`/`set` lines of the game's `q2config.cfg`. After
      exit it restores them line-exact, and at start it applies a pending snapshot.
    - D2's `NOTIFY_SESSION_CVARS` from `playback-channel/protocol.ts`.
  - In `index.ts`, the restore `names` become
    `['vid_fullscreen', 'vid_geometry', ...NOTIFY_SESSION_CVARS]`.
  - In `demo-play.ts`, replace 170's snapshot condition ("stage or normal-window args") with this
    one: snapshot when the final launch args contain `+set <name>` for any restore name. Every
    channel playback then gets a snapshot, with or without a stage rect, and a normal launch still
    gets none.
  - The helper itself stays unchanged.
  - Tests:
    - `session-cvar-restore.test.ts` › "restores con_notifylines and scr_chathud like the stage
      cvars": a `seta con_notifylines "4"` that was present before is put back, an absent
      `scr_chathud` is removed, and other lines stay byte-identical with CRLF.
    - `demo-play.test.ts` › "a channel playback without a stage rect is still snapshotted".
    - `demo-play.test.ts` › "a normal launch takes no snapshot" stays green.

## Model Hints

- No deliverable-hard. D1 is a probe script. D2 changes constants and arg lists that exact tests
  pin. D3 appends names to 170's already-hardened helper and changes one condition.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/playback-channel/protocol.test.ts` › "both platforms hide
  notify lines and enable the chat HUD for the session"; e2e `scripts/flows/replays-play-q2pro.mjs`
  › "replays-play-q2pro" (the launch line carries `+set con_notifylines 0 +set scr_chathud 1`).
  **manual residue:** the real Q2PRO picture has no notify lines and shows the chat in the chat HUD.
  The stub engine renders nothing and CI has no Q2PRO install. The D1 probe
  `spikes/174-chat-hud/probe.mjs` checks this against `C:\Games\Q2Pro` and records its verdict in
  `## Done`.
- AC2 → unit `src/main/modules/replays/playback-channel/protocol.test.ts` › "the loop ticks every
  LOOP_WAIT_FRAMES frames" (the ≤ 10 lines/s maximum is a recorded decision); unit › "builds the
  loop and stop files".
- AC3 → existing unit `src/main/modules/replays/playback-channel/windows-channel.test.ts` (ACK
  tests) and `src/main/modules/replays/playback-control.test.ts` (250 ms position push), unchanged
  and green; new unit `protocol.test.ts` › "the loop ticks every LOOP_WAIT_FRAMES frames"; e2e
  `scripts/flows/replays-timeline.mjs` › "replays-timeline" still green on the slower tick.
- AC4 → unit `src/main/modules/replays/session-cvar-restore.test.ts` › "restores con_notifylines
  and scr_chathud like the stage cvars"; unit `src/main/modules/replays/demo-play.test.ts` › "a
  channel playback without a stage rect is still snapshotted" and › "a normal launch takes no
  snapshot".

## Done

The launcher-controlled session now sets `con_notifylines 0` + `scr_chathud 1` (both platforms), the Windows loop ticks every 13 frames (~200 ms, at most ~10 plumbing lines/s), and both cvars are snapshotted/restored through 170's helper for every channel playback.

Commit message: `174: quiet game console (con_notifylines 0 + scr_chathud 1 session args, 200 ms Windows tick, notify cvars restored)`

Verification (narrow gate): `npm run build`, `npm run typecheck` green; `npx vitest run --changed HEAD` green (11 files / 146 tests); `npm run ui:flow -- replays-play-q2pro`, `replays-play-mvd2`, `replays-timeline` green after the last edit. No full gate (sprint runs it).

- D1 probe: PASS against `C:\Games\Q2Pro` (`r3834`), demo `opentdm/demos/PFAU_20221127-053327_q2dm1.mvd2` with `+set game opentdm`, pre-existing `seta con_notifylines "4"` in q2config.cfg did not override the `+set`. Log `NL 0 CH 1`; screenshot `spikes/174-chat-hud/results/shot-16s.png` shows "lamb shanker: gl" in the chat HUD, no notify lines at top. q2config.cfg restored byte-exact, clean WM_CLOSE exit.
- AC1: protocol.test "both platforms hide notify lines..." + flow replays-play-q2pro passed; real-picture check = the D1 probe (manual residue: stub engine renders nothing, CI has no Q2PRO).
- AC2: protocol.test "the loop ticks every LOOP_WAIT_FRAMES frames" + "builds the loop and stop files" passed.
- AC3: windows-channel.test and playback-control.test unchanged and green; flow replays-timeline green.
- AC4: session-cvar-restore.test "restores con_notifylines and scr_chathud..." + demo-play.test "a channel playback without a stage rect is still snapshotted" / "a normal launch takes no snapshot" passed.
- Review (default, 1 cycle): PASS, no fixes. Unfixed by choice: nothing tests the `index.ts` wiring of `SESSION_RESTORE_CVARS` as restore names (it is one shared constant with the snapshot condition in `demo-play.ts`).

Decisions:

- The plan's flow expectations were stale against 172/170: real launch order is `q2l_session 1`, notify `+set`s, stage args, `+demo`. Flows now check `head + q2l_session + notify` and `endsWith(+demo ...)` (mvd2 flow uses includes + endsWith because stage args sit between).
- New loop test asserts `buildLoopCfg()[2]` (the alias line), not `[1]` (`set q2l_seq 0`).
- `SESSION_RESTORE_CVARS = [...STAGE_CVAR_NAMES, ...NOTIFY_SESSION_CVARS]` lives in `demo-play.ts` (helper stays unchanged) and is what `index.ts` passes as names.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 5
