---
id: 133
title: a spike proves the launcher can steer Q2PRO on Windows
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — On Windows, commands written by a test harness into a control file reach a running
      Q2PRO demo playback: `pause` (on and off), relative `seek +N` / `seek -N`, an absolute seek and
      `timescale` each take effect; the observed latency per command is recorded.
- [ ] **AC2** — The harness can read the current playback position back while the demo plays; the
      recorded result states the update interval and whether the position stays correct across
      pause, forward seek and backward seek.
- [ ] **AC3** — The side effects are recorded: which files are written where (control file, logfile
      and its growth), the CPU/frame-rate cost at the chosen poll interval, whether the mechanism
      disturbs the user's own binds or console typing, and whether it survives a map change inside
      the demo and the demo's end.
- [ ] **AC4** — The outcome is written into the concept (§12.3, open point §17.1 resolved) as
      **go** (cfg polling, [[164]] uses it) or **no-go** (native helper, [[134]]), with its reasons.
- [ ] **AC5** — No spike code lands in `src/`; the harness lives outside the shipped app and is
      referenced from the recorded result.

## Open Questions

- [ ] **Q1 — Time-box.** How long may the spike run before it is called no-go by default?
- [ ] **Q2 — Which demo?** The user has no sample demo yet (concept intro). The spike needs at least
      one real `.dm2` played in the pinned Q2PRO — recorded for the spike, or a community demo whose
      licence allows it (§17.3)?
- [ ] **Q3 — Acceptance.** Every criterion needs a real engine on a real Windows machine, so this is
      expected to be manual residue end to end — confirm that is acceptable for a spike.

## Plan

<!-- Filled by /refine 133, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 133. -->

## Model Hints

<!-- Filled by /refine 133. -->

## Acceptance Tests

<!-- Filled by /refine 133. -->

## Done

<!-- Filled by /build 133. -->
