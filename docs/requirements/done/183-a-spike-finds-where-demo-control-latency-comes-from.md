---
id: 183
title: A spike finds where demo-control latency comes from
status: done # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

Timeline controls (pause, jump, seek, speed) feel noticeably delayed on Windows. Spike [[133]]
measured 318–701 ms from control file to ACK with a ~77 ms loop tick (`wait 5`). Since [[174]] the
loop waits 13 frames (~200 ms), and its comment notes the buffered logfile now delivers POS lines in
**bursts ~1.3 s apart** — fewer lines per second fill Q2PRO's log buffer more slowly. On top, the
Windows channel sends the next command only after the previous one's ACK arrives through that same
log, so two quick clicks wait for each other.

Before building the fix ([[185]]) we need numbers on the real Q2PRO, not guesses: which share of the
delay is the loop tick, the log flush, and the ACK serialisation — and which lever removes it
without bringing back [[174]]'s console flood or [[169]]'s input starvation.

This is a spike: its output is a `RESULT.md` with measurements and a go/no-go per lever, like
`spikes/133-q2pro-control/` and `spikes/169-windowed-stage/`.

## Acceptance Criteria

- [x] **AC1** — `spikes/183-control-latency/RESULT.md` states, for the current production settings on
      real Q2PRO (Windows), the measured time from "control file written" to (a) the command taking
      effect in the game and (b) its ACK being read by the launcher, p50 and p95.
- [x] **AC2** — The result states the measured interval between log flushes (POS/ACK arrival) at the
      current tick.
- [x] **AC3** — The result measures each candidate lever and gives a go/no-go per lever, at least:
      a shorter loop wait; forcing the log to flush every tick (e.g. `logfile` off/on, other
      `logfile_flush` values, padding the log output); dispatching the next command without waiting
      for the previous ACK (several sequences guarded in one control file, or queued lines coalesced
      into one command file).
- [x] **AC4** — For every lever it records the side effects: console/notify lines visible in the game,
      whether in-game typing and binds are still starved as in [[169]], and CPU cost.
- [x] **AC5** — The result names the recommended combination and the target latency [[185]] will be
      held to.
- [x] **AC6** — The result states whether the Linux channel (stdin/stdout, 100 ms poll) shows a
      comparable delay, or explicitly records that Linux was not measured and why.

## Open Questions

- ~~Q1: The spike drives the real `C:\Games\Q2Pro\q2pro.exe`. Probing pitfalls from 133/169 apply
  (buffered logfile: end with WM_CLOSE, never kill; synthetic keystrokes do not arrive). Can the
  sprint run it unattended, or does it need the user at the machine for the eyes-on part?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Spike execution: runs unattended, automated probes only; any eyes-on part becomes manual residue
- The baseline takes its cfg text, launch args and constants from production's
  `playback-channel/protocol.ts` via `jiti` (alias `@shared` → `src/shared`), not a hand copy, because
  AC1 asks for *current production settings* and a mirrored copy can silently drift.
- "Took effect in the game" (AC1a) is timed by an engine-side marker that does not go through the
  logfile (a file the engine writes in the same guarded line, e.g. `writeconfig`; fallback: window rect
  after `vid_geometry` via 169's `win-probe.ps1`), because timing it off log arrival would fold the
  log flush into "effect" and hide exactly the split this spike exists to find.
- ACK over an engine-written file instead of the log is added as a fourth lever, because the effect
  marker already builds it and it bypasses the logfile buffer entirely.
- At least 30 single commands per configuration, spaced ≥ 1 s, because p95 over fewer samples is
  noise; bursts of 3 commands within 300 ms measure serialisation (mirrors [[185]] AC2).
- Demo is `opentdm/demos/test-demo-for-launcher.dm2` (133/169's `test.dm2` is gone); the MVD is not
  re-measured, because 133 showed both formats share the channel with comparable latency.
- Candidate target for AC5 is p95 ≤ 300 ms control-written → ACK read (133's original go bar); the
  spike may name a looser target it can prove, but never ≥ 1 s, because [[184]]'s "waiting for the
  game…" state fires at a fixed 1 s.
- AC4's visible-lines side effect is measured automatically as launcher lines/s in the log (the log
  mirrors the console) plus one screenshot per configuration; judging the screenshots is the manual
  residue per the (User) decision.
- Starvation is probed like 169 P2 (`+echo` queued after `+exec` of the loop cfg), because synthetic
  keystrokes do not reach Q2PRO and that queue position is where typed lines and binds land.
- CPU is loop-on vs loop-stopped (production stop file) process CPU time over a fixed window per
  configuration, because 133 left CPU unmeasured by sampling only against process start.
- Linux (AC6) is recorded as not measured unless a Linux Q2PRO is reachable from this Windows machine,
  with a code-level note on `linux-channel.ts` (stdin, 100 ms poll, no ACK wait) and whether its
  stdout pipe can be block-buffered — because the sprint runs unattended on Windows only.
- Two tiers: the harness is `deliverable-hard` and the review is `story-review-hard` (see Model
  Hints), because the whole output is numbers [[185]] is held to.

## Plan

Throwaway spike in `spikes/183-control-latency/` (outside `src/`, not in any build/test), run
unattended against `C:\Games\Q2Pro\q2pro.exe`, game `opentdm`. No `src/` change, no CHANGELOG entry.

1. Harness (D1): one run per configuration — baseline = production (`wait 13`, `logfile 2`,
   `logfile_flush 1`, one command in flight, next only on ACK, 2000 ms timeout) — then each lever:
   - L1 loop wait 5 / 2 / 1 (`buildLoopCfg(waitFrames)`).
   - L2 forced flush: other `logfile_flush` values, `logfile 0` + `logfile 2` toggle per tick,
     padding output to fill the buffer (record bytes needed).
   - L3 no-wait dispatch: several guarded seqs in one control file; queued lines coalesced into one
     command cfg.
   - L4 ACK via engine-written file instead of the log.
   - up to 3 combinations of the best L1/L2/L3/L4 variants.
   Per run: timestamps for control written, engine marker seen, ACK read; log-arrival batches (10 ms
   poll, plus a 50 ms-equivalent); launcher lines/s; starvation probe; CPU loop-on vs stopped; one
   screenshot. Ends Q2PRO with WM_CLOSE, never kill; refuses to start if `q2pro.exe` is running;
   removes its cfg/marker files.
2. Run + result (D2): run all configurations unattended, write `RESULT.md` citing the results files.

## Deliverables

- [x] **D1** — Harness `spikes/183-control-latency/harness.mjs` + `README.md` (mirror the shape of
  `spikes/169-windowed-stage/harness.mjs` / `README.md`; reuse `spikes/169-windowed-stage/win-probe.ps1`
  by path and the PowerShell screenshot + `CloseMainWindow()` helpers from
  `spikes/174-chat-hud/probe.mjs`). Node ESM, node built-ins plus `jiti` only.
  - Imports `buildLoopCfg`, `buildControlFile`, `encodeControlCommand`, `buildStopFile`,
    `windowsLaunchArgs`, `parseEngineLine`, `LOG_FILE_RELATIVE`, `LOG_POLL_MS`, `ACK_TIMEOUT_MS` and
    the file-name constants from `src/main/modules/replays/playback-channel/protocol.ts` through `jiti`
    with alias `@shared` → `src/shared`; the baseline config must use them unmodified and write the
    exact cfg texts and launch args into the results JSON.
  - CLI: `node spikes/183-control-latency/harness.mjs [--config <name>|--all] [--exe <path>]
    [--game opentdm] [--demo test-demo-for-launcher.dm2] [--samples 30]`. Configurations named
    `baseline`, `wait5`, `wait2`, `wait1`, `flush<N>` (each accepted `logfile_flush` value),
    `logtoggle`, `pad`, `multiseq`, `coalesce`, `fileack`, `combo-<n>`.
  - Preflight (recorded in JSON): which engine-side marker works in the pinned build (`writeconfig
    <name>` producing a file → preferred; else window rect after `set vid_geometry` via
    `win-probe.ps1`); which `logfile_flush` values the build accepts. The effect time (AC1a) comes
    only from that marker, never from a log line's arrival.
  - Per configuration: ≥ `--samples` single commands (mix of `pause`, `seek +10`, `seek -10`,
    `timescale 2`/`1`) spaced ≥ 1 s, plus ≥ 10 bursts of 3 commands within 300 ms; per command:
    control-written, marker-seen, ACK-read timestamps (host `performance.now()`), took-effect
    (y/n), exactly-once check (marker count per seq). Log tail polled at 10 ms; every read batch
    with new POS/ACK lines records arrival time + line count (flush intervals p50/p95/max, lines per
    burst), plus the same series downsampled to production's 50 ms poll.
  - Side effects per configuration: launcher lines/s in the log by kind (`Execing`, `POS`, `ACK`,
    padding); starvation probe (`+echo S183_AFTERARG` after `+exec` of the loop cfg: did it run
    while the loop lived?); q2pro CPU seconds over a fixed 10 s window loop-running vs after the
    production stop file (delta %); one screenshot `results/<ts>-<config>.png`.
  - Writes `results/<timestamp>.json` with raw samples and computed p50/p95 per metric (effect,
    ACK, marker→ACK = flush+poll share, control→marker = tick share, burst last-ACK vs single).
  - Refuses to run while any `q2pro.exe` is running; ends the game with WM_CLOSE (never kill) and
    reads the log after exit; removes every cfg/marker file it wrote (checked and recorded).
  - Acceptance: `node spikes/183-control-latency/harness.mjs --config baseline --samples 5` runs
    unattended to a results JSON containing all fields above and leaves no `q2l_*`/marker files in
    the game dir. Files: `spikes/183-control-latency/harness.mjs`, `spikes/183-control-latency/README.md`.
- [x] **D2** — Run `--all` unattended (re-run a configuration once if the game fails to start) and
  write `spikes/183-control-latency/RESULT.md` (mirror `spikes/169-windowed-stage/RESULT.md`), every
  number citing its `results/*.json` file:
  - AC1: baseline table — control written → took effect, and → ACK read, p50/p95, split into tick
    share (control → marker) and flush+poll share (marker → ACK), plus burst serialisation cost.
  - AC2: flush interval at the current tick (p50/p95/max, lines per burst; 10 ms and 50 ms poll).
  - AC3 + AC4: one row per lever/combination — p50/p95 effect and ACK, flush interval, go/no-go with
    reason, launcher lines/s vs baseline, starvation (yes/no), CPU delta %, screenshot file.
  - AC5: recommended combination and the target latency [[185]] is held to (p95, control written →
    ACK read, and the POS interval it promises) — or, if no lever gets under 1 s, say so plainly
    (then [[185]]'s (User) fallback applies).
  - AC6: Linux measured or "not measured" + reason + code-level assessment of `linux-channel.ts`.
  - A "Manual residue" section listing the screenshots to judge by eye (AC4 visible lines).
  Files: `spikes/183-control-latency/RESULT.md`, `spikes/183-control-latency/results/*`.

## Model Hints

- D1 → deliverable-hard — new measurement path against a buffered-log engine: the effect marker must
  be independent of the logfile, exactly-once must hold under L3's multi-seq/coalesced dispatch, and
  133/169's pitfalls (WM_CLOSE not kill, `+demo` before `+exec`, `"` breaking the guard, appended log
  across runs) each silently corrupt the numbers.

Review: → story-review-hard — the plausible wrong spike times "took effect" off log arrival (so the
flush share reads as zero and every log lever looks useless) or reports RESULT.md numbers not present
in the results JSON; both pass a default review that checks sections and shape.

## Acceptance Tests

A spike's evidence is an unattended automated probe run against real Q2PRO, not a vitest/ui:flow
test: the harness is the test, `RESULT.md` + `results/*.json` its report. No renderer surface is
involved, so `ui:flow` does not apply.

- AC1 → probe `node spikes/183-control-latency/harness.mjs --config baseline` › results JSON
  `baseline.effect.{p50,p95}` + `baseline.ack.{p50,p95}` → RESULT.md "AC1".
- AC2 → probe same run › `baseline.flushIntervals.{p50,p95,max}` → RESULT.md "AC2".
- AC3 → probe `node spikes/183-control-latency/harness.mjs --config <name>` (one run per config; `--all` exceeds the 10-min call limit) › one JSON section per lever
  (`wait*`, `flush*`, `logtoggle`, `pad`, `multiseq`, `coalesce`, `fileack`, `combo-*`) → RESULT.md
  lever table with go/no-go.
- AC4 → probe `--all` › per-config `sideEffects.{linesPerSec,starved,cpuDeltaPct,screenshot}` →
  RESULT.md lever table. **manual residue:** judging by eye how the console/notify lines in each
  screenshot look to a player — the (User) decision makes eyes-on parts residue; the automated line
  count is the gate.
- AC5 → RESULT.md "AC5" names a configuration present in the `--all` results JSON and a p95 target
  that configuration measured at or under.
- AC6 → RESULT.md "AC6" (measured numbers, or "not measured" + reason + `linux-channel.ts`
  assessment). **manual residue** if not measured: no Linux Q2PRO on the unattended Windows machine.

## Done

Spike finished; `spikes/183-control-latency/` holds the harness, README, RESULT.md and 16 results JSON+PNG pairs (15 planned configs + `combo-4`). No `src/` change, no CHANGELOG entry (spike, nothing user-facing).

- **Headline:** production baseline measures effect p50/p95 117/209 ms but ACK read p50/p95 1277/1537 ms — the delay is the log flush (~1.3 s interval, 525-byte chunks), not the tick. Go: `flush3` (logfile_flush 3, ACK p95 254 ms, ~9 lines/s), `multiseq` for bursts (last ACK 940 vs 3750 ms), `fileack` as fallback. No-go: wait5/2/1 and combos 1-3 (wait1 ~91-101 lines/s vs the 10/s cap of 174/185), flush0, logtoggle, pad, coalesce. **Recommended: `combo-4` = flush3 + multiseq at wait 13; 185 target p95 control→ACK ≤ 350 ms at the 50 ms poll (measured 293), bursts of 3 ≤ ~350 ms, POS interval p95 ≤ 400 ms.** Wait1 (ACK p95 133 ms) is documented as the latency floor only.
- **Commit message:** `183: spike — demo-control latency is the log flush; flush3 + multiseq at wait 13 measured p95 ≤ 293 ms, wait1 is a console flood`
- **Verification (narrow gate):** `npm run build`, `npm run typecheck` green; `npx vitest run --changed HEAD` finds no tests (no `src/` change); ui:flow n/a (no renderer surface). AC walk by the harness runs + RESULT.md (~80 figures spot-checked against the JSONs, zero mismatches): AC1-AC5 PASS via `harness.mjs --config <name> --samples 30` per config; AC6 PASS as "not measured" (no Linux Q2PRO) + code assessment of `linux-channel.ts`.
- **Review:** stage 1 PASS with findings (flush2 state check invalid — demo never played; CPU unusable; README), fixed; stage 2 (hard) FAIL on the recommendation (combo-1 at 91 lines/s breaks 174/185's line budget and AC4's "line count is the gate"; wrong claim that only fileack beat 300 ms; multiseq/coalesce judged on the wrong metric) — fixed by measuring `combo-4`, re-ranking and rewriting RESULT.md, then narrow gate re-run green.
- **Decisions:** configs ran as one invocation each (`--all` would exceed the 10-min call ceiling; ~3 min per config), combos read earlier JSONs; CPU windows raised to 30 s (harness), yet CPU stays inconclusive in RESULT.md (bimodal, plausibly engine-fps-dependent, unproven); `combo-4` added in review cycle 2 because the data pointed to an in-budget combination nobody had measured; third review cycle not spent — the rewrite was re-verified by a number walk, not a fresh reviewer.
- **Manual residue:** judge the per-config screenshots by eye (AC4 visible console/notify lines, esp. `combo-4` vs baseline); Linux delay not measured (AC6, no Linux Q2PRO on this machine); burst serialisation at production's 50 ms poll and wait2+flush3 not measured.
- No q2pro.exe running, no `q2l_*`/`configs` leftovers in the game dir; `q2config.cfg` restored.

tiers: D 2 / hard 1 · review default+hard · cycles 2 · agents 10
