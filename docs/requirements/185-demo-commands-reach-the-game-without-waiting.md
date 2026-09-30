---
id: 185
title: Demo commands reach the game without waiting
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

On Windows the launcher steers a demo through a control file the game's loop reads every ~200 ms,
and reads answers from the game's logfile ([[164]], [[166]], [[174]]). Two things make every command
slow: the logfile reaches the disk only in bursts, and the next command waits for the previous one's
answer from that same log. Quick successive clicks therefore queue behind each other.

Using the levers [[183]] measured and approved, commands reach the game and their answers reach the
launcher within the target latency [[183]] set — without the console flood [[174]] removed and without
changing what the game's own console and binds can do on the stage ([[169]], [[173]]).

## Acceptance Criteria

- [ ] **AC1** — On Windows, a single timeline command takes effect in the game and is acknowledged to
      the launcher within [[183]]'s target latency (p95), measured on real Q2PRO the way [[183]]
      measured it.
- [ ] **AC2** — Several commands sent in quick succession (e.g. three jumps within 300 ms) all run in
      the game, in order, each exactly once; none waits for an earlier command's acknowledgement
      before it is handed to the game.
- [ ] **AC3** — The position readback reaches the launcher at least as often as [[183]]'s approved
      combination promises (no ~1.3 s bursts).
- [ ] **AC4** — The game's console and notify area show no more launcher lines than after [[174]]
      (no `Execing …` or `POS …` flood).
- [ ] **AC5** — The existing channel guarantees still hold: exactly-once execution, the queue cap,
      the fullscreen switch and back-to-window ([[172]]), stop ([[173]]) and the cleanup of control
      and command files after the session.
- [ ] **AC6** — Linux behaviour is unchanged, or improved if [[183]] found a Linux delay (per its AC6).

## Open Questions

- ~~Q1: Depends entirely on [[183]]'s go/no-go per lever. If no lever meets a useful target, this
  story is cut to what [[183]] approves and [[184]]'s "waiting for the game…" state carries the rest
  (option 2 from the user's request: inform instead of fix). Confirm that fallback.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Fallback: confirmed; if 183 finds no lever meeting a useful target, cut 185 to what 183 approves and 184's "waiting for the game..." state carries the rest
- **Gate on 183's RESULT.md:** every D below starts by reading `spikes/183-control-latency/RESULT.md`; a D whose lever 183 marks no-go is not built, and its ACs are recorded in `## Done` as cut under the (User) fallback — because the story is defined as "implement what 183 approves" and the fallback is already decided.
- **Pipelining form:** several guarded sequences in one control file, not coalescing queued lines into one command file — because coalescing still makes a command that arrives while another is in flight wait for that ACK, which AC2 forbids.
- **Guard is monotone (`if $q2l_seq < N`), lines ascending by seq:** because with several sequences in one file, today's `!=` guard would re-run seq N whenever the file is re-read after a later seq already ran, breaking exactly-once (AC5); a timed-out seq then simply drops out of the file without blocking later ones.
- **AC4 bound is 174's budget:** launcher lines reaching the console stay ≤ ~10/s (2 lines per 13-frame tick at spike 169's ~65 frames/s); a 183 lever that exceeds it is not applied even if 183 calls it go — because AC4 is a hard criterion and 183 only measures side effects.
- **Linux:** changed only if 183's RESULT.md names a Linux lever as go; otherwise AC6 is proven by the unchanged Linux tests — because AC6 allows "unchanged" and no Linux delay is known today.
- **Target latency lives in the RESULT, not in code:** AC1/AC3 are checked by a real-Q2PRO probe against 183's number, not by a unit test with a constant — because the latency is a property of the real engine's log flush that the stub cannot reproduce.
- **Real-surface proof of AC2 via the stub engine:** the stub gets an opt-in log-burst knob emulating Q2PRO's buffered logfile, so a ui:flow can show three quick jumps run before any ACK could be read — because `ui-acceptance-required` needs the real click path and the stub writes its log unbuffered today.

## Plan

Gate: read `spikes/183-control-latency/RESULT.md` first (recommended combination, target p95, per-lever
go/no-go). Build only the go levers (Decisions).

1. **D1 — loop/flush lever** in `protocol.ts` (loop wait frames, logfile/flush launch args), plus
   Linux only if 183 says so. Unit guard for AC4's line budget.
2. **D2 — pipelined dispatch** on Windows: the control file carries every unacknowledged seq with a
   monotone guard; the channel tracks a set of in-flight seqs instead of one; each ACK retires its own
   seq; per-seq timeout; queue cap counts in-flight + queued; fullscreen/stop/cleanup unchanged in
   behaviour. CHANGELOG entry.
3. **D3 — real-surface proof**: stub-engine log-burst knob + ui:flow `replays-timeline-burst`
   (three jumps within 300 ms all executed, in order, once each, before the first burst flushes).
4. **D4 — real-Q2PRO probe** of the shipped settings, results in `spikes/185-control-latency/RESULT.md`
   (p50/p95 against 183's target, POS interval, burst run, console line count).

Order: D1 → D2 → D3 → D4 (D4 measures what D1+D2 ship). D3 needs D2 to pass.

Files: `src/main/modules/replays/playback-channel/{protocol,windows-channel}.ts` (+ tests),
maybe `linux-channel.ts`, `scripts/lib/stub-engine.cjs`, `scripts/flows/replays-timeline-burst.mjs`,
`spikes/185-control-latency/`, `CHANGELOG.md`.

## Deliverables

- **D1 — Apply 183's loop/flush lever.** First read `spikes/183-control-latency/RESULT.md`; if its
  loop-wait and log-flush levers are both no-go, skip D1 and note that in the story's `## Done`.
  Otherwise, in `src/main/modules/replays/playback-channel/protocol.ts` set `LOOP_WAIT_FRAMES` (:84)
  and/or the logfile launch args in `windowsLaunchArgs` (:202-221, `logfile`/`logfile_flush`/any
  padding) to the recommended combination, and update the doc comments at :72-84 (the "~1.3 s bursts"
  note) to the new measured values. Constraint: launcher lines reaching the game console must stay
  ≤ 10/s at 65 frames/s (lines per tick × 65 / wait frames) — if the recommendation breaks that, do not
  apply that part. Only if RESULT.md names a Linux lever as go: apply it in `linux-channel.ts` /
  `LINUX_POLL_MS` (protocol.ts:16). Tests in `protocol.test.ts` (mirror "the loop ticks every
  LOOP_WAIT_FRAMES frames" :145): "the launcher's console lines stay within story 174's 10 per second"
  (computed from `buildLoopCfg` + `buildControlFile` lines per tick) and "Windows launch args carry the
  approved log flush settings". Linux tests in `linux-channel.test.ts` stay green unchanged unless a
  Linux lever was applied (then adjust "polls the position every 100 ms" :65 to the new value).
- **D2 — Hand every command to the game without waiting for the previous ACK (Windows).** Skip (and
  note in `## Done`) only if 183's RESULT.md marks "several sequences in one control file" no-go.
  - `protocol.ts`: `buildControlFile(seqs: number[])` (today `seq | null`, :106) emits `POLL_LINE`
    then one line per seq **ascending**: `if $q2l_seq < N then "exec q2l_cmd_N.cfg; set q2l_seq N;
    echo ACK N"` — monotone guard, so re-reading the file after a later seq ran never re-runs an
    earlier one, and a skipped/timed-out seq never blocks later ones. Adjust `encodeControlCommand`
    and the protocol tests ("builds the guarded control file" :99).
  - `windows-channel.ts`: replace the single `inFlight` (:94) with an ordered set of in-flight seqs.
    `send` writes the new command file, then rewrites the control file with all in-flight seqs at once
    (command file before control file, as today via `writeAtomic` :116 / `flushControl` :133) — never
    waiting on an ACK. `handleLine` (:227) retires the ACKed seq (and any lower seq still in flight,
    since the monotone guard means they can no longer run), removes its command file, rewrites the
    control file. `tick` (:273) times out each seq on its own (`ACK_TIMEOUT_MS`), logs the warning,
    drops it from the file and deletes its command file. Queue cap (:331): in-flight + queued ≥
    `QUEUE_CAP` refuses with `replays.playback.error.busy`. Fullscreen (story 172: `beginEntering`
    :179, `reachFullscreen` :187, `unackedSwitchSeq` :103) and `close()` (:370-386, removes every
    unacked command file) keep their behaviour with several seqs in flight; the loop's `set q2l_seq 0`
    on restart stays compatible because seqs only grow.
  - Tests in `windows-channel.test.ts` (mirror :244-:490): "three quick sends are all in the control
    file before any ACK", "each of several in-flight commands runs exactly once, in order" (drive the
    written control file through a re-read after a later ACK), "a control file re-read after seq N+1
    ran does not re-run seq N", "one timed-out seq does not block the ones after it", "refuses a send
    once QUEUE_CAP commands are in flight or queued", and the existing story 172 block plus "close
    removes command files that were never acknowledged" still pass with several seqs in flight.
  - `CHANGELOG.md` (Keep-a-Changelog, `### Changed` or `### Fixed` in the current section): one short
    line — quick timeline clicks on Windows no longer queue behind each other.
- **D3 — Prove AC2 through the real click path.** In `scripts/lib/stub-engine.cjs` add an opt-in env
  knob `Q2L_UI_ENGINE_LOG_FLUSH_MS` (next to the others at :54-58): when set, `print` (:127) buffers
  logfile appends and writes them in one burst every N ms, emulating Q2PRO's buffered logfile; unset =
  today's behaviour. Commands already go to `Q2L_UI_ENGINE_COMMAND_LOG` via `logCommand` (:150) —
  append a millisecond timestamp only when the new knob is set, or keep a separate timing field, so no
  existing flow's assertions change. New flow `scripts/flows/replays-timeline-burst.mjs` (mirror
  `scripts/flows/replays-timeline.mjs`): start a demo on the stub with `LOG_FLUSH_MS=1500`, click the
  +jump control three times within 300 ms, assert the command log holds exactly three seek commands in
  click order, each once, and that the third was executed less than 1500 ms after the first click
  (i.e. before any ACK could have been read). Then confirm the position readback updates the timeline.
- **D4 — Measure the shipped settings on real Q2PRO.** New `spikes/185-control-latency/` (mirror the
  harness from `spikes/183-control-latency/`, pitfalls: end Q2PRO with WM_CLOSE, never kill; no
  synthetic keys) that drives `C:\Games\Q2Pro\q2pro.exe` unattended with **the values shipped in
  `protocol.ts`** (loop cfg, launch args, multi-seq control file text), read from that file's exports
  or asserted equal to it at start — never the spike's own copies. `RESULT.md` records: p50/p95 from
  control-file-written to effect and to ACK read vs 183's target (AC1), POS arrival interval (AC3), a
  three-jumps-in-300 ms run with per-command dispatch vs ACK times (AC2), launcher lines/s in the
  console (AC4). If a number misses 183's target, say so plainly — do not tune the probe.

## Model Hints

- D2 → deliverable-hard: replacing the single in-flight slot with a set touches the exactly-once
  guard, the per-seq timeout, the queue cap and story 172's `unackedSwitchSeq`/idle-after-fullscreen
  logic at once — a wrong seq retired on ACK re-runs or silently drops a jump.

Review: → story-review-hard — AC1/AC3's evidence is a real-Q2PRO `RESULT.md` that no CI re-runs, so a
probe that measures the spike's own settings instead of `protocol.ts`'s shipped values (or a `!=`
guard that only re-runs a seq on a re-read the unit tests never trigger) passes every test and a
diff-only default review.

## Acceptance Tests

- AC1 → probe (real Q2PRO, unattended, outside CI — needs the real engine install; the stub cannot
  reproduce its log flush) `spikes/185-control-latency/` › RESULT.md "single command p50/p95 vs 183
  target"; plus unit `src/main/modules/replays/playback-channel/protocol.test.ts` › "Windows launch
  args carry the approved log flush settings" (D1).
- AC2 → e2e `npm run ui:flow -- replays-timeline-burst` (D3); unit
  `src/main/modules/replays/playback-channel/windows-channel.test.ts` › "three quick sends are all in
  the control file before any ACK" and "each of several in-flight commands runs exactly once, in
  order" (D2); probe run in `spikes/185-control-latency/RESULT.md` › "three jumps in 300 ms" (D4).
- AC3 → probe `spikes/185-control-latency/` › RESULT.md "POS arrival interval" (D4, same reason as
  AC1); unit `protocol.test.ts` › "Windows launch args carry the approved log flush settings" (D1).
- AC4 → unit `src/main/modules/replays/playback-channel/protocol.test.ts` › "the launcher's console
  lines stay within story 174's 10 per second" (D1); probe RESULT.md "launcher lines/s" (D4).
- AC5 → unit `windows-channel.test.ts` › "a control file re-read after seq N+1 ran does not re-run seq
  N", "one timed-out seq does not block the ones after it", "refuses a send once QUEUE_CAP commands
  are in flight or queued", the story 172 block (:490) and "close removes command files that were
  never acknowledged" / "close removes the control, loop and log files it created" (D2); e2e
  `npm run ui:flow -- replays-fullscreen` and `npm run ui:flow -- replays-stop` stay green (D2).
- AC6 → unit `src/main/modules/replays/playback-channel/linux-channel.test.ts` › "polls the position
  every 100 ms" (unchanged, or adjusted by D1 if 183 approved a Linux lever) plus the rest of that
  file and `playback-control.test.ts`'s per-platform channel pick, all green. No Linux e2e: flows run
  on the Windows host, so the Linux channel is proven at unit level (existing gap, not new).

## Done
