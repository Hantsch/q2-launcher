---
id: 297
title: The timeline steers both modes through the player API
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

In integrated mode I steer a demo with the same timeline as in engine mode, with an immediate
response, a smooth position readout and single-frame steps while paused. Whatever the chosen
mode cannot do stays visible, disabled, and says why.

Context:

- [concept §9.1](../concepts/integrated-demo-player.md),
  [concept §9.2](../concepts/integrated-demo-player.md) (capability table, i18n reasons),
  [concept §9.5](../concepts/integrated-demo-player.md) (switching modes).
- Today: `src/renderer/src/modules/replays/playback-store.ts` (`usePlaybackStore`,
  `PlaybackSession`, `PlaybackMode = 'preview' | 'cinema' | 'fullscreen'`). The existing
  `PlaybackMode` means the presentation, not engine/integrated; do not confuse it with
  `PlayerMode`.
- Also involved: `optimistic-timeline.ts` (optimistic projection for the 250 ms pushes),
  `components/DemoTimeline.tsx`, `components/TimelineComments.tsx`,
  `components/VolumeControl.tsx`, `components/ConsoleCommandField.tsx`, `useDemoPlay.ts`,
  `useDemoStop.ts`.
- Adapters from [[296]] and [[295]]; the mode setting from [[287]].
- Existing flows as the safety net: `replays-timeline`, `replays-timeline-optimistic`,
  `replays-timeline-burst`, `replays-volume`, `replays-console-command`, `replays-play-q2pro`,
  `replays-play-r1q2` (`scripts/flows/`).
- Constraints:
  - A factory `createDemoPlayer(mode)` lives in the replays module. The store holds exactly one
    `DemoPlayer` per session, subscribes to its events and reduces them to today's view state;
    `reducePlaybackView` stays for engine mode.
  - Controls read `capabilities` and show disabled with a reason text through a small shared
    `UnavailableHint` in the module, not in the shell.
  - The `.`/`,` shortcuts work only while the timeline bar has focus, so they cannot clash with
    list navigation.
  - New flow `scripts/flows/replays-integrated-timeline.mjs` uses the fake engine (test pattern,
    no game data) and is registered in `scripts/flows/areas.json`.
  - Order: first the store on `DemoPlayer` with `NativePlayer`, keeping the flows green, then the
    integrated branch.
- Not in scope: fullscreen and cinema in integrated mode ([[309]]), HUD options ([[310]]), any
  main-process change.
- Expected manual residue: with the real engine and an own demo, does seek/speed/step feel
  immediate and does the position readout run smoothly (sprint review)?
- Depends on: [[296]], [[295]].

## Acceptance Criteria

- [ ] **AC1** — In engine mode, play/pause, ±10 s, ±60 s, click-to-seek, speed and volume behave as
      before: the flows `replays-timeline`, `replays-timeline-optimistic` and `replays-volume`
      stay green.
- [ ] **AC2** — In integrated mode with the fake engine, a click at 50 % of the timeline shows the
      new position no later than the next fake frame.
- [ ] **AC3** — In integrated mode, `optimistic-timeline.ts` is not used; it applies to engine mode
      only.
- [ ] **AC4** — In integrated mode while paused, "Step forward" and "Step back" (or `.`/`,` with
      the timeline focused) send `{ kind: 'step', frames: ±1 }`, and the position moves by 100 ms.
- [ ] **AC5** — In engine mode the step buttons are visible and disabled, with the text of
      `replays.player.unavailable.stepEngineMode` shown under them (visible text, not only a
      tooltip).
- [ ] **AC6** — In an R1Q2 session the controls disabled by story 275 stay disabled, now derived
      from `capabilities`; the flow `replays-play-r1q2` stays green.
- [ ] **AC7** — In integrated mode, clicking a comment mark on the timeline jumps to
      `floor(atMs / 1000)` s, as today.
- [ ] **AC8** — `npm run ui:flow -- replays-integrated-timeline` passes and covers AC2, AC4, AC5
      and AC7.
- [ ] **AC9** — All existing replays flows stay green.
- [ ] **AC10** — The new i18n keys are in `src/renderer/src/modules/replays/locale/en.json`.
- [ ] **AC11** — `CHANGELOG.md` `## Unreleased` has one line for integrated mode: [[291]]'s line,
      extended, never a second line.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
