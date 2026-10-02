---
id: 163
title: a playback session keeps a line to the game
status: done # draft -> ready -> in-progress -> done
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

- [x] **AC1** — A launch started as a demo playback session can be given stdin/stdout pipes; main
      holds them for the lifetime of the process.
- [x] **AC2** — Every other launch (Play from the library, Join/Spectate from the servers module)
      still spawns with `stdio: 'ignore'`; the existing `launch.test.ts` assertion keeps passing and a
      new test pins the difference.
- [x] **AC3** — The session's stdout is drained continuously, so a chatty engine can never block on
      a full pipe.
- [x] **AC4** — When the game exits, the pipes are closed and the session ends; when the launcher
      exits, the game follows the rule decided in Q1.
- [x] **AC5** — Only one playback session exists at a time, consistent with the one-running-game
      rule of the game lifecycle.

## Open Questions

- [x] ~~**Q1 — Detached + pipes** — normal launches are `detached`; does a playback session stay
      detached (the game survives a launcher exit, the pipe breaks) or not?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Windows** — does a Windows session need pipes too (native helper, [[134]]), or does
      cfg polling ([[133]] go) make this Linux-only?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **Q1 — not detached; the launcher lets go, never kills.** A playback session is spawned
  `detached: false` exactly like every direct launch today (the premise is off: only the Steam
  handoff is `detached`); on launcher quit main ends stdin and destroys its stdout end but never
  kills the game, so what happens to the process afterwards is the same as for a normal launch on
  that platform. Reason: AC2 wants a session to differ from a normal launch only in `stdio`, and a
  demo left running is still steerable by the in-game binds (concept §12.2).
- **Q2 — pipes are platform-neutral in `LaunchService`, requested only by the Linux channel.** The
  option works (and is tested) on every platform; [[164]]'s Linux channel asks for it, its Windows
  channel uses cfg polling and does not. Reason: spike [[133]] ended in go and [[134]] is withdrawn,
  so Windows needs no pipe — and nothing user-visible differs per platform, so the parity rule has
  nothing to disable.
- **Pipes are main-only.** The request is a second, main-side argument to `start()`, never a field
  of `LaunchInput`/`launchInputSchema`, so `launch:start` from the renderer cannot open a pipe.
  Reason: a pipe with no main consumer is exactly the undrained pipe AC3 forbids, and the renderer
  must not reach the engine's stdin.
- **A session through a Steam handoff is refused** with `launch.error.playbackNeedsDirectLaunch`,
  mirroring `connectNeedsDirectLaunch`. Reason: a `steam://` URL carries neither `+demo` nor a pipe.
- Sprint-level **(User)**: playback is Q2PRO only; this story is engine-agnostic plumbing either way.

## Plan

Main-only change to `src/main/services/launch.ts`; no IPC channel, no renderer surface. [[159]]'s
play handler keeps calling `start(input)`; [[164]]'s Linux channel is the first caller that passes
`{ playback: true }`.

1. `start(input, options?: { playback?: true })`. Without the option — every path that exists
   today, including `launch:start` — the spawn options stay exactly
   `{ cwd, stdio: 'ignore', windowsHide: false, detached: false }`.
2. With it: `stdio: ['pipe', 'pipe', 'ignore']`, still `detached: false`; the child is wrapped in a
   `PlaybackSession` (new `src/main/services/playback-session.ts`) that `LaunchService` holds and
   exposes via `getPlaybackSession()`.
3. Drain: stdout's `'data'` listener is attached at spawn, before anyone subscribes, and fans
   chunks out to subscribers (dropped when there are none). stdin gets an `'error'` listener so a
   late write (EPIPE) is logged, never an uncaught exception in main.
4. End: on `'exit'`, `'error'` or a synchronous spawn throw the session ends once, next to the
   existing connect-cfg / `launchSeq` handling, which does not change.
5. Launcher quit: `releasePlaybackSession()` ends it the same way, never `kill()`; `before-quit`
   in `src/main/index.ts` calls it.
6. One at a time falls out of the existing `alreadyRunning` / `startInFlight` guard — tests pin it.
7. Steam handoff + `playback` → `fail('launch.error.playbackNeedsDirectLaunch')` (new `en.json` key).

## Deliverables

- **D1 — playback pipes in `LaunchService`.** Touches `src/main/services/launch.ts`, new
  `src/main/services/playback-session.ts`, `src/main/services/launch.test.ts`, new
  `src/main/services/playback-session.test.ts`, `src/renderer/src/i18n/locales/en.json` (one key
  under `launch.error`, next to `connectNeedsDirectLaunch`: `playbackNeedsDirectLaunch` = "This
  installation launches through Steam, which cannot play a demo directly."). Mirror: the
  connect-cfg lifecycle in `start()`/`startReserved()` (exit / error / spawn-throw cleanup) and the
  mocked-`spawn` + fake-child pattern in `launch.test.ts`.
  `start(input, options?: { playback?: true })` — a main-only argument, never part of
  `LaunchInput`. Without `playback` the spawn options stay exactly
  `{ cwd, stdio: 'ignore', windowsHide: false, detached: false }`. With it: `stdio:
['pipe','pipe','ignore']`, `detached: false`, and a `PlaybackSession` (`installationId`,
  `write(text): boolean` — false once ended, `onStdout(cb: (chunk: Buffer) => void)` and `onEnd(cb)`
  both returning an unsubscribe, `ended`) returned by `getPlaybackSession()` (`undefined` when
  none). stdout gets its `'data'` listener at spawn and is drained whether or not anyone subscribed;
  stdin has an `'error'` listener (log, never throw). The session ends exactly once on exit, process
  error or spawn throw (stdin ended, listeners removed, `onEnd` fired, getter → `undefined`),
  without changing the connect-cfg / `launchSeq` / `startInFlight` logic. `releasePlaybackSession()`
  ends it the same way and never calls `kill()`. A Steam-handoff plan with `playback` fails
  `launch.error.playbackNeedsDirectLaunch` and spawns nothing. A second `start` (with or without
  `playback`) while a session runs fails `launch.error.alreadyRunning` and leaves the first session's
  pipes intact. Tests: every AC line below naming `launch.test.ts` or `playback-session.test.ts`
  (fake child with real `PassThrough` stdin/stdout).
- **D2 — the launcher lets go on quit; `launch:start` cannot open a pipe.** Touches
  `src/main/index.ts` (the existing `app.on('before-quit', …)` also calls
  `context?.launch.releasePlaybackSession()`), `src/main/ipc/launch.ts` (only if needed — it must
  keep calling `app.launch.start(input)` with one argument) and a new `src/main/ipc/launch.test.ts`
  (mirror `src/main/ipc/installations.test.ts`'s handler-capture style). Needs D1's
  `releasePlaybackSession()`. Test: the AC2 line naming `src/main/ipc/launch.test.ts`.

## Model Hints

- D1 → deliverable-hard: it rewires `startReserved()`, the one path every Play/Join/Spectate goes
  through, where the new session teardown must share the exit/error/spawn-throw branches with the
  connect-cfg cleanup and the `launchSeq`/`startInFlight` guards without changing them — a slip
  regresses every launch, not just playback.
- D2 → default.
- Review: → default — every negative behaviour here (normal spawn options unchanged, no `kill()` on
  quit, no pipe via `launch:start`) is pinned by a named test below.

## Acceptance Tests

No criterion describes a user action (the user-facing Play is [[159]]'s e2e flow), so all are
main-process unit tests against a mocked `spawn` with a fake child — no test starts an engine.

- AC1 → unit `src/main/services/launch.test.ts` › "a playback launch spawns with stdin and stdout
  piped and holds the session until the process exits"; unit
  `src/main/services/playback-session.test.ts` › "write reaches the child's stdin and returns false
  once the session has ended"
- AC2 → unit `src/main/services/launch.test.ts` › "every launch without the playback option spawns
  with stdio ignore, detached false" (Play, Join and Spectate inputs, exact options object); unit
  `src/main/ipc/launch.test.ts` › "launch:start never passes a playback option to the launch
  service"; the existing handoff assertion (`detached: true, stdio: 'ignore'`) keeps passing
- AC3 → unit `src/main/services/playback-session.test.ts` › "stdout is drained with no subscriber
  attached, so a chatty engine never fills the pipe" (writes far past `highWaterMark`, asserts every
  write callback fired)
- AC4 → unit `src/main/services/launch.test.ts` › "the session ends exactly once on exit, on process
  error and on spawn failure, and the connect cfg is still cleaned up"; unit
  `src/main/services/launch.test.ts` › "releasePlaybackSession closes the pipes and never kills the
  game"; unit `src/main/services/playback-session.test.ts` › "a write after the child's stdin broke
  is logged, not thrown"
- AC5 → unit `src/main/services/launch.test.ts` › "a second launch while a playback session runs is
  refused and the first session keeps its pipes"; unit `src/main/services/launch.test.ts` › "a
  playback launch through a Steam handoff is refused without spawning"

## Done

Main-only playback plumbing: `LaunchService.start(input, { playback: true })` spawns with
`stdio: ['pipe','pipe','ignore']` (not detached) and holds a `PlaybackSession` (new
`playback-session.ts`, stdout drained from spawn, stdin errors logged). Normal launches keep their
exact spawn options; `launch:start` cannot open a pipe. `before-quit` releases the session (ends
stdin, destroys stdout, never kills). New i18n key `launch.error.playbackNeedsDirectLaunch`.

Commit message: `163: playback session pipes in LaunchService — main-only, normal launches stay stdio ignore, released on quit`

Verification (narrow gate): `npm run build` green, `npm run typecheck` green, `npx vitest run --changed HEAD`
green (101 files / 795 tests). No e2e criterion is mapped; launch-related flows run additionally, all
OK: `ui:flow` replays-play-q2pro, replays-play-mvd2, servers-join, servers-no-scan-while-playing,
replays-copy-in. Full regression gate is the sprint's. Review (default, 1 cycle): PASS, no findings.
AC -> test, all ran and passed: AC1 launch.test.ts "a playback launch spawns..." + playback-session.test.ts
"write reaches the child's stdin..."; AC2 launch.test.ts "every launch without the playback option..."

- ipc/launch.test.ts "launch:start never passes a playback option..."; AC3 playback-session.test.ts
  "stdout is drained..."; AC4 launch.test.ts "the session ends exactly once..." + "releasePlaybackSession
  closes the pipes..." + playback-session.test.ts "a write after the child's stdin broke..."; AC5
  launch.test.ts "a second launch while a playback session runs..." + "a playback launch through a Steam
  handoff is refused...". No manual residue. No changelog entry (no user-facing change).

Decisions:

- Spawn throw: the session is opened only after `spawn()` returns, so a throw leaves no session (getter stays `undefined`); tested.
- Error listeners stay on both pipes after the session ends, so a late EPIPE never becomes an uncaught exception in main.
- Broken stdin does not end the session; `write()` returns false and logs. `onEnd` registered after the end fires immediately.
- Known trade-off: `releasePlaybackSession()` destroys stdout per the plan; on Linux an engine that does not ignore SIGPIPE could die on its next print after a launcher release. Follow-up for [[164]] if it matters (alternative: keep draining).

tiers: D 2 / hard 1 · review default · cycles 1 · agents 4
