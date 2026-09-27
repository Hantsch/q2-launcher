---
id: 163
title: a playback session keeps a line to the game
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

To steer a running demo on Linux, the launcher writes commands to the engine's stdin and reads its
stdout (`+set sys_console 1`, concept `docs/concepts/demo-browser.md` §12.3). Today's
`LaunchService` spawns every game with `stdio: 'ignore'` (`src/main/services/launch.ts`) — there is
no pipe to hold. Changing that is a deliberate change to a shared service, so it is its own story
(concept open point §17.14): a **playback session** gets its pipes, **every normal launch stays
exactly as it is**.

## Acceptance Criteria

- [ ] **AC1** — A launch started as a demo playback session can be given stdin/stdout pipes; main
      holds them for the lifetime of the process.
- [ ] **AC2** — Every other launch (Play from the library, Join/Spectate from the servers module)
      still spawns with `stdio: 'ignore'`; the existing `launch.test.ts` assertion keeps passing and a
      new test pins the difference.
- [ ] **AC3** — The session's stdout is drained continuously, so a chatty engine can never block on
      a full pipe.
- [ ] **AC4** — When the game exits, the pipes are closed and the session ends; when the launcher
      exits, the game follows the rule decided in Q1.
- [ ] **AC5** — Only one playback session exists at a time, consistent with the one-running-game
      rule of the game lifecycle.

## Open Questions

- [ ] **Q1 — Detached + pipes** — normal launches are `detached`; does a playback session stay
      detached (the game survives a launcher exit, the pipe breaks) or not?
- [ ] **Q2 — Windows** — does a Windows session need pipes too (native helper, [[134]]), or does
      cfg polling ([[133]] go) make this Linux-only?

## Plan

<!-- Filled by /refine 163, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 163. -->

## Model Hints

<!-- Filled by /refine 163. -->

## Acceptance Tests

<!-- Filled by /refine 163. -->

## Done

<!-- Filled by /build 163. -->
