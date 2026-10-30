---
id: 283
title: 'Test data: a shareware data cache and test demos'
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

As the launcher's developer I want one command that provides reproducible game data on any
machine, plus short test demos of our own, so that spikes, golden frames and A/V-sync checks run
without a retail installation and without committing game data.

Context:

- [concept §13](../concepts/integrated-demo-player.md) (test strategy, test demos), risk R13, licence point L8 in [concept §12](../concepts/integrated-demo-player.md).
- The bootstrap already knows the shareware archive: `src/main/modules/downloads/bootstrap/assemble.ts`
  (`q2-314-demo-x86.exe`), unpacked with 7-Zip; fetch style follows `scripts/fetch-7za.mjs`.
- `docs/fixtures/demos/*` need retail or mod maps (assumption) and do not suit automated tests.
- Demo writers exist: `src/shared/demos/dm2-writer.ts`, `dm2-frames-writer.ts`; the header reader
  is `src/shared/demos/demo-header.ts`.
- Script `scripts/engine/fetch-data.mjs`, `package.json` script `engine:data`; URL and hash in
  `tests/engine/data.lock.json`; unpacking with the launcher's `7za` (`resources/bin/`,
  `npm run fetch:7za`). Test demos recorded with native Q2PRO on the shareware data (`record`),
  `.gz` via `gzip -9`. The header test reads repo files only, no network (`/test-gates`).
- Not in scope: golden frames ([[304]]), A/V analysis ([[307]]), shareware data in the repo,
  network access in `npm test`.
- Depends on: —

Expected manual residue: watch the test demos once in native Q2PRO — map, movement and shots as
described in the README.

## Acceptance Criteria

- [ ] **AC1** — On a machine without a Quake II installation, `npm run engine:data` exits 0,
      writes `baseq2/pak0.pak` into a cache outside the repo (`%LOCALAPPDATA%/q2l-engine-test` or
      `~/.cache/q2l-engine-test`, overridable via `Q2L_ENGINE_DATA`) and prints the cache path as
      its last line.
- [ ] **AC2** — When the archive's or `pak0.pak`'s SHA-256 differs from
      `tests/engine/data.lock.json`, the command exits non-zero with a message naming the hash
      mismatch (`Q2L_ENGINE_DATA_LOCK=tests/engine/data.lock.broken.json npm run engine:data`).
- [ ] **AC3** — A second call with a valid cache downloads nothing, prints `cached` and finishes
      in under 2 s.
- [ ] **AC4** — `Q2L_ENGINE_DATA` pointing inside the repo folder is refused.
- [ ] **AC5** — `tests/engine/demos/` holds `move-fire.dm2` (20–40 s on a shareware map such as
      `base1`, movement and weapon fire) and `move-fire.dm2.gz` (gzip of the same file);
      `pause-section.dm2` is optional.
- [ ] **AC6** — `tests/engine/demos/README.md` names the recording commands, map, length and the
      frames with weapon fire.
- [ ] **AC7** — A unit test reads map name and protocol of each test demo through
      `src/shared/demos/demo-header.ts` without errors (`npx vitest run tests/engine/demos`).
- [ ] **AC8** — `git ls-files "*.pak" "*.pkz"` prints nothing; `npm run lint` and
      `npm run typecheck` are green.

## Open Questions

- Does the shareware licence cover automated test runs in CI (data downloaded at test time, never
  redistributed)? (licence point L8, for the legal clarification)

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
