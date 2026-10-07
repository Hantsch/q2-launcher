# Story 183 spike — result

Run on 2026-09-30 (07:30 to 08:26 UTC, one game launch per configuration) against `C:/Games/Q2Pro/q2pro.exe`,
game `opentdm`, demo `test-demo-for-launcher.dm2` (~40 s), Windows 11, windowed `960x540+80+80`, 30 single
commands and 10 bursts per configuration. Every number below is a value from one of the 16 files in
`results/` (one per configuration, named here by timestamp prefix):

| Config   | File                            | Config    | File                                         |
| -------- | ------------------------------- | --------- | -------------------------------------------- |
| baseline | `2026-09-30T07-30-22-186Z.json` | multiseq  | `2026-09-30T07-58-08-308Z.json`              |
| wait5    | `2026-09-30T07-33-47-947Z.json` | coalesce  | `2026-09-30T08-01-09-856Z.json`              |
| wait2    | `2026-09-30T07-36-29-175Z.json` | fileack   | `2026-09-30T08-04-26-881Z.json`              |
| wait1    | `2026-09-30T07-38-50-836Z.json` | combo-1   | `2026-09-30T08-06-46-195Z.json`              |
| flush0   | `2026-09-30T07-41-10-010Z.json` | combo-2   | `2026-09-30T08-08-56-851Z.json`              |
| flush2   | `2026-09-30T07-45-31-314Z.json` | combo-3   | `2026-09-30T08-11-12-234Z.json`              |
| flush3   | `2026-09-30T07-47-49-447Z.json` | logtoggle | `2026-09-30T07-50-10-307Z.json`              |
| pad      | `2026-09-30T07-55-50-434Z.json` | flush1    | = baseline (production is `logfile_flush 1`) |
| combo-4  | `2026-09-30T08-26-04-154Z.json` |           |                                              |

All times are ms, `p50 / p95` unless stated. "Effect" is the engine-written marker file (never the log), so the
flush share is visible. "ACK" is the configuration's own ACK (log line; the marker for `fileack`).

## Verdict

**Go** for a latency fix, with **combo-4 = `logfile_flush 3` + multiseq at the production loop wait 13**
(`…08-26-04-154Z.json`). Production's control written -> ACK read is **1277.3 / 1537.4** ms
(`…07-30-22-186Z.json`), of which the command _taking effect_ is only **117.4 / 209.4**: ~1.1 s is the log
buffer flushing 525 bytes at a time plus the 50 ms poll, and every command is serialised behind it. combo-4
measures control -> ACK **107 / 257** (**138.4 / 293.4** at the 50 ms production poll), bursts of 3 last ACK
**289.4 / 293.7** against baseline **3750.1 / 3762.1**, 0 timeouts, exactly-once 60/60, tookEffect 60/60, at
**10.0 lines/s** against the baseline 10.5 — so it stays inside story 174's 10 lines/s plumbing cap and 185's
line budget. The wait-1 configurations (combo-1/2/3) are the latency floor (combo-1 ACK 15.6 / 32.7) but cost
~91 to 101 lines/s and are **no-go on console volume**; they stay documented so 185 / the user can choose
knowingly. It does **not** fix input starvation (nothing does; see below). Linux is **not measured**.

## AC1 — baseline (`…07-30-22-186Z.json`, production unmodified; `productionUnmodified` all true)

| Measure                                                                  | p50 / p95 (max)          |
| ------------------------------------------------------------------------ | ------------------------ |
| control written -> took effect (`effect`)                                | 117.4 / 209.4 (223.4)    |
| tick share: control written -> marker (`controlToMarker`)                | 116.2 / 208.5 (222.4)    |
| control written -> ACK read (`ack`)                                      | 1277.3 / 1537.4 (1538.3) |
| same at the production 50 ms poll (`ackAtProductionPoll`)                | 1315.3 / 1545.3 (1576.3) |
| flush + poll share: marker -> log ACK (`markerToAck`)                    | 1090 / 1510 (1520)       |
| burst (pause, seek -10, pause, 100 ms apart): first request -> last ACK  | 3750.1 / 3762.1          |
| burst: first request -> last effect                                      | 2681.1 / 2892.1          |
| burst serialisation cost: burst last ACK vs single (`lastAckVsSingleMs`) | 2472.8                   |

The loop tick is cheap; the wait is the log. Timeouts 0, exactly-once 60/60, took-effect 60/60.

## AC2 — flush interval at the current tick (baseline)

| Series                                                                            | p50 / p95 / max      |
| --------------------------------------------------------------------------------- | -------------------- |
| interval between read batches carrying new POS/ACK lines, 10 ms host poll (n=123) | 1300 / 1520 / 1523.5 |
| same snapped to the 50 ms production poll                                         | 1300 / 1550 / 1550   |
| lines per batch (per flush)                                                       | 6 / 7 / 7            |
| bytes per flush                                                                   | 525 / 526 / 526      |

The preflight measured the flush size directly: `bufferBytes.fromSizeJumpsAtFlush1` p50 525, p95 526, max 526
(n=7), hence `padBytes` 589. With `logfile_flush 1` the MSVC CRT fully buffers (`semantics` in the preflight:
"1 = setvbuf _IOLBF (full buffering on the MSVC CRT), >1 = _IONBF"), so the log only moves when ~525 bytes
accumulate — at ~10.5 lines/s that is one flush per ~1.3 s.

## AC3 + AC4 — every lever and combination

Columns: effect and ACK p50/p95; flush interval p50/p95 (10 ms poll); lines/s = sum of the `linesPerSec` kinds
(Execing + POS + ACK + PAD + other; baseline 10.5); CPU = `cpuDeltaPct` (loop running vs stopped, 30 s each);
timeouts. Every configuration also had exactly-once 60/60. Lines/s of the wait-1 rows depend on the engine frame rate (Execing/s x wait = 45.1 to 50.2 command frames/s there against 65.0 in baseline), so at baseline's ~65 fps they would be roughly 1.4x higher (extrapolation, unmeasured). Screenshots are `results/<timestamp>-<config>.png`.

| Config                                   | Effect        | ACK             | Flush int.      | Lines/s | Starved | CPU Δ% | Timeouts | Go / no-go                                                                                                                                                                                                                                                                                                                                                                                   | Screenshot                               |
| ---------------------------------------- | ------------- | --------------- | --------------- | ------- | ------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| baseline                                 | 117.4 / 209.4 | 1277.3 / 1537.4 | 1300 / 1520     | 10.5    | yes     | 248.5  | 0        | reference                                                                                                                                                                                                                                                                                                                                                                                    | `2026-09-30T07-30-22-186Z-baseline.png`  |
| wait5                                    | 42.3 / 79.3   | 292.3 / 566.3   | 500 / 590       | 26.0    | yes     | 199.3  | 0        | **no-go** alone: p95 566 still misses the 300 bar, flush share (250 / 500) remains                                                                                                                                                                                                                                                                                                           | `2026-09-30T07-33-47-947Z-wait5.png`     |
| wait2                                    | 22.7 / 41.7   | 217.7 / 341.7   | 260 / 385.1     | 47.5    | yes     | 27.8   | 0        | **no-go** alone: p95 341.7 misses 300; 3 of 60 state checks contradicted                                                                                                                                                                                                                                                                                                                     | `2026-09-30T07-36-29-175Z-wait2.png`     |
| wait1                                    | 14 / 26       | 69.2 / 133      | 120.2 / 200     | 93.0    | yes     | -8     | 0        | **latency floor, no-go on console volume** (ACK 69.2 / 133, 97.3 / 163.5 at the 50 ms poll; best L1 by latency); alone ACK is held up by the flush (markerToAck 50 / 110); lines/s ~9x baseline                                                                                                                                                                                              | `2026-09-30T07-38-50-836Z-wait1.png`     |
| flush0                                   | 101.1 / 206.1 | 5867.1 / 10361  | 10180 / 11494.9 | 10.3    | yes     | 245.6  | **53**   | **no-go**: CRT default buffering flushes 4201 bytes at a time; 53 timeouts                                                                                                                                                                                                                                                                                                                   | `2026-09-30T07-41-10-010Z-flush0.png`    |
| flush2                                   | 115.4 / 322.4 | 115.4 / 322.4   | 220 / 370.3     | 9.5     | yes     | -2.5   | 0        | **go as a component, ranked below flush3** (`_IONBF`): ACK == effect (markerToAck 0), fewer lines than baseline; but tick-bound at wait 13. Its state check is invalid (the demo never played), so it is unvalidated. Caveat: the `tookEffect` state check contradicted 40 of 60 (yes 20) although the marker fired every time — unexplained, see caveats                                    | `2026-09-30T07-45-31-314Z-flush2.png`    |
| flush3                                   | 127.4 / 254.4 | 127.4 / 254.4   | 300 / 380       | 9.3     | yes     | -9.8   | 0        | **go as a component; preferred over flush2** (also `_IONBF`): ACK p95 254.4 (290.6 at the 50 ms poll, `ackAtProductionPoll`), 9.3 lines/s, tookEffect 60/60; alone, bursts stay serialised (last ACK 780.6 / 1111.6)                                                                                                                                                                         | `2026-09-30T07-47-49-447Z-flush3.png`    |
| logtoggle                                | 163.8 / 301.8 | 163.8 / 301.8   | 261.1 / 373.1   | 16.3    | yes     | -21.1  | 0        | **no-go**: no better than flush2, and `other` lines rise to 7.9/s (baseline 0.5)                                                                                                                                                                                                                                                                                                             | `2026-09-30T07-50-10-307Z-logtoggle.png` |
| pad                                      | 109.1 / 326.3 | 109.1 / 326.3   | 217.6 / 341.7   | 15.0    | yes     | 1373.5 | 0        | **no-go**: no better than flush2, adds 4.2 PAD lines/s of console noise, and the highest CPU delta (0.7472 CPU-s/s running vs 0.0507 stopped)                                                                                                                                                                                                                                                | `2026-09-30T07-55-50-434Z-pad.png`       |
| multiseq                                 | 116 / 209.2   | 1289.2 / 1526.1 | 1300 / 1520     | 10.8    | yes     | 213.5  | 0        | **go for bursts, in combination (see combo-4)**: singles unchanged (ACK 1289.2 / 1526.1, expected, the flush is the single-command cost), but the burst metric it targets improves from last ACK 3750.1 / 3762.1 to 940.2 / 1495 (last effect 290.2 / 415 vs 2681.1 / 2892.1) at about baseline line volume (10.8 vs 10.5 lines/s); 20 of 60 state checks unknown (marker took effect 60/60) | `2026-09-30T07-58-08-308Z-multiseq.png`  |
| coalesce                                 | 137.5 / 330.5 | 1296.3 / 2518.4 | 1530 / 2462.2   | 8.4     | yes     | 69.9   | **6**    | **no-go**: it did not improve bursts (last ACK 2470.6 / 4181.6 vs baseline 3750.1 / 3762.1: p50 better, p95 worse). Its 6 timeouts (3 singles, 3 bursts) and single ACK p95 2518.4 are run variance for singles: every single had `batchSize` 1, i.e. the baseline configuration; only bursts coalesced (batch sizes 1, 2, 2)                                                                | `2026-09-30T08-01-09-856Z-coalesce.png`  |
| fileack                                  | 116.2 / 290.2 | 116.2 / 290.2   | 1290 / 2401.7   | 9.3     | yes     | -1.6   | 0        | **go as an alternative** (no flush lever needed, lines/s below baseline), but tick-bound at wait 13 and the log still lags (markerToAck 870 / 1420)                                                                                                                                                                                                                                          | `2026-09-30T08-04-26-881Z-fileack.png`   |
| combo-1 (wait1 + flush2)                 | 14 / 32.7     | 15.6 / 32.7     | 30 / 46.6       | 91.5    | yes     | -20.3  | 0        | **no-go on console volume** (91.5 lines/s, ~9x the 10/s cap of 174/185); kept as the latency floor: ACK 15.6 / 32.7, 40.7 / 66.7 at the 50 ms poll. Built on flush2's unvalidated run (see caveats)                                                                                                                                                                                          | `2026-09-30T08-06-46-195Z-combo-1.png`   |
| combo-2 (wait1 + flush2 + multiseq)      | 13.4 / 25.8   | 13.4 / 25.8     | 20.3 / 47.1     | 101.4   | yes     | -17.3  | 0        | **no-go**: console volume and no gain over combo-1 (ACK p95 25.8 vs 32.7, burst last ACK 222.5 vs 212.2) and the most lines/s of all                                                                                                                                                                                                                                                         | `2026-09-30T08-08-56-851Z-combo-2.png`   |
| combo-3 (wait1 + fileack + multiseq)     | 16.6 / 34.3   | 16.6 / 34.3     | 150 / 201.2     | 91.2    | yes     | -1.2   | 0        | **no-go vs combo-1**: ACK at the 50 ms poll p95 73.2 (combo-1 66.7) and the log stays ~200 ms behind (markerToAck 50 / 170); adds a marker-file dependency and multiseq for nothing                                                                                                                                                                                                          | `2026-09-30T08-11-12-234Z-combo-3.png`   |
| **combo-4 (flush3 + multiseq, wait 13)** | 107 / 257     | 107 / 257       | 220 / 372.4     | 10.0    | yes     | 116.4  | 0        | **GO - recommended** (in budget by the line-count gate; bursts 289.4 / 293.7; ACK at 50 ms poll 138.4 / 293.4; tookEffect 60/60, 38 confirmed / 22 unknown / 0 contradicted)                                                                                                                                                                                                                 | `2026-09-30T08-26-04-154Z-combo-4.png`   |

Lines/s for every row is the sum of `sideEffects.linesPerSec` (Execing + POS + ACK + PAD + other); the JSONs have no
separate total field, combo-4 included (4.5 + 3.8 + 0.7 + 0 + 1 = 10.0). wait2 + flush3 was **not measured**.

The composed levers are what each JSON says in `levers.composedOf`: combo-1 `["wait1","flush2"]`, combo-2
`["wait1","flush2","multiseq"]`, combo-3 `["wait1","fileack","multiseq"]`, combo-4 `["flush3","multiseq"]` (so the third lever of combo-2 is
multiseq, as stated, not inferred).

Side effects, stated plainly:

- **Starvation: `starved: true` in all 16 files, baseline included.** `+echo S183_AFTERARG` after the loop cfg
  never ran while the loop lived (baseline `afterArg.lineIndex` 1713, after the last POS line at 1711). No
  lever fixes or worsens it, so it does not separate the options; it is 169's known consequence of the loop and
  stays a constraint on the follow-up (typed lines and binds do not reach the game while the loop runs).
- **Console flood (the old 174 problem): this is the real cost of wait 1, and the reason it is no-go.** wait1 / combo-1 / combo-2 / combo-3
  emit 93.0 / 91.5 / 101.4 / 91.2 lines/s against the baseline 10.5 (combo-4: 10.0) (mostly `Execing q2l_ctl.cfg` and `POS`
  lines, e.g. combo-1 Execing 45.3 + POS 44.5). Launch args set `con_notifylines 0`, so the notify area should stay
  empty; the eyes-on judgement of the screenshots is the only residue (Manual residue). **This is a console-flood risk
  of exactly the kind story 174 removed**: 174 describes the launcher printing "about 13 `Execing q2l_ctl.cfg` and
  13 `POS m:ss.f` lines per second" into the console as the problem, and its decision records "AC2's stated
  maximum is 10 plumbing lines/s" (`docs/requirements/done/174-the-game-console-is-not-flooded-by-the-launcher.md`).
  combo-1 at 91.5 lines/s (`…08-06-46-195Z.json`, `sideEffects.linesPerSec`) is ~9x that stated maximum. Story 185 states the same bound ("a 183 lever that exceeds it is not applied even if 183 calls it go") and the 183 story's own gate is that the automated line count decides. By that gate wait1 and combo-1/2/3 fail, combo-4 passes.
- **CPU: inconclusive, not usable for AC4; the claim "no CPU cost from wait 1" is NOT supported.** Loop-running CPU is
  bimodal and does not follow the lever: ~1.0 CPU-s/s for baseline (1.0273), wait5 (1.0141), flush0 (1.0727),
  multiseq (1.038) (pad 0.7472), and ~0.04 for wait2 (0.0429), wait1 (0.0419), flush2 (0.0419), flush3, fileack
  (0.0331), combo-1 (0.0367), combo-2, combo-3 (coalesce 0.073, logtoggle 0.029). The stopped window is 0.29 to 0.34
  in the high group and 0.03 to 0.05 in the low one, so the difference is a property of the whole process in that
  run, not of the loop. flush2 and fileack have the same wait-13 loop as baseline yet measured 0.0419 and 0.0331.
  I checked whether it tracks demo state: `demoFinished` is true in every file except flush2 (false), and the
  last two single samples before the CPU window show the demo unpaused in every file except flush2
  (paused at 100 ms), in both groups. The JSONs hold no POS/demo state from inside the CPU window itself, so
  demo state (playing vs finished) during the window cannot be tested and no explanation is supported. Not
  run-order either (high-CPU configs ran 1st, 2nd, 5th, 9th and 10th of 15, interleaved with low ones). Treat CPU as unmeasured for AC4. One observation that fits, unproven: the high-CPU runs (baseline, wait5, flush0, multiseq, and pad at 0.7472) are exactly the runs with the highest engine frame rate (Execing/s x wait = 65.0, 63.0, 65.0, 66.3, 65.0 command frames/s), while every low-CPU run is 45.1 to 58.5 (combo-4 58.5 at 0.075). It is a correlation in 16 single runs, not a demonstrated cause.
- **Timeouts:** flush0 53, coalesce 6, everything else 0. Exactly-once 60/60 everywhere. Timed-out samples still carry a (late) log ACK, see caveats.

## AC5 - recommendation and target for story 185

**Recommended configuration: `combo-4` = `logfile_flush 3` (unbuffered log) + multiseq (several guarded sequences in
one control file), at the unchanged production loop wait 13** (`…08-26-04-154Z.json`). Serial ACK read from the log,
no marker dependency, no loop change. Measured (n=30 singles, n=10 bursts, one launch): control -> took effect
**107 / 257** (max 340.1), control -> ACK **107 / 257**, **138.4 / 293.4** (max 376.4) at the ideal 50 ms production
poll grid (`ackAtProductionPoll`), burst (pause, seek -10, pause, 100 ms apart) last ACK **289.4 / 293.7** against
baseline **3750.1 / 3762.1** (serialisation cost 182.4 ms vs baseline 2472.8), timeouts 0, exactly-once 60/60,
tookEffect 60/60 (38 state-confirmed, 22 unknown, 0 contradicted), **10.0 lines/s** (baseline 10.5), flush interval
220 / 372.4 (10 ms poll) and 250 / 400 at the 50 ms poll, lines per flush 1 / 2 / 5.

**Target for 185: p95 control written -> ACK read <= 350 ms at the production 50 ms poll; bursts of 3 last ACK
<= about 350 ms; promised POS interval p95 <= 400 ms** (the log flush interval p95: 372.4 ms at the 10 ms poll, 400 at
the 50 ms poll). The 300 ms candidate bar is deliberately not used: measured 293.4 leaves 6.6 ms margin, less than the
Windows timer granularity below, n=30, and ~100 ms sampling jitter at wait 13. Against baseline that is ~5x
better on singles (1545.3 -> 293.4 at the 50 ms poll) and ~13x on bursts (3762.1 -> 293.7).

**Why not 100 ms:** only wait 1 reaches it (combo-1 ACK 40.7 / 66.7 at the 50 ms poll; wait1 alone 97.3 / 163.5) and
wait 1 prints 91 to 101 lines/s (combo-1 91.5, wait1 93.0, combo-2 101.4, combo-3 91.2), far over the 10 lines/s of
story 174 and 185's line budget. So wait1 and combo-1/2/3 are **no-go on console volume** and are kept as the latency
floor (wait1 ACK 69.2 / 133; combo-1 15.6 / 32.7) so that 185 / the user can decide knowingly if they ever accept
a flood. Story 185 drops its pipelining deliverable on a multiseq/coalesce no-go; multiseq is **go** here (bursts),
coalesce **no-go**.

**Fallback components, in rank order:** `flush3` alone (ACK p95 254.4, 290.6 at the 50 ms poll, 9.3 lines/s, tookEffect
60/60, `…07-47-49-447Z.json`), then `fileack` (ACK = marker, p95 290.2, 327.5 at the 50 ms poll, 9.3 lines/s, log
lags), then `flush2` (effect/ACK p95 322.4, 338 at the 50 ms poll, 9.5 lines/s; **its state check was invalid** because
the demo never played, so it is unvalidated). `wait2` / `wait5` with the buffered log are no-go (47.5 / 26.0 lines/s and
ACK p95 341.7 / 566.3); `wait2 + flush3` was **not measured**. (The earlier statement that only fileack gets under 300 ms
without wait 1 was wrong: flush3 measures 254.4 at the harness's 10 ms poll.) combo-1's "best L2 = flush2" was a
list-order tie-break among flush2 / flush3 / logtoggle / pad (all `markerToAck` p50 0), so combo-1 built on the one
unvalidated run; flush3 would have been equivalent and is validated.

The flood-visible fallback is no longer the main path: combo-4 is in budget by the line-count gate (10.0 lines/s).
What remains is the eyes-on judgement of the screenshots only.

Levers that get under 1 s: wait1, flush2, flush3, logtoggle, pad, fileack, multiseq only in bursts, and the combos.
wait5 (566.3) and wait2 (341.7) also get under 1 s; flush0 (10361), coalesce (2518.4) and the baseline (1537.4) do not.

## AC6 — Linux channel

**Not measured.** No Linux Q2PRO is reachable from this unattended Windows machine.

Code-level assessment of `src/main/modules/replays/playback-channel/linux-channel.ts` (not verified by any run):

- Transport is the game's own stdin/stdout (`+set sys_console 1`). `send()` writes the line to stdin immediately
  (`safeWrite`); there is **no ACK wait and no serialisation**, so Windows' AC1 burst cost (2472.8 ms) and the
  flush share have no counterpart in this code.
- Position comes from a 100 ms timer writing `POLL_LINE`; the parsed `pos` line updates `latest()`. So the
  control-to-ACK cycle does not exist, and the status delay is bounded below by `LINUX_POLL_MS` (100 ms) plus
  however long stdout takes to reach the launcher.
- **The stdout pipe can plausibly be block-buffered.** The channel reads lines through `io.onLine` and does
  nothing about buffering: if the engine writes console output through C stdio to a pipe, glibc fully buffers
  (BUFSIZ-sized) unless the engine calls `setvbuf`/`fflush`, and POS lines would arrive in batches — the same
  class of defect the Windows log showed (525-byte flushes at `logfile_flush 1`). Whether Q2PRO's `sys_console`
  output on Linux is unbuffered or flushed per line is **unknown** here and has to be read from the engine source
  or measured. A `Demo finished` line would be delayed the same way.
- Linux has no loop, hence no starvation (169) and no console flood.

## Method and caveats

- Harness `harness.mjs`, configuration list and field meanings in `README.md`. Preflight (baseline file): marker
  kind `writeconfig` works (`Wrote configs/q2l_mk_1.cfg.`); `logfile_flush` values 0, 1, 2, 3 all accepted;
  `if … < …` works (`ifLessThan: true`, needed by multiseq); `padBytes` 589. Every run exited cleanly,
  cleanup left nothing, `q2config.cfg` restored.
- n=30 singles and n=10 bursts per configuration; one launch each. Single commands are 1 to 1.4 s apart at
  random, because the settle point is locked to a log flush and to the loop tick; the README records that
  unjittered 5-sample runs gave 310 ms and 79 ms for different phases.
- **Sampling jitter is ~100 ms at wait 13.** Configurations with the identical wait-13 tick measured effect p95
  209.4 (baseline), 209.2 (multiseq), 322.4 (flush2), 254.4 (flush3), 301.8 (logtoggle), 326.3 (pad), 330.5
  (coalesce), 290.2 (fileack). Differences of that size between wait-13 rows are noise, not lever effect.
- The host's own poll is 10 ms at p50/p95 but its `max` reaches 692 to 773 ms in every file (a stall, probably the
  screenshot); the production 50 ms series is the baseline-comparable one.
- **`tookEffect` state check (yes / no per config; `null` = 0 everywhere, the per-sample `effectCheck` is null only for
  timescale or unjudgeable samples).** yes/no: baseline 60/0, wait5 60/0, wait2 57/3, wait1 59/1, flush0 60/0,
  **flush2 20/40**, flush3 60/0, logtoggle 59/1, pad 60/0, multiseq 60/0, coalesce 55/5, fileack 60/0, combo-1 59/1,
  combo-2 60/0, combo-3 58/2. `stateConfirmed` / `stateUnknown` carry the rest (multiseq 40/20, coalesce 34/21).
  The marker fired for every command, so effect/ACK timings (marker/ACK based) stand. **flush2 was not validated
  by the state check.** Its JSON shows `prePaused: true` in all 62 samples and `prePos` of only 100 or 10100: the
  demo sat paused at 100 ms for the whole run (`demoFinished` false), it never played. Every `pause` therefore
  reads as not taking effect (paused before and after), `seek +10`/`seek -10` do move the position by 10 s
  (100 <-> 10100, and they count as yes), and the timescale checks are `null` (no ticks advancing). The earlier
  "stale position lines" explanation was speculation and is withdrawn. Why flush2 started paused (and stayed so
  although its pause commands were acknowledged) is **unknown**; it needs a rerun. **combo-1** uses the same
  `logfile_flush 2` but its demo played normally (32 distinct `prePos` values, both paused states, 1 contradicted
  of 60), so its pause/seek checks are validated by the state check; only the timescale checks are null there
  (2x speed shows in `msPerTick`, not judged). The flush2 pause/timescale effect is thus not evidenced by the state check.
- **Late ACKs stay in the ACK stats.** The harness nulls a log ACK seen only after the session exit
  (`logAckAfterExit`, `harness.mjs` line 590), which would censor timed-out samples. The JSONs show 0 samples with
  `logAckAfterExit` in every config and `ack.n` 30 everywhere: flush0 (26 of 30 singles timed out) and coalesce (3 of 30) did get a log ACK before exit, after the 2000 ms timeout, so their p95s (10361, 2518.4) include those late ACKs
  and are not censored.
- The demo is ~40 s; a housekeeping `seek 5` (excluded from the stats) rewinds it past 20 s; `demoFinished` is true in every config file except flush2, where it is false because the demo never left 100 ms (see above).
- CPU figures: see the side-effects note; one 30 s sample pair per configuration.
- **Engine frame rate differs between runs.** Execing/s x wait (command frames/s) is 65.0 (baseline), 63.0 (wait5), 65.0 (flush0), 65.0 (pad), 66.3 (multiseq) and 45.1 to 58.5 in the rest (wait1 46.1, wait2 46.6, combo-4 58.5, combo-3 45.1). That is a plausible but unproven explanation of the CPU bimodality (high-CPU runs = the 63 to 66 group), and it makes the lines/s of the wait-1 configs fps-dependent (combo-1 was measured at ~45 fps; at ~65 fps it would be higher). combo-4 at 58.5 fps: scaling Execing + POS to 65 fps would give ~10.9 lines/s (extrapolation, unmeasured), i.e. at the ~10/s cap, like baseline's 10.5.
- **Burst series used the harness reacting at a 10 ms poll, not production's 50 ms**, so production's burst serialisation is understated; combo-4's burst figure at the production poll is **not measured**.
- **`ackAtProductionPoll` is an ideal 50 ms grid**; production's `setInterval(50)` on Windows has ~15.6 ms timer granularity (at most about +12 ms, unmeasured), which is also why the 300 ms bar is too thin at 293.4.
- **Labels:** "control written" rows are measured from the request timestamp, taken ~1 ms around the write (`requestedAt` vs `writtenAt`).
- **combo-4 state check:** 22 of 60 unknown (multiseq, like multiseq's own 20 of 60), 0 contradicted; the marker fired for every command.
- `combo` "best" picks came from this run's results (combo-1 = wait1 + flush2, not the static fallback
  wait2 + flush2); the flush2 pick was a list-order tie-break (see AC5). combo-4 was composed afterwards from flush3 + multiseq at wait 13.

## Manual residue

- **AC4, visible console/notify lines: judge by eye** in these screenshots (all in
  `spikes/183-control-latency/results/`), first the recommendation `2026-09-30T08-26-04-154Z-combo-4.png` against
  `2026-09-30T07-30-22-186Z-baseline.png`, then the highest-volume ones: `2026-09-30T07-38-50-836Z-wait1.png`,
  `2026-09-30T08-06-46-195Z-combo-1.png`, `2026-09-30T08-08-56-851Z-combo-2.png`,
  `2026-09-30T08-11-12-234Z-combo-3.png`, against `2026-09-30T07-30-22-186Z-baseline.png`. The rest:
  `…07-33-47-947Z-wait5.png`, `…07-36-29-175Z-wait2.png`, `…07-41-10-010Z-flush0.png`,
  `…07-45-31-314Z-flush2.png`, `…07-47-49-447Z-flush3.png`, `…07-50-10-307Z-logtoggle.png`,
  `…07-55-50-434Z-pad.png`, `…07-58-08-308Z-multiseq.png`, `…08-01-09-856Z-coalesce.png`,
  `…08-04-26-881Z-fileack.png`. The question is whether combo-4 (~10 lines/s) looks like the baseline, and, for the
  record, whether ~91 lines/s of `Execing`/`POS` output shows on the window at `con_notifylines 0` and whether the
  `pad` screenshot shows PAD lines.
- **AC6: the Linux measurement** (control latency, POS interval, and whether the stdout pipe is block-buffered)
  on a real Linux Q2PRO.
