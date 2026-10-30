---
id: 304
title: Golden frames guard the engine's picture
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

One command checks that the real WebAssembly engine renders the test demos pixel-for-pixel as last
approved. Engine patches, emsdk updates and launcher changes then cannot slip in picture errors or
nondeterminism unnoticed.

Context:

- [concept §13](../concepts/integrated-demo-player.md): the "engine" lane, golden frames through
  the step mode, a two-run self-check, SwiftShader. Concept open point F10.
- CLAUDE.md "Test lanes": this story proposes a new **engine** row (local/manual plus
  `verify:release`). The maintainer confirms it, because lane policy is theirs. Read
  `/test-gates` first.
- Test data from [[283]] (`npm run engine:data`, `tests/engine/demos/`), step mode from [[300]],
  prior art in the [[285]] harness. Release prep: `scripts/verify-release.mjs`
  (`npm run verify:release`).
- Constraints:
  - Script `scripts/engine/test-engine.mjs`, driven through Playwright `_electron` like
    `scripts/lib/harness.mjs`, loading the engine in a small test page.
  - After each `step`, `gl.readPixels` (RGBA) reads the frame in the same task and the hash covers
    the raw bytes; PNGs are produced only on a mismatch.
  - Golden format: `{ engineCommit, emsdk, renderer: 'swiftshader', width, height, fps, seed,
frames: { "<index>": "<sha256>" } }`.
  - `.engine-test/` goes into `.gitignore`, and `package.json` gets
    `"test:engine": "node scripts/engine/test-engine.mjs"`.
  - The lane row is proposed for the maintainer, never changed unilaterally.
- Not in scope: A/V sync ([[307]]), performance budgets ([[298]]), any GitHub CI job.
- Expected manual residue: look at the PNGs of the first golden frames and approve them (a
  maintainer commit).
- Depends on: [[300]], [[283]].

## Acceptance Criteria

- [ ] **AC1** — With the engine artefact and the shareware cache present, `npm run test:engine`
      starts a headless Electron with SwiftShader (`--use-angle=swiftshader`,
      `--enable-unsafe-swiftshader`).
- [ ] **AC2** — The lane renders every test demo at 640×480, 30 fps, seed 1, flares off.
- [ ] **AC3** — The lane compares the SHA-256 of every 15th frame with
      `tests/engine/golden/<demo>.swiftshader.json` and exits 0 with
      "golden: N/N equal, self-check: N/N equal".
- [ ] **AC4** — A differing frame makes the lane exit non-zero.
- [ ] **AC5** — For a differing frame, the lane writes to `.engine-test/<demo>/` the actual PNG,
      the expected PNG (when available) and a diff image.
- [ ] **AC6** — For a differing frame, the log names the demo, the frame index and both hashes.
      `npm run test:engine -- --demo base1-short --break-frame 30` demonstrates this.
- [ ] **AC7** — Every run renders each demo twice in the same process and compares both runs. A
      difference is its own named failure, "nondeterministic frame".
- [ ] **AC8** — `npm run test:engine -- --update` rewrites the golden files.
- [ ] **AC9** — Rewritten golden files carry the engine commit, the emsdk version and the date in
      the JSON header.
- [ ] **AC10** — Without `--update`, the lane never changes a golden file.
- [ ] **AC11** — A missing shareware cache stops the lane non-zero with a pointer to
      `npm run engine:data`; it never skips silently.
- [ ] **AC12** — A missing engine artefact stops the lane non-zero with a pointer to
      `npm run engine:build`; it never skips silently.
- [ ] **AC13** — `npm run verify:release` runs `test:engine` as one of its steps.
- [ ] **AC14** — In `verify:release`, missing data is an error, not a skip.
- [ ] **AC15** — `npm test` (pr-unit) runs no engine-lane tests.
- [ ] **AC16** — The proposed lane row for `CLAUDE.md` is handed to the maintainer.

## Open Questions

1. Does the maintainer accept the new "engine" row in `CLAUDE.md` "Test lanes" (concept F10)?
   Including it in `verify:release` makes it block releases.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
