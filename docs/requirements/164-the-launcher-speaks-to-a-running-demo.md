---
id: 164
title: the launcher speaks to a running demo
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — A main-side channel interface offers "send command" and a "position" stream for the
      current playback session, with a Linux and a Windows implementation.
- [ ] **AC2** — On Linux, a command reaches the engine via stdin and the position is parsed from
      stdout.
- [ ] **AC3** — On Windows, commands and position travel over the route [[133]] decided.
- [ ] **AC4** — Position (and duration, where the engine reports it) is pushed to the renderer as a
      `module:event` at a steady interval while the demo plays.
- [ ] **AC5** — When the game exits, the channel closes, the last event says the session ended, and
      any control/log files the channel created are removed.
- [ ] **AC6** — A command sent while no session exists is rejected with a typed error.
- [ ] **AC7** — The parsing of engine output into a position is pure code with unit tests fed from
      recorded output; both implementations are exercised against a stubbed engine in tests.

## Open Questions

- [ ] **Q1 — Position source** — which Q2PRO output carries the position (`cl_demopos`,
      `scr_demobar` text, a periodic command echo), and how often?
- [ ] **Q2 — Interval** — how often position events are pushed (smooth enough for a seek bar, cheap
      enough for IPC).

## Plan

<!-- Filled by /refine 164, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 164. -->

## Model Hints

<!-- Filled by /refine 164. -->

## Acceptance Tests

<!-- Filled by /refine 164. -->

## Done

<!-- Filled by /build 164. -->
