---
id: 295
title: Engine-mode playback runs behind the player API
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

A user who stays in engine mode notices nothing: the demo controls behave exactly as before. The
existing cfg/exec channel (Windows) and stdin channel (Linux) stay, but the renderer reaches them
through the same `DemoPlayer` interface as integrated mode. The UI then knows only one interface.

Context:

- [concept §9.4](../concepts/integrated-demo-player.md) (the command → channel mapping table),
  [concept §9.2](../concepts/integrated-demo-player.md) (capabilities per mode),
  [concept §6](../concepts/integrated-demo-player.md) (today's playback).
- Today's channels stay unchanged:
  - main: `src/main/modules/replays/playback-control.ts`, `playback-timeline.ts`,
    `playback-volume.ts`, `playback-console.ts`, `playback-stop.ts`,
    `playback-channel/{windows-channel,linux-channel,engine-less-channel,protocol}.ts`.
  - Contract: `src/shared/modules/replays.ts`, with the handlers `playbackTimeline`,
    `playbackVolume`, `playbackConsoleSend`, `playbackStop` and `demoPlay`, and the events
    `playbackPosition`, `playbackState` and `playbackDisplay`.
  - Actions: `src/shared/replays/timeline.ts` (`timelineActionSchema`, `SPEED_STEPS`,
    `JUMP_STEP_S`).
- Renderer client: `src/renderer/src/modules/replays/client.ts`. R1Q2 marks its controls as
  unavailable through `controlsUnavailable` (`engine-less-channel.ts`, story 275).
- Constraints:
  - New file `src/renderer/src/modules/replays/native/native-player.ts`. It uses the existing
    client functions and event subscriptions; no new IPC channels.
  - `load` calls the existing `demoPlay` path, including the stage rect and `startAtS`
    (`useDemoPlay.ts`, `pendingSeekS` in `playback-store.ts`); that logic is called, not rebuilt.
  - Deriving a pause from a standing position stays in `reducePlaybackView`. The adapter passes on
    the engine's own pause state when it has one.
  - `setHud` and `console` go through `playbackConsoleSend`. The HUD lines arrive with [[310]];
    until then `setHud` returns `fail('replays.player.error.notImplemented')`.
  - Tests use fake client and event bus and injected time, with no real timers (`/test-gates`).
- Not in scope: rebuilding the store, the timeline or cinema ([[297]], [[309]]); any change to the
  cfg protocol, to `scripts/lib/stub-engine.cjs` or to main handlers; export in engine mode.
- The adapter is not yet wired into the UI ([[297]] does that), but is fully tested.
- Depends on: [[292]].

## Acceptance Criteria

- [ ] **AC1** — `send({ kind: 'seek', target: { kind: 'absolute', ms: 65400 } })` in a running
      engine session calls `playbackTimeline({ kind: 'seekTo', seconds: 65 })` (ms rounded to s).
- [ ] **AC2** — `send({ kind: 'pause' })` sends no `togglePause` when the last
      `playback.position` reported `paused: true`. It sends exactly one when it reported
      `paused: false`.
- [ ] **AC3** — A pushed `playback.position { positionMs: 12000, durationMs: 90000, paused: false }`
      becomes the event `{ kind: 'position', positionMs: 12000, durationMs: 90000 }`.
- [ ] **AC4** — A change of the pushed pause state additionally emits `{ kind: 'paused', … }`.
- [ ] **AC5** — `playback.state` `finished` emits `finished`.
- [ ] **AC6** — `playback.state` `ended` emits `ended`, and no event follows it.
- [ ] **AC7** — For a Q2PRO session the capabilities are `step: false` and `export: false`;
      `seek`, `speed`, `volume` and `hud` are true; `formats` is `['dm2', 'mvd2']`.
- [ ] **AC8** — For an R1Q2 session (`controlsUnavailable` set), `seek`, `speed`, `volume` and
      `hud` are false.
- [ ] **AC9** — `send({ kind: 'step', frames: 1 })` returns
      `fail('replays.player.unavailable.stepEngineMode')` and sends nothing over IPC.
- [ ] **AC10** — `npx vitest run src/renderer/src/modules/replays/native` passes, with one test
      each for AC1–AC9.
- [ ] **AC11** — The existing engine-mode flows `replays-timeline` and `replays-play-r1q2` stay
      green.
- [ ] **AC12** — No file under `src/main/` changes (`git diff --stat -- src/main` is empty).
- [ ] **AC13** — The new i18n keys (`replays.player.unavailable.stepEngineMode`, …) are in
      `src/renderer/src/modules/replays/locale/en.json`.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
