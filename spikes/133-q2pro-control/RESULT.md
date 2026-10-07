# Story 133 spike — result

Filled in from two scripted runs of `harness.mjs` against the pinned Q2PRO build
(`q2pro r3834~601a8df8`, Dec 11 2025) on Windows 11, `--wait 5`, `cl_maxfps 125`,
plus the user's eyes-on observations.

Results files this verdict is based on:

- `results/2026-09-27T16-28-35-181Z.json` — client demo `test.dm2` (~35 s), fixed script
- `results/2026-09-27T16-35-41-425Z.json` — MVD `PFAU_20221127-053327_q2dm1.mvd2` (q2dm1,
  ~10 min), longer MVD script incl. switching the chased player

The earlier results files in `results/` are from harness bugs that were fixed during the
run-by-hand (see "Harness fixes found during the run" below) and are not evidence.

## AC1 — commands take effect, with acceptable latency

Latency = ACK observed in the logfile minus control file written.

| Command                                | Took effect (y/n)                      | Latency dm2 (ms) | Latency MVD (ms) |
| -------------------------------------- | -------------------------------------- | ---------------- | ---------------- |
| `pause` (on)                           | y — position freezes (0:03.0 / 0:03.1) | 446              | 587              |
| `pause` (off)                          | y — position runs again                | 701              | 379              |
| `seek +10` / `seek +30` (MVD)          | y — 0:04.1 → 0:14.5 / 0:06.5 → 0:39.6  | 569              | 442              |
| `seek -10` / `seek -20` (MVD)          | y — 0:15.1 → 0:05.7 / 0:39.8 → ~0:20   | 619              | 366              |
| absolute: `seek 30` / `seek 50%` (MVD) | y — → 0:30.4 / → 5:02.8                | 581              | 506              |
| `timescale 2`                          | y — position advances ~2×              | 633              | 502              |
| `timescale 1`                          | y — back to normal speed               | 575              | 423              |

MVD only — switching the view (all took effect, answered by `[MVD] ...` log lines):

| Command                         | Engine reply                                                    | Latency (ms)    |
| ------------------------------- | --------------------------------------------------------------- | --------------- |
| `cmd invnext` ×3                | `[MVD] Chasing sycr0z.` / `lamb shanker.` / `sycr0z.`           | 350 / 384 / 319 |
| `cmd invprev`                   | `[MVD] Chasing lamb shanker.`                                   | 446             |
| `cmd chase` (off → free camera) | —                                                               | 378             |
| `cmd chase` (on)                | `[MVD] Chasing lamb shanker.`                                   | 320             |
| `cmd chase q` (quad carrier)    | `[MVD] No players matching 'q' found.` (no quad at that moment) | 318             |
| `seek 10%`                      | —                                                               | 395             |

p95 latency: **701 ms** (dm2), **587 ms** (MVD). Range 318–701 ms.

Any timed-out command? **No** (0 in both runs).

Any duplicate ACK observed? **No** (0 in both runs) — exactly-once holds via the engine-side
`if` guard.

## AC2 — position readback

Readback: `echo POS $cl_demopos` each tick (Q2PRO macro, format `m:ss.f`); works for both
client demos and MVDs.

- Position-sample update interval: **avg 90 ms** (dm2), **84 ms** (MVD); max gap 661 / 669 ms
  (single outliers, next to seeks).
- Correct after `pause`: **yes** — frozen while paused, resumes from the same value.
- Correct after forward seek (`seek +N`, absolute, percent): **yes**.
- Correct after backward seek (`seek -N`): **yes**.

## AC3 — footprint and side effects

- Files written, and where:
  - Control file: `<gamedir>/spike133_ctl.cfg` — written atomically, removed on exit: **yes**.
  - Loop cfg: `<gamedir>/spike133.cfg` — removed on exit: **yes** (no `spike133*` left in
    `opentdm/`).
  - Logfile: `<gamedir>/logs/qconsole.log` — left in place after the run (by design): **yes**.
    Q2PRO appends to it across runs (`logfile 2`), and prefixes every line with
    `logfile_prefix` (`[YYYY-MM-DD HH:MM] `).
- Logfile growth: 137491 → 148529 bytes (dm2, 11 s, +11 KB);
  175856 → 227381 bytes (MVD, 55 s, +51.5 KB) — **~1 KB/s, ~3.4 MB per hour of playback**.
- CPU cost delta at `--wait 5`: **not measured** — the harness samples the baseline at process
  start and never with the loop switched off, so 0.16 → 54.2 CPU-s is the whole game, not the
  loop.
- User binds disturbed (eyes-on)? **No.**
- Console typing (backtick console) disturbed (eyes-on)? **No.**
- FPS visibly affected (eyes-on)? **No.**
- Behavior across a map change inside the demo: **not tested** — neither demo contains one.
- Behavior at the demo's end: the engine prints `Demo finished`; the loop **keeps running**
  (commands then answer `Not playing a demo.`). Harmless, but it does not end with the demo.

## Go thresholds

- [ ] Every AC1 command takes effect, p95 latency ≤ 300 ms — **all take effect; p95 587–701 ms
      misses the latency bar.**
- [x] Position updates at least every 500 ms, correct after pause / forward seek / backward
      seek — avg 84–90 ms; single outliers up to ~670 ms next to seeks.
- [x] No visible disturbance of the user's binds or console typing.
- [ ] Loop costs ≤ 5% extra CPU at the chosen poll interval — **not measured**; no visible FPS
      impact.
- [ ] The loop survives a map change inside the demo and the demo's end, or ends cleanly with
      the demo — **demo end: survives but does not end; map change: not tested.**

Reasons / notes:

- **Latency (missed, fixable):** the user judged ~0.6 s acceptable for the timeline for now,
  to be tuned in [[164]]. The split between "engine picks up the control file" and "harness
  sees the ACK in the log" was not isolated; both sides have obvious levers (lower `--wait`,
  faster log polling, reading the open file without `stat`).
- **CPU (not measured):** needs a loop-off vs. loop-on comparison — part of [[164]]'s
  implementation, not a blocker: no visible FPS cost.
- **Demo end:** [[164]] stops the loop itself when it sees `Demo finished` or the session ends.
- **Map change:** untested; [[164]] must check it with a multi-map demo.
- **MVD:** works through the same channel; `seek` takes percentages, and the chased player is
  switched with `cmd invnext` / `cmd invprev` / `cmd chase [player_id]`.

### Harness fixes found during the run

What the implementation in [[164]] must do the same way:

1. **`+demo` before `+exec`.** The loop alias re-inserts itself at the front of the command
   buffer every tick, so anything queued after it (e.g. `+demo`) never runs.
2. **Log path and format.** The log is `<gamedir>/logs/<logfile_name>`, every line carries the
   `logfile_prefix` timestamp, the file is appended across runs (start reading at its current
   end), and reads can land mid-line (buffer the unterminated tail).
3. **Exactly-once needs an engine-side guard.** Swapping the control file back to idle from the
   harness fired every command 2–8× (the loop ticks faster than the ACK can be observed). The
   pinned build's `if` command fixes it:
   `if $spike133_seq != N then "<command>; set spike133_seq N; echo ACK N"`, with
   `set spike133_seq 0` in the loop cfg.
4. **Position:** `$cl_demopos`; `$time` does not exist in Q2PRO.
5. **MVD files:** pass the file name _with_ `.mvd2`; `demo` then hands it to `mvdplay`. Without
   an extension `demo` assumes `.dm2`.

**Decision: go** — cfg polling works on Windows for client demos and MVDs; [[164]] builds on it,
[[134]] is withdrawn. Latency and CPU are open tuning items for [[164]], not blockers.
