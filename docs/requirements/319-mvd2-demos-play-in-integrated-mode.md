---
id: 319
title: MVD2 demos play in integrated mode
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user I want to play MVD2 demos (multiview, e.g. from OpenTDM servers) in integrated mode
too, and switch the player there, so that I do not have to switch to engine mode for MVD2.

**Runs only on a go from [[311]]:** `spikes/311-mvd2-wasm/RESULT.md` must end with **Go**. On
**No-Go** this story is dropped and MVD2 stays in engine mode with the visible reason from
[[291]]. Its size (5 points) is re-estimated from that result.

Context:

- Capabilities per mode (`formats`) in [concept §9.2](../concepts/integrated-demo-player.md),
  eligibility per mode in [concept §9.5](../concepts/integrated-demo-player.md), the C bridge in
  [concept §9.3](../concepts/integrated-demo-player.md), risk R7 in
  [concept §11](../concepts/integrated-demo-player.md).
- Adopts the spike patches from `spikes/311-mvd2-wasm/patches/` into `engine/patches/`, in order.
- Existing seek abstraction: `src/shared/replays/demo-control.ts` (`demoSeekCommand` per
  `DemoFormat`); the native path stays unchanged. Existing engine-mode flow:
  `scripts/flows/replays-play-mvd2.mjs`.
- Constraints: `q2l_state_t` takes the MVD position from `MVD_GetDemoStatus` and the MVD pause
  state (per the spike result); the struct version goes up and `IntegratedPlayer` checks it. The
  launcher has no MVD2 roster today (`docs/systems/replays-module.md`, Limitations), so the POV
  list comes live from `cl.clientinfo[]` through the state struct (bounded, e.g. 32 names).
  `demoPlayEligibility` admits MVD2 in integrated mode once the engine artefact reports it
  (`ready.capabilities.formats`), not hard-coded.
- Not in scope: live GTV streams, network; roster detection for MVD2 in the index.
- The `CHANGELOG.md` change is folded into the integrated-mode entry ("… including MVD2 demos").
- Depends on: [[311]].

Expected manual residue: watching the fixture MVD2 (`q2dm1`, retail) integrated, switching player,
seeking.

## Acceptance Criteria

- [ ] **AC1** — `npm run engine:build` exits 0 with the adopted MVD patches.
- [ ] **AC2** — An MVD2 demo played in integrated mode plays in the canvas, and
      `capabilities.formats` contains `mvd2` (`npm run ui:flow -- replays-play-mvd2-integrated`,
      fake engine).
- [ ] **AC3** — The earlier hint "MVD2 demos play in engine mode for now" no longer shows.
- [ ] **AC4** — Pause, seek (±10 s, click seek) and speed act on a running MVD2 within the next
      frame.
- [ ] **AC5** — Internally `mvdpause` / `mvdseek` run through the bridge (`q2l_set_paused` /
      `q2l_seek` recognise the format), never as a free console line from JS.
- [ ] **AC6** — Choosing a player from the list makes the camera follow them, and the `pov`
      event reports name and `clientNum`.
- [ ] **AC7** — `player-api.ts` has the command `{ kind: 'setPov'; clientNum: number }`
      (`npx vitest run src/shared/replays/player-api.test.ts`), and `setPov` reaches the bridge
      (`npx vitest run src/renderer/src/modules/replays/integrated/integrated-player.test.ts`).
- [ ] **AC8** — In engine mode the POV capability is `false` and the control is visibly disabled
      with its reason.
- [ ] **AC9** — Exporting an MVD2 meets the same golden-frame and A/V criteria as `.dm2` (engine
      lane with an MVD2 test demo on a shareware map; `npm run test:engine -- --only=mvd2`).
- [ ] **AC10** — The web build opens no real sockets: the stub counts calls and expects 0 real
      opens.
- [ ] **AC11** — Engine-mode MVD2 is unchanged (`npm run ui:flow -- replays-play-mvd2` green).
- [ ] **AC12** — The Limitations section of `docs/systems/replays-module.md` is updated.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
