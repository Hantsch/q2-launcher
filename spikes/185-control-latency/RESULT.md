# Story 185 D4 - result: the shipped settings on real Q2PRO

All times ms. Two complete runs of `harness.mjs` against `C:\Games\Q2Pro\q2pro.exe` (opentdm,
`test-demo-for-launcher.dm2`, windowed 960x540), 30 single commands + 10 bursts each. Run **A** =
`results/2026-09-30T09-18-30-500Z.json`, run **B** = `results/2026-09-30T09-16-03-406Z.json`. Both: `productionUnmodified`
all true (loop, controlIdle, controlFirstCommand, commandFirst, stop, launchArgs, `logfileFlush3InLaunchArgs`,
`launchArgsHaveOneFlush`), exactly-once 60/60, timeouts 0, `exitedCleanly` true, `cleanup.configRestored` true, no leftover
files, no q2pro.exe left (`tasklist`, and `q2proRunningAfter` false). Figures are read from `configs.shipped.<field>` of the
cited file. Effect = marker seen by the host; ack = `ack`, at the 10 ms poll, `ackAtProductionPoll` = on the 50 ms grid.

**Run B is degraded and A is the headline:** in B the demo sat paused at position 100 ms for the whole run (every `pause`
sample has `prePaused`/`postPaused` true and `postPos` 100 in `samples[].effectDetail`; `tookEffect.stateContradicted` 10), so
its latency tail is less trustworthy. It is kept because it is a real run of the same harness; both are reported.

## AC1 - single commands (30 each): control written -> effect / ACK

| Measure | A p50 / p95 (max) | B p50 / p95 (max) | 183 target |
| --- | --- | --- | --- |
| written -> effect (`effect`) | 83 / 204 (214.9) | 94.3 / 271.2 (341.3) | - |
| written -> ACK read, 10 ms poll (`ack`) | 83 / 204 (214.9) | 94.3 / 271.2 (341.3) | - |
| written -> ACK read, 50 ms grid (`ackAtProductionPoll`) | 109.2 / 227.6 (241.1) | 100.1 / 307 (387.1) | p95 <= 350 |
| marker -> ACK (`markerToAck`) | 0 / 0 | 0 / 0 | - |

Met in A (227.6) and in B (307) for p95 <= 350 at the 50 ms grid; B's max (387.1) is above 350. Effect equals ACK at the 10 ms poll:
with `logfile_flush 3` the log line is on disk before the host's poll sees the marker. 183 baseline (`2026-09-30T07-30-22-186Z.json`):
ACK 1277.3 / 1537.4, 50 ms grid 1315.3 / 1545.3; 183 combo-4 (`2026-09-30T08-26-04-154Z.json`): 50 ms grid 138.4 / 293.4.

## AC3 - POS arrival interval (read batches carrying new POS lines)

| Series | A p50 / p95 (max), n | B p50 / p95 (max), n | 183 promise |
| --- | --- | --- | --- |
| 10 ms poll (`posIntervals`) | 219.2 / 220 (233.2), 393 | 220 / 384.4 (403.8), 303 | p95 <= 400 |
| 50 ms grid (`posIntervalsAtProductionPoll`) | 200 / 250 (250), 393 | 250 / 400 (400), 303 | p95 <= 400 |

Met in both (B at the limit: 400 on the grid, max 403.8 at the 10 ms poll). 183 combo-4 flush interval p95 was 372.4.

## AC2 - three jumps within 300 ms (10 bursts each: `seek +10`, `seek -10`, `seek +10`, ~100 ms apart)

| Measure | A | B |
| --- | --- | --- |
| dispatched in order (`burstCheck.inOrder`) | 10 / 10 | 10 / 10 |
| each exactly once (`burstCheck.eachOnce`) | 10 / 10 | 10 / 10 |
| max request span first -> third (`maxRequestSpanMs`) | 205 | 204.4 |
| seq and cfg of 2nd and 3rd written before the 1st ACK (`writtenBeforeFirstAck`) | 0 / 10 | 1 / 10 |
| first request -> last ACK, p50 / p95 (`burst.lastAck`) | 337.3 / 358.5 | 357.9 / 443.4 |
| first request -> last effect (`burst.lastEffect`) | 337.3 / 358.5 | 357.9 / 443.4 |

Per command `burstDetail[]` holds requested-at, written-at (2nd about 103, 3rd about 205 after the first request, i.e. at request
time, never delayed by an ACK), effect and ACK times. **The literal "2nd/3rd written before the 1st ACK" is not what happened:**
the 1st ACK usually arrived (A: 69 to 138 ms) before the 2nd command was even requested at ~103 ms, so it could not be
"waiting for" it; the pipelining is visible instead in 2nd and 3rd being written at request time and acked in the same tick
(ack times in `burstDetail[].ackAtMs`, e.g. A burst 0: 138.5 / 138.5 / 358.5). Last ACK p95 vs the ~350 target from 183 (combo-4 bursts 289.4 / 293.7): A 358.5 is slightly
**over**, B 443.4 is **over**; they include the ~205 ms the test itself needs to request three commands.

## AC4 - launcher lines per second while the loop lived (`sideEffects.linesPerSec`)

| Run | Execing | POS | ACK | other | Sum | Budget <= 10 |
| --- | --- | --- | --- | --- | --- | --- |
| A | 5.4 | 4.6 | 0.8 | 1 | 11.8 | raw sum over 10 (launcher-only Execing+POS+ACK = 10.8; idle plumbing 2 x 4.6 = 9.2) |
| B | 4.3 | 3.5 | 0.7 | 0.9 | 9.4 | met (idle plumbing 2 x 3.5 = 7.0) |

The tick rate is the POS rate (one POS line per tick): A 4.6 ticks/s, B 3.5 ticks/s. The Execing count also includes the
`Execing q2l_cmd_N.cfg` line of every command (A 5.4 - 4.6 = 0.8/s, B 4.3 - 3.5 = 0.8/s, matching the 0.8 / 0.7 ACK lines/s), so it is
not the tick rate. Idle plumbing is 2 lines per tick (Execing ctl + POS): 2 x 4.6 = 9.2 lines/s in A, 2 x 3.5 = 7.0 lines/s in B.
Each command still costs one exec + one ACK line, as after 174 (A 0.8 + 0.8, B 0.8 + 0.7 lines/s). The `other` lines (A 1, B 0.9/s;
88 and 85 lines in total) are mostly the probe's own `Wrote configs/q2l_mk_*` marker lines, so the raw sum is inflated by the probe's
roughly 0.8 commands/s and its markers: A 9.2 + 0.8 + 0.8 + 1 = 11.8, B 7.0 + 0.8 + 0.7 + 0.9 = 9.4. The raw sum therefore exceeded 10
in run A (11.8) and not in B (9.4), because A ticked faster (4.6 vs 3.5/s) and the probe's commands and markers come on top of the idle
plumbing; the plumbing alone (9.2 / 7.0) was under 10 in both. 183's combo-4 was 10.0 (4.5 + 3.8 + 0.7 + 0 + 1).
CPU windows (`sideEffects.cpu`) are noisy and not analysed: A 1.0425 running / 0.3507 after stop, B 0.0734 / 0.0564 (CPU seconds per second).

## Verdict

AC1 p95 <= 350 at the 50 ms grid met (A 227.6, B 307); AC3 POS p95 <= 400 met (A 220 / 250, B 384.4 / 400); AC2 ordering and
exactly-once met 10/10 in both runs, burst last-ACK p95 358.5 (A) and 443.4 (B) above the ~350 figure; AC4: idle plumbing 9.2 lines/s (A) and 7.0 (B), under 10;
the raw all-lines sum was 11.8 in A (over 10: probe commands and `Wrote` markers on top) and 9.4 in B. Method caveat from 183 still applies: sampling phase against the 200 ms tick gives ~100 ms jitter.
