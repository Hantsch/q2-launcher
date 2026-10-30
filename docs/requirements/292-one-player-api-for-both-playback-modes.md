---
id: 292
title: One player API for both playback modes
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want the demo player's commands, events and capabilities as one
transport-independent, validated contract, so that the UI, the integrated adapter and the native
adapter speak the same language, and new transports (worker, IPC) stay possible without UI
changes.

Context:

- [concept §9.1](../concepts/integrated-demo-player.md) (API types), [concept §9.2](../concepts/integrated-demo-player.md) (capabilities per mode).
- Reused, not duplicated: `src/shared/replays/timeline.ts` (`SPEED_STEPS`, `JUMP_STEP_S`,
  `PAGE_STEP_S`, `reducePlaybackView`, `PlaybackView`, `formatPlaybackPosition`),
  `src/shared/replays/demo-control.ts` (`SeekTarget` in seconds, `demoSeekCommand` — the native
  adapter rounds to seconds through it), `src/shared/replays/console-line.ts` (free console line
  check, reused via `.refine`). `PlayerMode` from [[287]] (`src/shared/replays/player-mode.ts`).
- `checkLine` lives in main today (`playback-channel/protocol.ts`); the renderer-side adapter needs
  the same rule, so it comes to `src/shared/` if `console-line.ts` does not already cover it.
- `src/shared` stays pure (no node, DOM, electron; `src/architecture.test.ts`). `reducePlayerView`
  sits next to `reducePlaybackView`; the old reducer is removed only in [[297]] once it has no
  caller. No transport runtime code here.
- Not in scope: adapters ([[296]], [[295]]), UI changes ([[297]]), export types ([[302]]).
- Depends on: —

## Acceptance Criteria

- [ ] **AC1** — `src/shared/replays/player-api.ts` exports types and zod schemas for
      `PlayerCommand`, `PlayerEvent`, `PlayerCapabilities`, `HudOptions`, `PovInfo`, `HudStats`,
      the ms-based `SeekTarget` and the `DemoPlayer` interface as in concept §9.1.
- [ ] **AC2** — `PlayerMode` is re-exported from `player-mode.ts`, not redefined.
- [ ] **AC3** — `playerCommandSchema` rejects a speed outside `SPEED_STEPS`, `step` with 2, a
      negative absolute position, a percent above 100 and a console line with control characters,
      and accepts valid commands (table test).
- [ ] **AC4** — `reducePlayerView(prev, event)` folds a sequence of `PlayerEvent`s into a
      `PlayerView` with `positionMs`, `durationMs`, `paused`, `seeking`, `ended`, `speed`, `map`,
      `pov` and `error`.
- [ ] **AC5** — `paused` in the view comes from `paused` events; the still-position inference
      applies only when an adapter reports no pause state.
- [ ] **AC6** — `ENGINE_MODE_CAPABILITIES`, `R1Q2_CAPABILITIES` and `INTEGRATED_CAPABILITIES`
      match the table in concept §9.2 (snapshot test).
- [ ] **AC7** — `unavailableReason(capabilities, feature)` returns an i18n key
      `replays.player.unavailable.<feature><Mode>` for a missing feature, and every such key exists
      in `src/renderer/src/modules/replays/locale/en.json` (test compares the key list).
- [ ] **AC8** — `player-api.ts` imports no node, DOM or electron module (`src/architecture.test.ts`
      green); `npm run typecheck` and `npm run lint` are green.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
