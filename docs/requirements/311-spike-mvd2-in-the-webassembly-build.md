---
id: 311
title: 'Spike: MVD2 demos in the WebAssembly build'
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the maintainer I want to know whether, and at what cost, MVD2 demos can play in integrated
mode, so that [[319]] starts on facts or is dropped on purpose.

Spike, timebox 1.5 days: delivers `spikes/311-mvd2-wasm/RESULT.md` with measurements and a
recommendation, no production code.

Context:

- [concept §6](../concepts/integrated-demo-player.md) (checking the decisions against the code),
  risk R7 in [concept §11](../concepts/integrated-demo-player.md), open question F6.
- Q2PRO does not play MVD2 in the client:
  - `read_first_message` detects `MVD_MAGIC` and issues `mvdplay --replace @@ "/name"`.
  - That starts a local MVD server (`sv_running == ss_broadcast`, built-in `mvd_ge`) and the
    client connects over loopback.
  - `deathmatch 1` → `NET_Config(NET_SERVER)` opens UDP sockets.
  - Pause and seek are `mvdpause` / `mvdseek`.
  - Sources (upstream mirror): `src/client/demo.c`, `src/server/mvd/client.c`,
    `src/server/init.c` (around l.438/469), `src/common/net/net.c`. Loopback itself is in memory;
    only opening real sockets is the problem.
- Test demo: `docs/fixtures/demos/PFAU_20221127-053327_q2dm1.mvd2` (needs `q2dm1`, i.e. retail
  data — manual only). Without an MVD2 on a shareware map, the spike records one itself with Q2PRO
  (`mvdrecord` on a local server, map `base1`).
- Constraints: harness `spikes/311-mvd2-wasm/harness.mjs` follows `npm run engine:smoke` ([[284]]):
  its own Electron test window, loads the spike build from `spikes/311-mvd2-wasm/build/`
  (gitignored), writes screenshot and JSON. Spike patches live in `spikes/311-mvd2-wasm/patches/`,
  not in `engine/patches/` — [[319]] adopts them. First check whether `NET_Config(NET_SERVER)`
  fails on Emscripten's socket emulation or only warns, then stub. Position comes from
  `MVD_GetDemoStatus` (already used by `CL_DemoPos_m`).
- Not in scope: production code, UI changes, changes to `engine/patches/`, live MVD streams (GTV).
- Depends on: [[294]].

Expected manual residue: watching the fixture MVD2 (`q2dm1`, retail) integrated; the go/no-go is
confirmed in the sprint review.

## Acceptance Criteria

- [ ] **AC1** — A spike build with `mvd-client=true` and stubbed socket calls (`os_*`, or
      `NET_Config` in the web branch without real sockets) shows a picture of an MVD2 demo loaded
      with `demo`; the screenshot is `spikes/311-mvd2-wasm/results/frame.png`
      (`node spikes/311-mvd2-wasm/harness.mjs --demo <path.mvd2>` exits 0).
- [ ] **AC2** — `RESULT.md` answers, with a measurement or log as proof, whether `mvdseek` works
      forwards and backwards.
- [ ] **AC3** — `RESULT.md` answers, with proof, whether `mvdpause` works.
- [ ] **AC4** — `RESULT.md` answers, with proof, whether the POV can be switched (`follow` /
      `chase` through `CL_ForwardToServer`).
- [ ] **AC5** — `node spikes/311-mvd2-wasm/harness.mjs --determinism` writes `report.json` with two
      hash lists and `equal: true|false`, and `RESULT.md` states whether `step()` is
      deterministic for MVD2.
- [ ] **AC6** — `RESULT.md` lists the engine patches needed (files, approximate lines), the
      changes to `q2l_state_t` (position from `MVD_GetDemoStatus`, pause from `mvdpause`) and an
      estimate for [[319]] in story points.
- [ ] **AC7** — `RESULT.md` has a line starting with `Go` or `No-Go` for [[319]], with the reason
      (`grep -E "^(Go|No-Go)" spikes/311-mvd2-wasm/RESULT.md` matches). On no-go the reason goes
      into the concept's open point F6 and MVD2 stays in engine mode.
- [ ] **AC8** — `git status --short engine/` shows no change.

## Open Questions

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
