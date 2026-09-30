# Story 183 spike — where demo-control latency comes from

Throwaway spike, outside `src/`, not wired into any build or test. Runs unattended on Windows against a
real `q2pro.exe` and measures, per configuration, how long a demo command takes to **take effect** and
to be **acknowledged**, and what the launcher's plumbing costs.

```
node spikes/183-control-latency/harness.mjs [--config <name> | --all] [--exe <path>] [--game opentdm]
    [--demo test-demo-for-launcher.dm2] [--samples 30] [--bursts 10]
```

Defaults: `C:/Games/Q2Pro/q2pro.exe`, `opentdm`, `test-demo-for-launcher.dm2`, 30 singles, 10 bursts.
One configuration takes ~1.5 min at `--samples 5` and ~3 min at 30; `--all` (15 configurations)
runs well over half an hour. Refuses to start while any `q2pro.exe` is running.

## Configurations

| Name | Lever | What changes against production |
| --- | --- | --- |
| `baseline` | — | Production, unmodified: `buildLoopCfg()` (wait 13), `logfile 2`, `logfile_flush 1`, one command in flight, next only on the log ACK, 2000 ms timeout |
| `wait5` `wait2` `wait1` | L1 | `buildLoopCfg(waitFrames)` |
| `flush<N>` | L2 | `+set logfile_flush N` for every value the preflight saw accepted (except 1) |
| `logtoggle` | L2 | control file ends with `logfile 0` / `logfile 2` (close + reopen flushes, every tick) |
| `pad` | L2 | control file ends with `echo PADxxx…` lines of `padBytes` (the measured buffer size + 64) |
| `multiseq` | L3 | every queued command gets its seq and cfg at once; the control file holds one monotonic guard per pending seq (`if $q2l_seq < N`), so several run in one tick |
| `coalesce` | L3 | still one seq in flight, but everything queued behind it goes into the next command cfg together |
| `fileack` | L4 | the next command is dispatched when the engine-written marker appears, not on the log ACK |
| `combo-1..4` | mix | best L1 + best L2; + best L3; best L1 + L4 + best L3; `combo-4` = `flush3` + `multiseq` at the production wait (no L1 change). "Best" is taken from the same `--all` run's results (combos run last), else a static choice (`wait2`, `flush2`, `coalesce`) |

The protocol pieces (`buildLoopCfg`, `buildControlFile`, `encodeControlCommand`, `buildStopFile`,
`windowsLaunchArgs`, `parseEngineLine`, the file names and timing constants) are imported from
`src/main/modules/replays/playback-channel/protocol.ts` through `jiti` (alias `@shared` → `src/shared`).
The baseline's exact cfg texts and launch args are in the results, and `productionUnmodified` checks
them against the imported builders.

## How the effect is timed

Every command line is sent as `<command>; writeconfig q2l_mk_<id>`: the engine writes
`<game>/configs/q2l_mk_<id>.cfg` in the same guarded exec that runs the command, and the harness polls
for the file. **The effect time (`effect`) is the host's poll seeing the marker (10 ms poll), never
the arrival of a log line.** `effectMtime` (the file's mtime) is recorded only for comparison and can be
biased early, so it is not the effect metric. The preflight checks that the pinned build's `writeconfig` produces the
file (else it records whether a live `set vid_geometry` moves the window, via
`spikes/169-windowed-stage/win-probe.ps1`, and stops: sampling needs the file marker).

## A run

1. **Preflight** (one game launch): marker kind, which `logfile_flush` values the build keeps, whether
   `if … < …` works (needed by `multiseq`), and the log's flush size at `logfile_flush 1` (sets `padBytes`).
2. **Per configuration** (one game launch each, windowed at `960x540+80+80`):
   `--samples` single commands (cycle `pause`, `pause`, `seek +10`, `seek -10`, `timescale 2`,
   `timescale 1`), each 1–1.4 s (random) after the previous one settled — "settled" is locked to a log
   flush and so to the loop tick, and without the jitter every request would hit the same tick phase
   (a 5-sample run without it gave 310 ms, one with a different phase 79 ms); one screenshot; `--bursts` bursts of
   `pause`, `seek -10`, `pause` requested 100 ms apart. The test demo is ~40 s long, so a housekeeping
   `seek 5` (excluded from the stats) rewinds it when the last position read is past 20 s.
3. **Side effects:** CPU seconds of q2pro over 30 s with the idle loop running, then 30 s after the
   production stop file; launcher lines/s by kind; the starvation probe (`+echo S183_AFTERARG` after
   `+exec q2l_loop.cfg`: did it run while the loop lived?).
4. The game is ended with WM_CLOSE (`CloseMainWindow`), **never killed** — the log only flushes on a
   clean exit. If it does not exit within 10 s the harness stops and says so; end it by hand.
5. The log is read after exit; every cfg, command cfg, temp file, marker and the log are removed, the
   engine-created `configs/` dir too, and `q2config.cfg` (which q2pro rewrites on exit) is restored
   byte-exact. `cleanup` in the results lists anything left.

The log tail and the marker poll run every 10 ms (`hostPollIntervals` shows what was achieved: Node
timers on Windows only reach ~15.6 ms, so the sampling phase uses a yielding spin, which costs the
harness one core). Production polls at 50 ms; every `…AtProductionPoll` series is the same data
snapped to a 50 ms grid.

## Results

`results/<timestamp>.json` — `{ ts, options, protocol, harness, preflight, configs: { <name>: … } }`,
written after every configuration. Per configuration (ms, singles unless noted; each `{n, p50, p95, max}`):

- `effect` request → marker seen; `effectMtime`; `controlToMarker` control written → marker (tick share)
- `ack` request → the configuration's ACK (log, or marker for `fileack`); `logAck`; `ackAtProductionPoll`
- `markerToAck` marker → log ACK (flush + poll share)
- `burst.{lastAck, lastEffect, lastAckVsSingleMs}` first request of a burst → its last ACK / effect
- `flushIntervals` between read batches that carried new POS/ACK lines; `linesPerBatch`; `bytesPerFlush`
- `sideEffects.{linesPerSec, starved, cpuDeltaPct, cpu, screenshot}`
- `tookEffect` (marker seen, and the log's POS lines around the command do not contradict it),
  `exactlyOnce` (one `ACK <seq>` and one `Wrote configs/q2l_mk_<id>.cfg.` line per command), `timeouts`
- `notableLines` (other console lines), `samples` and `batches` (raw), `cleanup`

Screenshots: `results/<timestamp>-<config>.png`.
