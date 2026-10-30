---
id: 281
title: The engine builds reproducibly as WebAssembly
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want to build the Q2PRO engine as WebAssembly with one command,
reproducibly, so that every later story of the integrated demo player builds on the same pinned
engine artefact and nobody needs a local Emscripten installation.

The build also settles which engine source the port is based on. Upstream `skullernet/q2pro` is
gone; the MashedD fork has a working Emscripten target, and the `q2pro/q2pro` mirror is the
reference for upstream behaviour.

Context:

- [concept §8.1](../concepts/integrated-demo-player.md) (source base and build), [concept §8.7](../concepts/integrated-demo-player.md) (switched-off parts), risks R1 (`-O2`
  fails WASM validation) and R11 (base fork) in [concept §11](../concepts/integrated-demo-player.md).
- Existing web target in MashedD/q2pro @ `3139866`: `build-web.sh`, `cross-web.txt`, the `web`
  branch of `meson.build`, `src/unix/video/emscripten.c`. Read-only clones under
  `vendor/q2pro-mashed/` and `vendor/q2pro/` (not committed).
- Docker is already a prerequisite in this repo (act, `verify:release`, `.claude/ai-scrum.md`);
  `scripts/fetch-7za.mjs` is the style reference for fetch/build scripts.
- Layout: `engine/UPSTREAM` (repo + commit), `engine/patches/*.patch`, `engine/cross/emscripten.ini`,
  `engine/docker/Dockerfile` (pinned `emscripten/emsdk` image, plus meson and ninja),
  `scripts/engine/build.mjs`, `package.json` script `engine:build`. `.engine-build/` and
  `resources/engine/*.js|*.wasm` are gitignored; the engine source itself is never committed.
- First patches: web branch of `meson.build` without `q2proded`, without the game library and
  without `MAIN_MODULE`; `software-sound` allowed for `web` (`s_enable 0` until [[286]]); no
  `dependency('threads')` on web; link flags per concept §8.1 (`MODULARIZE`, `EXPORT_ES6`,
  `ENVIRONMENT=web`).
- Spike part (timebox 1 day of the 2-day story): try `-O2` first; on validation errors narrow down
  via `-O1` and flag variants.
- Not in scope: loading in Electron ([[284]]), audio driver ([[286]]), C bridge ([[294]]), a
  release/CI job ([[316]]), any change under `src/`.
- Depends on: —

## Acceptance Criteria

- [ ] **AC1** — On a fresh clone with Docker, `npm run engine:build` exits 0 and writes
      `resources/engine/q2pro.js` and `resources/engine/q2pro.wasm`.
- [ ] **AC2** — The build checks out exactly the commit named in `engine/UPSTREAM`
      (`git rev-parse HEAD` in the build directory equals it).
- [ ] **AC3** — `engine/patches/*.patch` are applied in order; a patch that does not apply ends
      the build with a non-zero exit code.
- [ ] **AC4** — With the Docker image pinned by tag/digest, two consecutive builds produce the same
      SHA-256 for `q2pro.wasm`.
- [ ] **AC5** — `npm run engine:build -- --check-config` shows `libcurl=disabled` and
      `openal=disabled` and lists no `q2proded` and no `game*` target.
- [ ] **AC6** — The built artefact contains no dedicated server, no game library, no curl and no
      OpenAL symbols (checked by a script over `wasm-objdump -x`).
- [ ] **AC7** — `npm run engine:build -- --opt=O0|O1|O2` selects the optimisation level.
- [ ] **AC8** — `spikes/281-engine-build/RESULT.md` records whether `-O2` (without `ASSERTIONS`)
      builds and validates; if not, the error, the smallest working level and a recommendation.
- [ ] **AC9** — `RESULT.md` gives a reasoned recommendation for the base (MashedD fork vs.
      upstream mirror) with the patch-series size in lines for both, plus build time and WASM
      size per `-O` level.
- [ ] **AC10** — After a build, `git status --short` shows no file under `resources/engine/` or
      `.engine-build/`; `npm run lint` and `npm run typecheck` are green.

## Open Questions

- Which engine base does the project adopt — the MashedD fork (active, has the web target) or the
  upstream mirror — and are patches offered back to MashedD? (decided from AC9's recommendation)

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
