---
id: 315
title: I see the map, the POV player and HUD values while a demo plays
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a viewer I want to see during playback which map I am on and whose view I am watching, with
health, armor, ammo and frags, so that I can follow a demo even with the engine's HUD off.

Context:

- The events `map`, `pov`, `hud` in [concept §9.1](../concepts/integrated-demo-player.md); the
  `q2l_state_t` fields `map`, `pov_client`, `pov_name`, `stats[4]` in
  [concept §9.3](../concepts/integrated-demo-player.md).
- `IntegratedPlayer` ([[296]]) emits these events. Engine mode does not have them: the
  `$cl_demopos` poll only gives the position (`POLL_LINE` in
  `src/main/modules/replays/playback-channel/protocol.ts`).
- Detail area: `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx`,
  `DemoPlayersPanel.tsx`.
- Constraints: its own small component `components/LivePlayerInfo.tsx` in the replays module;
  throttling through an injectable clock (`/test-gates`: no real timers in unit tests); colours
  and contrast through the existing design tokens (`/design-tokens`), no hex values.
- Not in scope: switching the POV (MVD2, [[319]]); a scoreboard or layout parsing.
- Depends on: [[296]].

## Acceptance Criteria

- [ ] **AC1** — In integrated mode, when the adapter reports `map` and `pov`, the timeline bar
      shows "Map: <map> · POV: <name>".
- [ ] **AC2** — On `hud` events a compact line shows health, armor, ammo and frags.
- [ ] **AC3** — That line updates at most 4 times per second (unit test with an injected clock).
- [ ] **AC4** — In engine mode, the same place shows the visible text "Live player info is only
      available in integrated mode." (an i18n key) instead of being silently empty.
- [ ] **AC5** — When the POV changes (chase demo), the player panel highlights the matching
      entry if the name is listed there.
- [ ] **AC6** — `npx vitest run src/renderer/src/modules/replays/components/LivePlayerInfo.test.tsx`
      covers AC1, AC2 and AC5; `npm run ui:flow -- replays-integrated-timeline`, extended, covers
      AC1 and AC4.
- [ ] **AC7** — `npm run ui:verify` reports no new axe violations.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
