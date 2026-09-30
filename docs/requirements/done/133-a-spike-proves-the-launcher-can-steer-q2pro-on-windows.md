---
id: 133
title: a spike proves the launcher can steer Q2PRO on Windows
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

The demo browser's timeline ([[165]]) lets a user pause, jump, seek and change the speed of a demo
that plays in the real Q2PRO window — like a video player. That needs a channel from the launcher
into the running engine and back. On Linux it is verified in source: `+set sys_console 1`, commands
on stdin, output on stdout (concept `docs/concepts/demo-browser.md` §12.3). On Windows — ~80% of
users — it is **unproven**, and the concept decides that nothing on the timeline is built before
this question is answered (DEMO-27).

This story is a **spike**: its result is a decision, not product code. It tries the cfg-polling
route the concept names — a self-rescheduling alias that re-`exec`s a launcher-written control file
every few frames, with the playback position read back through Q2PRO's `logfile` — against the
Q2PRO build the launcher actually installs. If it works well enough, [[164]] builds on it and
[[134]] is withdrawn; if it does not, [[134]] (a native console helper) is built instead.

## Acceptance Criteria

- [x] **AC1** — On Windows, commands written by a test harness into a control file reach a running
      Q2PRO demo playback: `pause` (on and off), relative `seek +N` / `seek -N`, an absolute seek and
      `timescale` each take effect; the observed latency per command is recorded.
- [x] **AC2** — The harness can read the current playback position back while the demo plays; the
      recorded result states the update interval and whether the position stays correct across
      pause, forward seek and backward seek.
- [x] **AC3** — The side effects are recorded: which files are written where (control file, logfile
      and its growth), the CPU/frame-rate cost at the chosen poll interval, whether the mechanism
      disturbs the user's own binds or console typing, and whether it survives a map change inside
      the demo and the demo's end.
- [x] **AC4** — The outcome is written into the concept (§12.3, open point §17.1 resolved) as
      **go** (cfg polling, [[164]] uses it) or **no-go** (native helper, [[134]]), with its reasons.
- [x] **AC5** — No spike code lands in `src/`; the harness lives outside the shipped app and is
      referenced from the recorded result.

## Open Questions

- [x] **Q1 — Time-box.** One `/build` session for the harness. If the user's run of it does not
      get AC1 working, the result is **no-go** and [[134]] gets built.
- [x] **Q2 — Which demo?** The **user provides the demo** and puts it into the Q2PRO
      installation's `<gamedir>/demos/` folder. The harness does not record one, and no demo is
      committed. (§17.3's licence question does not come up.)
- [x] **Q3 — Acceptance.** **The user runs the spike by hand**; there are no automated tests. The
      agent writes the harness, a how-to and a results template. The user runs them and fills in
      the numbers. Every AC is manual residue (see `## Acceptance Tests`).
- [x] **Q4 — Where the harness lives.** `spikes/133-q2pro-control/` at the repo root. That folder
      is already outside `tsconfig.node.json`/`tsconfig.web.json`'s includes, `vitest.config.ts`'s
      `include` (`src/**`, `scripts/**/*.test.mjs`) and `electron-builder.yml`'s `files`
      (`out/**`), so no config changes are needed.

## Plan

The spike has two phases, split by the user's manual run:

1. **`/build 133` (agent):** D1 harness + D2 how-to/results template. `/build` stops after D2
   with `BLOCKED: user run`. Its verify gates (`build`, `typecheck`, `test`) must stay unchanged,
   because nothing in `src/` moves.
2. **User:** runs the harness against the pinned Q2PRO (`q2pro-nightly-win64`, version
   `r3834~601a8df8`, `content/q2_community_content/engines/manifest.json`) with their own demo,
   and fills in `spikes/133-q2pro-control/RESULT.md`.
3. **`/build 133` resumed (agent):** D3 turns the filled-in RESULT.md into the concept decision
   and marks [[134]] as withdrawn (go) or confirmed (no-go).

**Mechanism under test** (concept §9.1, §12.3):
- The launch looks like `q2pro.exe +set game <gd> +set logfile … +exec spike133.cfg +demo <name>`,
  spawned the same way `src/main/services/launch.ts:339` does it (args array, no shell).
- `spike133.cfg` defines a self-rescheduling alias (`exec <control file>; wait …; <alias>`). The
  control file is written by the harness **atomically** (temp file + rename).
- Readback: the loop echoes the demo position into Q2PRO's `logfile` each tick. The harness tails
  that log. Which cvar, macro or command exposes the position is read from Q2PRO source at commit
  601a8df (`src/client/demo.c`, `doc/client.asciidoc`).
- **Exactly-once:** a file that gets re-`exec`'d re-runs its commands on every tick. The design must
  run each command exactly once, e.g. with sequence-numbered commands plus an `ACK <seq>` echo, and
  the harness must detect and report any duplicate.

**Proposed go thresholds.** Corrections are welcome. D2 writes them into RESULT.md:
- every AC1 command takes effect, with p95 latency ≤ 300 ms;
- the position updates at least every 500 ms and is correct after pause, forward seek and backward
  seek;
- no visible disturbance of the user's binds or console typing;
- the loop costs ≤ 5% extra CPU at the chosen poll interval;
- the loop survives a map change inside the demo and the demo's end, or ends cleanly with the demo.

Missing one threshold does not decide by itself: RESULT.md states whether it is fixable. A failed
AC1 is always no-go (Q1).

## Deliverables

- **D1 — spike harness.** New files: `spikes/133-q2pro-control/harness.mjs` (plain Node ESM,
  builtins only, no deps, matching the style of `scripts/*.mjs`) and
  `spikes/133-q2pro-control/spike133.cfg.template`.
  - **CLI:** `node harness.mjs --q2pro <path to q2pro.exe> --game <gamedir> --demo <file name in
    <gamedir>/demos/> [--wait <frames per tick>] [--run scripted|interactive]`. Refuse to start if
    the exe or the demo is missing.
  - **Setup:** write the bootstrap cfg and control file into the installation's `<gamedir>`, and
    record every path it writes to. Launch Q2PRO with an args array (no shell), with `logfile`
    enabled and flushed per line (check Q2PRO's `logfile`, `logfile_flush` and `logfile_name` in
    source commit 601a8df). Tail the log.
  - **Position readback:** find in Q2PRO source how the current demo position can be echoed each
    tick, and use it.
  - **Control file:** atomic writes (temp + rename). Every command runs exactly once, via a
    sequence number and an `ACK <seq>` echo; any repeat is reported as a duplicate.
  - **Scripted run:** pause on, pause off, `seek +10`, `seek -10`, an absolute seek (`seek 50%`, or
    a time), `timescale 2`, `timescale 1`. For each command, measure latency (write → ACK seen) and
    the position before and after. Sample the position interval throughout. Sample the Q2PRO
    process's CPU (e.g. via `powershell Get-Process`) with the loop off and on. Watch the logfile
    size over the run.
  - **Interactive run:** type a command, it is sent, and ACK plus position are printed. The user
    uses it to try binds, console typing, a map change and the demo's end.
  - **Output:** `spikes/133-q2pro-control/results/<timestamp>.json` with raw samples and a printed
    summary. On exit, remove the cfg and control files it wrote, and leave the log file.
  - Nothing under `src/` changes.
- **D2 — how-to and results template.** New files: `spikes/133-q2pro-control/README.md` and
  `spikes/133-q2pro-control/RESULT.md`.
  - **README:** prerequisites (a Q2PRO installation from the launcher, the user's demo copied to
    `<gamedir>/demos/`), exact commands for both runs, and what to watch for by eye: in-game
    `scr_demobar`, fps with `cl_showfps 1`, binds, console typing, map change, demo end.
  - **RESULT.md:** one section per AC1–AC3, with fields for the numbers the harness prints (latency
    per command, position interval, correctness after pause/seek, files and log growth, CPU, the
    observations). The go thresholds from `## Plan`. A final **Decision: go / no-go** line, with
    reasons and the JSON file it refers to.
- **D3 — record the decision** (only after the user has filled in RESULT.md; `/build` does not
  guess numbers). Edit `docs/concepts/demo-browser.md` §12.3 (Windows bullet: the outcome, with a
  link to `spikes/133-q2pro-control/RESULT.md`), §9.1 (turn the cfg-polling `[I, untested]` tag
  into the verified outcome), §13's "Remote timeline" row, and §17.1 (mark it resolved, with the
  reasons). In `docs/requirements/134-*.md`, add a note at the top of `## Requirement`: withdrawn
  (go) or confirmed (no-go), with a link to RESULT.md. If the decision is go, add a one-line pointer
  to RESULT.md in `docs/requirements/164-*.md` too.

## Model Hints

No `deliverable-hard`: the spike code does not ship, and a mistake in it shows up during the
user's run, not in production.

Review: → default

## Acceptance Tests

The user decided (Q3) that this spike is validated by hand, with no automated tests. The engine and
the user's demo exist only on the user's Windows machine.

- AC1 → manual residue: needs the real pinned Q2PRO and the user's own demo on Windows. The user
  runs `harness.mjs --run scripted` (README) and records latency per command in RESULT.md §AC1.
- AC2 → manual residue: same reason. The scripted run's position samples go into RESULT.md §AC2.
- AC3 → manual residue: same reason, plus eye-only observations (binds, console typing, map
  change, demo end). The interactive run and the README checklist go into RESULT.md §AC3.
- AC4 → manual residue: the decision rests on the user's numbers. The `/build` review checks that
  §12.3, §9.1, §13 and §17.1 of `docs/concepts/demo-browser.md` state the go/no-go with reasons,
  and that [[134]] carries the matching note.
- AC5 → manual residue: the user chose no automated tests. The `/build` review checks that
  `git diff --name-only -- src/` is empty and that §12.3 links `spikes/133-q2pro-control/`.

### Coverage

| AC | Deliverable | Proof |
| --- | --- | --- |
| AC1 | D1 (scripted run), D2 (RESULT §AC1) | manual residue, user run |
| AC2 | D1 (position readback), D2 (RESULT §AC2) | manual residue, user run |
| AC3 | D1 (paths, log growth, CPU, interactive), D2 (checklist) | manual residue, user run |
| AC4 | D3 | review of the concept diff |
| AC5 | D1 (location), D3 (link) | review: no `src/` diff |

## Done

**Decision: go.** Cfg polling steers the pinned Q2PRO (`r3834~601a8df8`) on Windows for
client demos and MVDs. [[164]] builds on it, and [[134]] is withdrawn. The result is
`spikes/133-q2pro-control/RESULT.md`, based on `results/2026-09-27T16-28-35-181Z.json` (dm2)
and `…T16-35-41-425Z.json` (MVD).
- **AC1:** every command takes effect with 0 duplicates. p95 latency is 587–701 ms, which misses
  the 300 ms bar; the user accepted this for now, and tuning is an open item in 164. The MVD run
  also switched the chased player (`cmd invnext`/`invprev`/`chase`).
- **AC2:** `$cl_demopos` updates every ~85–90 ms and stays correct across pause, forward seek
  and backward seek.
- **AC3:** files are written and removed cleanly. The log grows by ~1 KB/s. Binds, console and
  fps were not disturbed (eyes-on). CPU was **not measured** (no loop-off baseline). The loop
  keeps running past the demo's end. A map change was **not tested**.
- **The mechanism changed during the user's run.** The planned harness-side idle swap fired each
  command 2–8×, so exactly-once is now an engine-side guard:
  `if $spike133_seq != N then "…; set spike133_seq N; echo ACK N"`. Other fixes: `+demo` before
  `+exec`, log path `<gamedir>/logs/` with the timestamp prefix stripped, tailing from the end
  of the file, buffering partial lines, and keeping the `.mvd2` extension. All of these are
  carried into [[164]]'s requirement.
- D3: `docs/concepts/demo-browser.md` §9.1, §12.3, §13 and §17.1 now record the go. 134 has
  the withdrawn note, and 164 has the pointer plus the spike's findings and open items.

Commit: `133: Q2PRO steering spike — go for cfg polling on Windows; decision recorded`

Verification (narrow gate): `npm run build`, `npm run typecheck` and `npx vitest run --changed HEAD`
are green (no test files affected). `git diff --name-only HEAD -- src/` is empty (AC5).
`node --check harness.mjs` is green. AC1–AC5 are manual residue as planned (a real Q2PRO and the
user's demos exist only on the user's machine; AC4/AC5 are covered by review). The default review
PASSed with no findings; it cross-checked every RESULT.md number against the two JSON files.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 5
