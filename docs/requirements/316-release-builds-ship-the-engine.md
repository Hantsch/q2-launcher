---
id: 316
title: Release builds ship the engine
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user I want the installed launcher (Windows installer, Linux AppImage) to bring the
integrated player with it, so that it works without a developer setup.

Context:

- Source layout and build in [concept §8.1](../concepts/integrated-demo-player.md), delivery in
  [concept §8.6](../concepts/integrated-demo-player.md), open question F3 (artefacts are not
  checked in; the release job builds them).
- `electron-builder.yml`: `extraResources` (e.g. `resources/geoip` → `geoip`) and the per-platform
  `resources/bin` filters; `electron-builder.smoke.yml` is the smoke variant.
- Runtime resource resolution: `src/main/lib/resource-path.ts` (`resolveResourcePath`); the
  engine protocol handler from [[288]] must read `process.resourcesPath/engine/` in the package.
- `.github/workflows/release.yml`: jobs `plan` (ci-guard), `build-linux` (ubuntu-latest), `release`
  (windows-latest). `scripts/verify-release.mjs` is the local release gate (host + act).
  CLAUDE.md: a release needs a green `ci` run on its SHA.
- Constraints: `extraResources: - from: resources/engine, to: engine, filter: ['q2pro.js',
'q2pro.wasm', 'SOURCE.txt']`, no debug build in the package. A pre-check
  `scripts/engine/assert-artifacts.mjs` runs before `electron-builder` in the `package:*` scripts
  (like `fetch:7za`). The release job uses `actions/upload-artifact` / `download-artifact`; the
  Docker image is pinned by digest ([[281]]); optional cache for `.engine-build/` keyed by commit.
  `scripts/release.mjs` attaches the source tarball at `gh release create`; it is built by
  `scripts/engine/source-tarball.mjs` reproducibly (fixed mtime, sorted entries). The new
  `build-engine` job blocks, because both packages need it.
- Pushing and releasing is the maintainer's call (org rule); the story ends with a green local
  `verify:release` and act run, the workflow changed but not pushed.
- Not in scope: licence texts and About entries ([[317]]); ffmpeg in the package ([[313]], only
  after legal clarification); macOS.
- Depends on: [[288]], [[298]].

Expected manual residue: the installer on a clean Windows machine and the AppImage on a Linux
desktop — play a demo integrated, export briefly.

## Acceptance Criteria

- [ ] **AC1** — After `npm run engine:build && npm run package:dir`,
      `release/<version>/win-unpacked/resources/engine/q2pro.wasm` exists next to `app.asar`, not
      inside it.
- [ ] **AC2** — The unpacked package loads the engine in integrated mode through
      `q2launcher://engine/`; the packaged smoke (`npm run package:dir:smoke`) reports the engine
      `ready` event.
- [ ] **AC3** — `npm run package:*` without engine artefacts stops with the message
      "run npm run engine:build"; a package without the engine is never produced silently.
- [ ] **AC4** — A release-workflow job `build-engine` (Linux, Docker) builds the engine once with
      `npm run engine:build` and uploads `q2pro.js`, `q2pro.wasm` and `engine/SOURCE.txt`
      (upstream commit, patch hashes, emsdk digest) as an artefact
      (`act workflow_dispatch -W .github/workflows/release.yml -j build-engine` green).
- [ ] **AC5** — `build-linux` and `release` download that artefact instead of building again, and
      the SHA-256 of the engine files is the same in both packages.
- [ ] **AC6** — `npm run verify:release` runs the engine build and `npm run test:engine` (golden
      frames, A/V sync); a red engine test makes the gate red.
- [ ] **AC7** — A release carries the source tarball `q2pro-engine-source-<version>.tar.gz`
      (pinned upstream state, `engine/patches/`, build scripts, Dockerfile) as an asset — the basis
      for L2 in [[317]].
- [ ] **AC8** — The tarball is reproducible: two runs give the same SHA-256
      (`npx vitest run scripts/engine/source-tarball.test.mjs`).
- [ ] **AC9** — The package size before and after is recorded in the sprint review against the
      budget from [[298]].
- [ ] **AC10** — `docs/systems/replays-module.md` names the engine build under "External inputs".

## Open Questions

- F10 / lane policy: AC6 makes the engine lane block releases. Does the maintainer agree to that
  change of the CLAUDE.md test lanes?

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
