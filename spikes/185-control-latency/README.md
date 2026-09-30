# Story 185 D4 - the shipped control settings on real Q2PRO

Throwaway spike, outside `src/`, not wired into any build or test. Derived from
`spikes/183-control-latency/harness.mjs` (same results format), but with **no lever and no override**: the loop cfg
(`buildLoopCfg`), control file (`buildControlFile`, multi-seq), command cfg (`encodeControlCommand`), stop file and launch args
(`windowsLaunchArgs`, which carries `logfile_flush 3`) are imported from
`src/main/modules/replays/playback-channel/protocol.ts` through jiti. Commands are dispatched like the shipped pipelined
channel: each gets its seq and cfg at once, the control file lists one monotone guard per pending seq, nothing waits for an
earlier ACK. The effect time is the engine-written marker (`writeconfig`), never a log line.

```
node spikes/185-control-latency/harness.mjs [--exe C:/Games/Q2Pro/q2pro.exe] [--game opentdm] [--demo test-demo-for-launcher.dm2] [--samples 30] [--bursts 10]
```

One run is ~2.5 min and writes `results/<timestamp>.json` plus `results/<timestamp>-shipped.png`. It refuses to start while a
`q2pro.exe` runs, ends the game with WM_CLOSE (never kills it), removes every file it wrote and restores `q2config.cfg`
byte-exact (`cleanup.configRestored`). `productionUnmodified` in each JSON records that the cfg texts and launch args used equal
the builders' output and that `+set logfile_flush 3` is in the args actually launched. Results and figures: `RESULT.md`.
