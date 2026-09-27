---
id: 137
title: an mvd2 tells its map and players
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Some servers record every match server-side as `.mvd2` — Q2PRO's multi-view demo, containing all
players rather than one POV (AQ2-TNG with `use_mvd2`, Q2PRO `sv_mvd_autorecord`). Those demos
belong in the same library, with the same facts as a `.dm2` ([[136]]): map, level name, mod and
players (concept `docs/concepts/demo-browser.md` §6.4, DEMO-5).

The format differs (§6.4): `MVD2` magic, then `[uint16 LE length][data]` blocks with 0 as the end
marker; the header is `mvd_serverdata` (protocol 37, version 2009–2012, game dir) followed by
configstrings. **aq2replay** (MIT) is the porting reference for MVD2. Same rules as [[136]]: pure
code, header only, typed failure instead of a throw.

## Acceptance Criteria

- [ ] **AC1** — For an `.mvd2`, the parser returns map, level name, game dir and every player name
      from the configstrings, in the same result shape [[136]] returns.
- [ ] **AC2** — An `.mvd2` has no POV; the result says so explicitly rather than inventing one.
- [ ] **AC3** — An `.mvd2.gz` yields exactly the same facts as the same demo uncompressed.
- [ ] **AC4** — The result records the MVD protocol version, and a version outside 2009–2012 returns
      a typed "unparsable" result naming the version.
- [ ] **AC5** — Header-only and bounded, like [[136]] AC8; garbage or truncation returns "unparsable"
      with a reason, never a throw.
- [ ] **AC6** — Format is detected from the content (the `MVD2` magic), not only from the extension:
      a mis-named file is parsed as what it is.

## Open Questions

- [ ] **Q1 — Configstring layout** for MVD protocol 37 — same indices as protocol 34, or its own?
- [ ] **Q2 — Real sample** — same question as [[136]] Q1, for MVD2.

## Plan

<!-- Filled by /refine 137, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 137. -->

## Model Hints

<!-- Filled by /refine 137. -->

## Acceptance Tests

<!-- Filled by /refine 137. -->

## Done

<!-- Filled by /build 137. -->
