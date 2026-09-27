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
- **Windows:** whatever [[133]] decided — cfg polling (launcher-written control file, position via
  `logfile`) on **go**, the native helper [[134]] on **no-go**.

**Blocked by [[133]].** No timeline story starts before the spike has a result (DEMO-27).

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
