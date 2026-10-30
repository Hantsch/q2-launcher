---
id: 296
title: Integrated playback runs behind the player API
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

The demo UI reaches the WebAssembly engine only through the `DemoPlayer` interface. Timeline,
store and export send typed commands and receive typed events in integrated mode, and never know
about `q2l_*` calls or console syntax.

Context:

- [concept §9.1](../concepts/integrated-demo-player.md) (types),
  [concept §9.3](../concepts/integrated-demo-player.md) (exports, `q2l_state_t`, "state struct
  instead of callbacks"), [concept §7](../concepts/integrated-demo-player.md) (architecture).
- Contract from [[292]]: `src/shared/replays/player-api.ts` (`PlayerCommand`, `PlayerEvent`,
  `PlayerCapabilities`, `DemoPlayer`).
- Exports and state layout from [[294]]. Engine host and canvas from [[290]]/[[291]] under
  `src/renderer/src/modules/replays/`.
- The duration comes from the launcher's index (`knownDurationMs`, `PlaybackSample` in
  `src/shared/replays/timeline.ts`), not from the engine, which knows it only at the end.
- Free console lines are checked like today with `checkLine`, which lives in main
  (`src/main/modules/replays/playback-channel/protocol.ts`). It is pure; [[292]] moves it to
  `src/shared/` so the renderer can use it.
- Constraints:
  - Files: `src/renderer/src/modules/replays/integrated/integrated-player.ts` and the fake engine
    module `integrated/fake-engine.ts`, used by unit tests and ui:flows.
  - A small reader (`readState(heap, ptr)`) uses the fixed offsets from [[294]]. A unit test
    checks them against `q2l_state_layout.json`, so a C ↔ TS layout break is red.
  - The adapter keeps the previous snapshot and emits `map`, `pov` and `hud` only on change.
    `position` is throttled; the time source is injectable (no `Date.now()` in tests,
    `/test-gates`).
  - `step` (`frames: ±1`) is accepted only while paused, otherwise
    `fail('replays.player.error.stepWhilePlaying')`.
  - No imports from other modules, the shell untouched (`src/architecture.test.ts`).
- Not in scope: rebuilding store and timeline ([[297]]), capture and export ([[300]]), HUD UI
  ([[310]]). No change to the C bridge beyond bug fixes in [[294]]'s area.
- Depends on: [[292]], [[294]].

## Acceptance Criteria

- [ ] **AC1** — With the fake engine module,
      `send({ kind: 'seek', target: { kind: 'absolute', ms: 65000 } })` calls exactly
      `q2l_seek(1, 65000)` and returns `ok`.
- [ ] **AC2** — When the fake engine's `paused` changes from 0 to 1 between frames, the adapter
      emits exactly one `{ kind: 'paused', paused: true }`.
- [ ] **AC3** — In a following frame with an unchanged state, the adapter emits no event.
- [ ] **AC4** — With a new `position_ms` on each of 60 frames within one second, the adapter emits
      at most 11 `position` events (about 10 Hz).
- [ ] **AC5** — In that run, `latestPosition()` returns the value of the last frame.
- [ ] **AC6** — When `error_seq` increases with an error text, the adapter emits
      `{ kind: 'error', key: 'replays.integrated.error.engine', params: { detail } }`, never prose as
      the key.
- [ ] **AC7** — A `console` command containing a control character returns
      `fail('replays.playback.error.invalidCommand')`, and `q2l_console` is not called.
- [ ] **AC8** — The adapter's capabilities are `step`, `export`, `hud`, `seek`, `speed` and
      `volume` true, with `formats` `['dm2']` (MVD2 only with [[319]]).
- [ ] **AC9** — After `dispose()` the rAF loop has stopped and the last event is
      `{ kind: 'ended' }`; nothing follows it.
- [ ] **AC10** — A layout test compares the TS offsets with `q2l_state_layout.json` and fails on a
      mismatch.
- [ ] **AC11** — `npx vitest run src/renderer/src/modules/replays/integrated` and
      `npx vitest run src/architecture.test.ts` pass.
- [ ] **AC12** — The new i18n keys are in `src/renderer/src/modules/replays/locale/en.json`.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
