---
id: 164
title: the launcher speaks to a running demo
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

The timeline ([[165]]) and the console field ([[166]]) need one thing from main: **send a command to
the running engine, and learn where the playback is**. This story is that channel, behind one
interface with a platform-specific implementation (concept `docs/concepts/demo-browser.md` §12.3,
DEMO-26, DEMO-27):

- **Linux:** `+set sys_console 1`; commands on stdin, position read from stdout — over [[163]]'s
  pipes.
- **Windows:** cfg polling (launcher-written control file, position via `logfile`) — spike [[133]]
  ended in **go**; [[134]]'s native helper is withdrawn.

Spike [[133]] is done and its result recorded in
[`spikes/133-q2pro-control/RESULT.md`](../../spikes/133-q2pro-control/RESULT.md); the Windows
implementation for this story is cfg polling, not the native helper.

**Spike findings to carry over** (from RESULT.md's "Harness fixes found during the run"):
- `+demo` must come before `+exec` — the loop alias re-inserts itself at the front of the command
  buffer every tick, so anything queued after it never runs.
- Log path and format: `<gamedir>/logs/<logfile_name>`, every line carries the `logfile_prefix`
  timestamp, the file is appended across runs (start reading at its current end), and reads can
  land mid-line (buffer the unterminated tail).
- Exactly-once delivery needs an engine-side guard — the pinned build's
  `if $spike133_seq != N then "<command>; set spike133_seq N; echo ACK N"`, with
  `set spike133_seq 0` in the loop cfg.
- Position comes from `$cl_demopos`; `$time` does not exist in Q2PRO.
- MVD files must be passed with their `.mvd2` extension — `demo` then hands them to `mvdplay`;
  without an extension `demo` assumes `.dm2`.

Open items the spike left for this story to close:
- Latency ~0.6 s p95 (587–701 ms) vs. a 300 ms target — needs tuning; named levers are a lower
  `--wait`, faster log polling, and reading the open file without `stat`.
- CPU cost of the loop (loop-off vs. loop-on) was not measured — needs its own comparison.
- The loop must stop itself on `Demo finished` or when the session ends; the spike's loop kept
  running past the demo's end.
- Behaviour across a map change inside a demo is untested and needs checking with a multi-map demo.
- MVD commands: `seek` also takes a percentage, and the chased player is switched with
  `cmd invnext` / `cmd invprev` / `cmd chase [player_id]`.

## Acceptance Criteria

- [x] **AC1** — A main-side channel interface offers "send command" and a "position" stream for the
      current playback session, with a Linux and a Windows implementation.
- [x] **AC2** — On Linux, a command reaches the engine via stdin and the position is parsed from
      stdout.
- [x] **AC3** — On Windows, commands and position travel over the route [[133]] decided.
- [x] **AC4** — Position (and duration, where the engine reports it) is pushed to the renderer as a
      `module:event` at a steady interval while the demo plays.
- [x] **AC5** — When the game exits, the channel closes, the last event says the session ended, and
      any control/log files the channel created are removed.
- [x] **AC6** — A command sent while no session exists is rejected with a typed error.
- [x] **AC7** — The parsing of engine output into a position is pure code with unit tests fed from
      recorded output; both implementations are exercised against a stubbed engine in tests.

## Open Questions

- [x] ~~**Q1 — Position source** — which Q2PRO output carries the position (`cl_demopos`,~~
      ~~`scr_demobar` text, a periodic command echo), and how often?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Interval** — how often position events are pushed (smooth enough for a seek bar, cheap~~
      ~~enough for IPC).~~ answered → Decisions (Sprint)
- [x] ~~Spike 133 open items (latency, CPU, loop stop, map change, MVD commands)~~ answered →
      Decisions (Sprint)

## Decisions (Sprint)

- **(User, sprint-level)** Playback goes through Q2PRO only for now; no r1q2 playback — the channel
  exists only for Q2PRO sessions.
- **Position source (Q1):** `echo POS $cl_demopos` — on Windows once per loop tick into the logfile
  (~85 ms measured), on Linux written to stdin by the launcher every 100 ms and read from stdout;
  `POS` with an empty value means "not playing". Reason: the only readback spike 133 verified, it
  works for `.dm2` and `.mvd2`, and `scr_demobar` is on-screen only.
- **Duration:** the engine reports none over this route, so the position event carries the index's
  duration ([[138]]) handed in when the session opens, `null` if unknown. Reason: [[138]] counts it
  exactly, and [[165]] AC6 already takes it from there first.
- **Interval (Q2):** main pushes `playback.position` every **250 ms** while the session is playing
  (paused included — position stands still), and stops after `finished`/`ended`. Reason: 4 Hz is
  smooth for a seek bar at the engine's 0.1 s resolution and negligible IPC; the engine samples
  faster, so the push reads the latest sample.
- **Latency (spike open item):** apply the named levers — log read every **50 ms** from a held-open
  fd to EOF (no `stat`), control file written at once on send — and keep `wait 5` (at 125 fps a tick
  is ~40 ms, not the bottleneck; a lower wait adds unmeasured CPU). Send→ACK latency is logged at
  debug level; the p95 against the 300 ms bar is measured by hand (manual residue below). Reason: no
  test may start a real engine ([[159]] AC8), and the user accepted ~0.6 s for now (RESULT.md).
- **CPU (spike open item):** loop-on vs loop-off is measured by hand with the real engine and recorded
  in `## Done` (manual residue). Reason: CPU of a real renderer cannot be faked by a stub.
- **Loop stop (spike open item):** on `Demo finished` the Windows channel writes a stop-shaped control
  file (`alias q2l_loop ""`, so the next reschedule is a no-op), the Linux channel stops its stdin
  poll, and a `playback.state: finished` event is pushed; commands after that are rejected like
  "no session". Reason: RESULT.md shows the engine only answers `Not playing a demo.` afterwards.
- **Map change (spike open item):** the channel keeps no per-map state and takes every `POS` as is
  (it may jump); checked by hand with a multi-map demo (manual residue). Reason: no multi-map demo
  exists in `docs/fixtures/demos/`, and a stub cannot show real engine behaviour across a map load.
- **MVD commands:** the channel is command-agnostic — `seek N%`, `cmd invnext`/`invprev`/`chase` pass
  through unchanged; which ones are offered is [[162]]/[[165]]. Reason: AC1 asks for "send command",
  not a command vocabulary.
- **Exactly-once on Windows:** one guarded command in flight at a time; the next is written after its
  `ACK` (or a 2 s timeout, logged); FIFO queue capped at 8, beyond it the send is rejected
  (`replays.playback.error.busy`). Reason: two guarded lines in one file re-fire each other (`!=`
  guard), and the pinned build's other `if` operators were not verified.
- **Line guard at the channel:** `send` rejects an empty line, CR/LF, other control characters and
  `"` with `replays.playback.error.invalidCommand`, on both platforms. Reason: a newline breaks the
  stdin framing and a `"` breaks out of the guarded `if` string; the user-facing zod validation and
  the length cap stay [[166]]'s.
- **Files:** `<installRoot>/<gamedir>/q2l_loop.cfg`, `<installRoot>/<gamedir>/q2l_ctl.cfg` and a
  dedicated logfile `<gamedir>/logs/q2l_demo.log` (`+set logfile_name q2l_demo.log`), all removed at
  close and overwritten/removed at the next open if a crash left them. Reason: a dedicated log does
  not touch the user's `qconsole.log` and can be deleted (AC5); reading still starts at its current
  end, per RESULT.md.
- **Seams:** the channel contributes `argsBeforeDemo`/`argsAfterDemo` to [[159]]'s launch (`+demo`
  before `+exec`); the Linux channel takes a narrow `EngineIo` port adapted from [[163]]'s held
  stdin/stdout in the wiring D only; the Windows channel needs no pipes. Reason: 159/163 are refined
  in parallel — the narrow port keeps their shape change to one file.
- **Events:** `playback.position` `{ positionMs, durationMs }` and `playback.state`
  `{ state: 'playing' | 'finished' | 'ended' }`; `ended` is the last event of a session. The typed
  error of AC6 is an `Outcome` failure with `replays.playback.error.noSession`. Reason: the module's
  existing `REPLAYS_EVENTS` + `Outcome`/i18n-key conventions.
- **Stubbed engine = unit-level fakes:** Windows — a fake engine over a temp dir that re-executes the
  control file every tick (honouring the `$seq` guard) and appends prefixed lines to the log; Linux —
  `PassThrough` streams. No e2e flow here. Reason: 164 has no user-facing surface; [[165]]/[[166]]
  carry the e2e flows over this channel.

## Plan

All in main (`src/main/modules/replays/playback-channel/`) plus event/type constants in
`src/shared/modules/replays.ts`. No renderer UI, no new IPC invoke channel ([[165]]/[[166]] add
their handlers on top of `PlaybackControl.send`).

1. **D1 — protocol (pure):** channel interface + Q2PRO wire protocol: line parser (logfile prefix,
   `POS`, `ACK`, `Demo finished`), `m:ss.f` → ms, control/loop-cfg builders (idle, guarded command,
   stop), per-platform launch args, line guard. Unit tests fed from a real recorded log excerpt.
2. **D2 — Windows channel (cfg polling):** writes loop/control files atomically, tails the dedicated
   log, one-in-flight queue with ACK, stop on `Demo finished`, cleanup on close. Fake engine over a
   temp dir.
3. **D3 — Linux channel (stdin/stdout):** writes commands and the 100 ms `echo POS` poll to an
   `EngineIo` port, parses lines, stops on `Demo finished`. `PassThrough` fake.
4. **D4 — PlaybackControl + wiring:** owns the one current channel, picks the implementation by
   `process.platform`, pushes `playback.position` every 250 ms and `playback.state`, closes on game
   exit (`app.launch.onStateChange`), rejects sends without a session; wired into [[159]]'s play
   handler and [[163]]'s pipes.

Order D1 → D2 → D3 → D4 (D2/D3 independent after D1).

## Deliverables

- [x] **D1 — Channel interface and Q2PRO protocol (pure).** New
  `src/main/modules/replays/playback-channel/types.ts`: `PlaybackChannel` =
  `{ argsBeforeDemo: string[]; argsAfterDemo: string[]; start(): Promise<void>; send(line: string): Outcome<void>; latest(): { positionMs: number | null; finished: boolean }; onFinished(cb): () => void; close(): Promise<void> }`,
  plus `EngineIo = { writeLine(line: string): void; onLine(cb: (line: string) => void): () => void }`.
  New `protocol.ts` (no `node:` imports, no electron): `parseEngineLine(raw)` strips an optional
  `[YYYY-MM-DD HH:MM] ` logfile prefix and returns `{kind:'pos', positionMs|null}` (empty `POS` →
  null), `{kind:'ack', seq}`, `{kind:'finished'}` (`Demo finished`) or `{kind:'other'}`;
  `parseDemoPos('m:ss.f' | 'h:mm:ss.f')` → ms or null; `checkLine(line)` → `Outcome<void>`, rejecting
  empty, CR/LF, other control chars (< 0x20, 0x7f) and `"` with
  `replays.playback.error.invalidCommand`; `buildLoopCfg(waitFrames=5)` =
  `set q2l_seq 0` / `alias q2l_loop "exec q2l_ctl.cfg; wait 5; q2l_loop"` / `q2l_loop`;
  `buildControlFile(pending: {seq, line} | null)` = `echo POS $cl_demopos` plus, when pending,
  `if $q2l_seq != N then "<line>; set q2l_seq N; echo ACK N"`; `buildStopFile()` = `alias q2l_loop ""`;
  `windowsLaunchArgs()` → before: `+set logfile 2 +set logfile_flush 1 +set logfile_name q2l_demo.log`,
  after: `+exec q2l_loop.cfg`; `linuxLaunchArgs()` → before: `+set sys_console 1`, after: none.
  Constants for file names, 50 ms log poll, 100 ms Linux poll, 2 s ACK timeout, queue cap 8. Add
  i18n keys `replays.playback.error.{noSession,invalidCommand,busy}` to
  `src/renderer/src/i18n/locales/en.json`. Tests in `protocol.test.ts`, fed from a fixture
  `playback-channel/__fixtures__/q2pro-logfile.log`: copy real lines from the spike run log
  `C:\Games\Q2Pro\opentdm\logs\qconsole.log` (lines ~520–532: empty `POS` + `Not playing a demo.`;
  ~3008–3022: `Demo finished`; ~5675–5680: `[MVD] Chasing …`; the last ~20 lines, which end in an
  unterminated `POS 1` tail); if that file is absent, reconstruct the same shapes, e.g.
  `[2026-09-27 18:36] POS 1:11.4`, `[2026-09-27 18:22] ACK 3`, `[2026-09-27 18:22] Demo finished`,
  `[2026-09-27 18:16] POS`, `[2026-09-27 18:36] Execing spike133_ctl.cfg`. Tests: "classifies every line of the recorded Q2PRO logfile" — every fixture line
  classifies correctly; `parseDemoPos` on `0:02.4`, `5:02.8`, `1:02:03.4`, garbage; `checkLine`
  accepts `seek +10`, `seek 50%`, `cmd chase 3`, `pause; timescale 2` and rejects `""`, `a\nb`,
  `say "x"`, `\u0007`; the control file with a pending command is exactly the guarded shape;
  `+demo` never appears in the args and `+exec q2l_loop.cfg` is only in `argsAfterDemo`.

- [x] **D2 — Windows channel (cfg polling).** New
  `src/main/modules/replays/playback-channel/windows-channel.ts`:
  `createWindowsChannel({ gameDirPath, log })` implementing `PlaybackChannel` from `types.ts` with the
  builders/constants from `protocol.ts` (D1). `start()`: remove stale `q2l_*` files, write
  `q2l_loop.cfg` and an idle `q2l_ctl.cfg` in `gameDirPath` atomically (temp file + `rename` in the
  same dir), record the log's current end (`<gameDirPath>/logs/q2l_demo.log`, may not exist yet). A
  50 ms timer reads new bytes from a held-open fd to EOF (reopen if the file appears or shrinks),
  buffers the unterminated tail, feeds each full line to `parseEngineLine`, updates the latest
  position. `send(line)`: `checkLine` first; after finished → `replays.playback.error.noSession`;
  enqueue (cap 8 → `replays.playback.error.busy`); only one command in flight — write the guarded
  control file with the next `seq`, on its `ACK` (or 2 s timeout, logged as warn) rewrite idle and
  send the next; log send→ACK latency at debug. On `Demo finished`: write `buildStopFile()`, drop the
  queue, fire `onFinished`. `close()`: stop timers, close the fd, delete loop cfg, control file and
  log (tolerate EBUSY/ENOENT; retry once after 200 ms). Mirror the tailing/atomic write of
  `spikes/133-q2pro-control/harness.mjs` (`createLogTailer`, `writeFileAtomic`) — do not import it.
  Tests in `windows-channel.test.ts` with a fake engine over a temp dir that, every tick (fake
  timers or a 10 ms real interval), re-reads `q2l_ctl.cfg`, evaluates the `if $q2l_seq != N` guard
  against its own `q2l_seq`, counts executions per `seq`, and appends prefixed `POS`/`ACK` lines
  (sometimes split mid-line across two writes): (a) "a command runs exactly once through the control
  file and position is read from the logfile" — three rapid sends each execute exactly once, in
  order, and `latest().positionMs` follows the log; (b) `Demo finished` → stop file written,
  `onFinished` fires, later sends rejected; (c) "close removes the control, loop and log files it
  created"; (d) stale files from a previous run are replaced and pre-existing log bytes are not
  parsed.

- [x] **D3 — Linux channel (stdin/stdout).** New
  `src/main/modules/replays/playback-channel/linux-channel.ts`: `createLinuxChannel({ io, log })`
  implementing `PlaybackChannel` from `types.ts` over an `EngineIo` port (D1's `types.ts`), using
  `protocol.ts` (`parseEngineLine`, `checkLine`, `linuxLaunchArgs`, 100 ms poll constant). `start()`
  subscribes to `io.onLine` and starts a 100 ms timer writing `echo POS $cl_demopos`. `send(line)`:
  `checkLine`, after finished → `replays.playback.error.noSession`, else `io.writeLine(line)`. On
  `Demo finished`: stop the poll, fire `onFinished`. `close()`: stop the timer, unsubscribe; creates
  no files. Tests in `linux-channel.test.ts` with an `EngineIo` built on two `PassThrough` streams and
  fake timers: "a command reaches the engine stdin and position is parsed from stdout" (written
  text is `seek +10\n`; `POS 0:14.5` on stdout → `latest().positionMs === 14500`, also when a line
  arrives split in two chunks); the poll writes `echo POS $cl_demopos\n` every 100 ms; `Demo finished`
  stops the poll and rejects later sends; a line with `\n` is rejected and nothing is written.

- [x] **D4 — PlaybackControl and wiring.** New `src/main/modules/replays/playback-control.ts`:
  `createPlaybackControl({ emit, launch, platform = process.platform, makeWindows, makeLinux })`
  with `prepare({ gameDirPath, durationMs })` → the channel's `argsBeforeDemo`/`argsAfterDemo` (picks
  `createWindowsChannel` on `win32`, `createLinuxChannel` on `linux`, from
  `playback-channel/windows-channel.ts` / `linux-channel.ts`), `attach(io?)` → `channel.start()` and
  emit `playback.state {state:'playing'}`, then a 250 ms timer emitting `playback.position
  {positionMs, durationMs}` from `channel.latest()`; `onFinished` → stop the timer, emit
  `playback.state {state:'finished'}`; `send(line)` → `fail('replays.playback.error.noSession')`
  when no channel (or finished), else the channel's result. Subscribe to `launch.onStateChange`
  (`src/main/services/launch.ts`): phase `exited`/`failed` → stop timer, `await channel.close()`,
  emit `playback.state {state:'ended'}` as the last event, drop the channel. Add
  `REPLAYS_EVENTS.playbackPosition = 'playback.position'`, `playbackState = 'playback.state'` and the
  payload types `ReplaysPlaybackPosition` / `ReplaysPlaybackState` to `src/shared/modules/replays.ts`
  (mirror `scanProgress`). Wire in `src/main/modules/replays/index.ts` (create next to
  `createPlaybackSessions`, pass `setup.emit`/`app.launch`) and in the Q2PRO play handler [[159]]
  adds: compose `+set game <g>`, `argsBeforeDemo`, `+demo <path>`, `argsAfterDemo`; after a
  successful launch call `attach()` with an `EngineIo` adapted from [[163]]'s held stdin/stdout on
  Linux (writeLine = `stdin.write(line + '\n')`, onLine = line-split stdout). Tests in
  `playback-control.test.ts` with fake channels, a fake `launch` exposing `onStateChange`, fake
  timers and `stubPlatform` from `src/test-support/platform.ts`: "picks the Windows channel on win32
  and the Linux channel on linux"; "pushes playback.position every 250 ms while the demo plays";
  "game exit ends the session with a final playback.state ended" (close awaited before the event);
  "send without a session fails with replays.playback.error.noSession"; `finished` stops the
  position pushes. Extend the play handler's existing test (from [[159]]) with "channel args wrap
  +demo so +demo precedes +exec".

## Model Hints

- D2 → deliverable-hard — exactly-once over a file the engine re-executes every tick, a log tail
  that must survive mid-line reads and file (re)creation, and a close that races Windows file locks
  on files the engine may still hold.
- D1, D3, D4 → default.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/playback-control.test.ts` › "picks the Windows channel on
  win32 and the Linux channel on linux" (interface in D1's `types.ts`, implementations D2/D3)
- AC2 → unit `src/main/modules/replays/playback-channel/linux-channel.test.ts` › "a command reaches
  the engine stdin and position is parsed from stdout"
- AC3 → unit `src/main/modules/replays/playback-channel/windows-channel.test.ts` › "a command runs
  exactly once through the control file and position is read from the logfile"
- AC4 → unit `src/main/modules/replays/playback-control.test.ts` › "pushes playback.position every
  250 ms while the demo plays"
- AC5 → unit `src/main/modules/replays/playback-control.test.ts` › "game exit ends the session with a
  final playback.state ended" + unit `src/main/modules/replays/playback-channel/windows-channel.test.ts`
  › "close removes the control, loop and log files it created"
- AC6 → unit `src/main/modules/replays/playback-control.test.ts` › "send without a session fails with
  replays.playback.error.noSession"
- AC7 → unit `src/main/modules/replays/playback-channel/protocol.test.ts` › "classifies every line of
  the recorded Q2PRO logfile" + the stubbed-engine tests of AC2/AC3
- Not an AC, spike 133 carry-over → **manual residue** (needs a real Q2PRO engine and GPU; no test
  may start one, [[159]] AC8): send→ACK p95 vs. 300 ms (from the debug log), CPU loop-on vs.
  loop-off (≤ 5 % bar), and a multi-map demo keeps position and commands working across the map
  change — results recorded in `## Done`.
- No e2e line: 164 has no user-facing surface; [[165]]/[[166]] drive this channel through their
  flows.

## Done

Main-side playback channel for a running Q2PRO demo: pure protocol (`playback-channel/protocol.ts`), a Windows cfg-polling channel, a Linux stdin/stdout channel over an `EngineIo` port, and `PlaybackControl` (`playback-control.ts`) that owns the one current channel, pushes `playback.position` every 250 ms and `playback.state`, closes on game exit / launcher quit and rejects sends without a session. Wired into `demo-play.ts` (args wrap `+demo`, Linux-only pipes via `{ playback: true }`).

Commit message: `164: playback channel - Q2PRO protocol, Windows cfg polling, Linux stdin/stdout, PlaybackControl with 250 ms position events`

Verification (narrow gate): `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (130 files / 1840 tests) all green, run twice (before and after review fixes). No e2e (story has none). Full gate pending (sprint's). Review (default tier, 1 cycle): PASS; findings fixed: Windows files now written in `prepare()` before the launch (race with `+exec q2l_loop.cfg`), Linux close write unconditional, exact `toEqual` on the checkLine failure.
AC -> test (all passed): AC1/AC4/AC5/AC6 `playback-control.test.ts` (named tests; AC5 also `windows-channel.test.ts` "close removes ..."), AC2 `linux-channel.test.ts` "a command reaches the engine stdin and position is parsed from stdout" (story line's name corrected: no apostrophe), AC3 `windows-channel.test.ts` "a command runs exactly once ...", AC7 `protocol.test.ts` "classifies every line of the recorded Q2PRO logfile" + AC2/AC3 stubbed engines. Also `demo-play.test.ts` "channel args wrap +demo so +demo precedes +exec".
Manual residue (real engine + GPU): send->ACK p95 vs 300 ms, CPU loop-on vs loop-off (<= 5 %), multi-map demo across a map change - not yet measured.

Decisions:
- Linux SIGPIPE on launcher quit: `LaunchService.onBeforePlaybackRelease` (new, synchronous, before `handle.end()`) lets the channel write `set sys_console 0` while stdin is still open, then close; it is a mitigation, not a guarantee, so the residual risk (an engine not ignoring SIGPIPE dying on a later print) is accepted - killing the game is the user's call. The write is unconditional on first close, also after `Demo finished`.
- Windows: channel starts in `prepare()` (before spawn), not `attach()`; queue cap 8 counts the in-flight command; `removeStale` deletes `q2l_*` in the gamedir per spec; log reopen uses a `stat` on idle ticks (cheap, needed for truncate/replace). Untested: close-time EBUSY retry (Node cannot hold a Windows lock).
- Pipes only when `platform !== 'win32'`; `PlaybackControl` subscribes to launch on first `prepare()` (fake launches in older tests lack the methods). Fixture is the real spike log with `spike133_ctl` renamed `q2l_ctl`.

tiers: D 4 / hard 1 · review default · cycles 1 · agents 8
