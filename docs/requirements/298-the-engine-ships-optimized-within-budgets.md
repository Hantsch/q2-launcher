---
id: 298
title: The engine ships as an optimized build within budgets
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

The integrated player runs smoothly and loads fast, so 60 fps playback and an export at least in
real time are possible (success criterion K6). The MashedD fork builds with `-O0` and
`-sASSERTIONS=2` ("Avoid optimizer/wasm validation issues"). This story makes the optimized
build the default and pins size and speed budgets.

It is planned for the export sprint rather than the final hardening sprint, because the export's
speed depends on it.

Context:

- [concept §8.1](../concepts/integrated-demo-player.md) (link flags), risk R1 in
  [concept §11](../concepts/integrated-demo-player.md), success criterion K6.
- [[281]] found the highest working optimization level (`spikes/281-engine-build/RESULT.md`). [[284]]
  measured fps, RAM and load time.
- Constraints:
  - Budgets are relative, because CI and developer machines differ. Size is absolute (e.g.
    ≤ 8 MB gzip, a placeholder until measured). Times are factors against a baseline on the same
    machine; `--baseline` writes it to `.engine-test/baseline.json`.
  - Per `/test-gates`, a hard time limit does not belong in the blocking PR lane. The budget runs
    in the engine lane (manual and in `verify:release`, see [[304]]) or in the manual perf lane
    (`perf.yml`).
  - Levers if `-O2` fails: `-O2` only for `src/refresh` and `src/client` (Meson
    `override_options`), `-fno-strict-aliasing`, a newer emsdk in the Dockerfile. Each change is
    recorded in the spike `RESULT.md`.
  - Keep `-sALLOW_MEMORY_GROWTH=1`. Set `-sINITIAL_MEMORY` to the need measured in [[284]], not
    512 MB as in the fork.
- Not in scope: packaging ([[316]]); moving the engine into a worker. That is only needed if load
  stalls break the budget (risk R8), and would be a new story.
- Expected manual residue: AC6 on the maintainer's reference PC, and whether 60 fps playback on a
  real GPU is stutter-free.
- Depends on: [[281]], [[284]].

## Acceptance Criteria

- [ ] **AC1** — `npm run engine:build` without options builds the release build with `-O2` (or the
      highest working level justified in `RESULT.md`), without `ASSERTIONS`, with
      `-sENVIRONMENT=web`; the build log shows the flags.
- [ ] **AC2** — `npm run engine:build -- --debug` builds `-O0 -g -sASSERTIONS=2` into
      `resources/engine/debug/`.
- [ ] **AC3** — The launcher loads the debug build only when `Q2L_ENGINE_DEBUG=1` is set.
- [ ] **AC4** — `npm run engine:budget` measures: - WASM size (gzip), - start-up time to `ready`, - load time of the shareware test demo to its first frame, - mean frame time over 30 s of playback under SwiftShader, - step time at 1080p.

      It writes `.engine-test/budget.json` and exits non-zero on any overrun of
      `engine/budgets.json`.

- [ ] **AC5** — The release build renders the same golden-frame hashes as the `-O0` build:
      `npm run test:engine -- --only=golden` passes with the release build.
- [ ] **AC6** — On the maintainer's reference PC, a 1080p60 export runs at least in real time. The
      value is recorded in `engine/budgets.json` as the reference.
- [ ] **AC7** — `engine/budgets.json` is committed, and each value's origin is documented.
- [ ] **AC8** — Concept §8.1 names the optimization level actually used.

## Open Questions

1. Which machine is the reference PC for the absolute export budget (AC6)?

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
