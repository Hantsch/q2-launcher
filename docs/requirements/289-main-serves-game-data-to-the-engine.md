---
id: 289
title: Main serves an installation's game data to the engine
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As a user in integrated mode I want the launcher to hand my installation's game data to the
engine, so that demos play with my own paks and mod data — without the renderer gaining access to
arbitrary files.

Context:

- [concept §8.5](../concepts/integrated-demo-player.md) (file system and game data), [concept §7](../concepts/integrated-demo-player.md) (responsibilities), risk R2; the RAM ceiling is
  an open point of the concept.
- Resolving demo id and installation as today: `src/main/modules/replays/demo-play.ts` (index
  lookup, `demoPlayEligibility`, containment, `SAFE_FILE_NAME`), staging of zip entries and foreign
  demos `demo-staging.ts`, zip reading `zip-demos.ts`, discovery `discovery.ts`
  (`effectiveWriteDirs`). Helpers `src/main/lib/fs-utils.ts` (`isFile`, `listDir`, `pathKey`).
- Protocol handler `src/main/lib/renderer-source.ts`, registration `src/main/index.ts`; contract
  `src/shared/modules/replays.ts`. `/electron-arch` (never trust renderer paths), `/typed-ipc`.
- New `src/main/modules/replays/integrated-session.ts` (manifest, token via `crypto.randomUUID()`).
  The protocol handler gets a narrow port (`resolveEngineData(token, index) → { path, size } |
null`) so `lib/` imports no module (`src/main/layering.test.ts`, `shell-layering.test.ts`).
  Streaming via `fs.createReadStream` → `Readable.toWeb` into a `Response` with `Content-Length`;
  no `Range` (MEMFS needs whole files). Zip entries reuse the `zip-demos.ts` read path.
- `docs/systems/replays-module.md` handler list gains `integrated.prepare`/`integrated.release`;
  no `CHANGELOG.md` line (part of [[287]]'s feature line).
- Not in scope: loading into the engine ([[291]]), renderer UI, a worker/WORKERFS (own story only
  if [[284]] recommends it).
- Depends on: [[288]]

## Acceptance Criteria

- [ ] **AC1** — `integrated.prepare({ demoId, installationId })` (zod, no paths) returns
      `{ token, gameDir, files: [{ index, vpath, size }], demo: { index, vpath, size } }` for a
      valid demo and installation.
- [ ] **AC2** — Every `vpath` is a relative Quake path (`baseq2/pak0.pak`,
      `<gamedir>/maps/x.bsp`, `<gamedir>/demos/_launcher/<safe-name>`), never an OS path.
- [ ] **AC3** — The manifest holds `pak*.pak`/`*.pkz` of `baseq2` and of the demo's game dir,
      plus loose files in `maps`, `textures`, `models`, `sprites`, `sound`, `pics`, `players`,
      `env` of the game dir, with case handled as discovery does (unit test with a fixture tree).
- [ ] **AC4** — When the sum of file sizes exceeds the limit (a constant, 1 GiB to start),
      `prepare` refuses with `replays.integrated.error.dataTooLarge` and `{ sizeMb }`.
- [ ] **AC5** — `/engine-data/<token>/<index>` with a valid token and index streams the file with 200.
- [ ] **AC6** — A zip-entry demo is served unpacked and a `.gz` demo unchanged, as today's staging
      does.
- [ ] **AC7** — An unknown, expired or foreign token, an index outside the manifest, or a path
      with `..` answers 404 without opening any file (unit test with a file-system spy).
- [ ] **AC8** — After `integrated.release({ token })` or a new `prepare`, the old token is invalid;
      at most one token is active.
- [ ] **AC9** — A manifest file replaced by a symlink to outside the installation after `prepare`
      answers 404 (real path re-checked against the installation root).
- [ ] **AC10** — The handler-coverage tests (`src/main/modules/handler-coverage.test.ts`,
      `src/renderer/src/modules/handler-coverage.test.ts`) and the layering tests are green.

## Open Questions

- Is 1 GiB of game data in renderer memory acceptable as the ceiling for integrated mode, beyond
  which the user is pointed to engine mode? (concept open point on RAM)

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
