---
id: 136
title: a dm2 tells its map and players
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A demo file knows more than its name: which map was played, in which mod, who was on the server and
who recorded it. The demo browser shows those facts for every demo without the user typing anything
(concept `docs/concepts/demo-browser.md` §6, DEMO-5). This story is the header parser for `.dm2`
files — the client-side, single-POV format both r1q2 and Q2PRO write.

Research already fixed what the parser needs (§6.1–6.2): a `.dm2` is `[int32 LE length][payload]`
blocks ending in `0xFFFFFFFF`; the first block starts with `svc_serverdata` (protocol, game dir,
playernum, level name) followed by configstrings. Demos on disk are almost always protocol 34, with
Q2PRO's 3434–3436 "extended limits" layout as the one known variant. `record -z` writes
`.dm2.gz`. The parser only reads the header — not frames, not entity state.

The parser is pure TypeScript (gzip through `node:zlib` behind a thin main-side wrapper), unit
testable without an installation. **packetflinger/libq2** (Apache-2.0) is the porting reference;
nothing GPL is copied (§4). The user has no sample demo yet, so the fixtures are built by a
test-side writer from the documented format — refine decides whether a real demo is required
before done (Q1).

## Acceptance Criteria

- [ ] **AC1** — For a protocol-34 `.dm2`, the parser returns the map from configstring
      `CS_MODELS+1` (`maps/q2dm1.bsp` → `q2dm1`).
- [ ] **AC2** — It returns the level name from `CS_NAME`.
- [ ] **AC3** — It returns the game dir from `svc_serverdata`; an empty game dir is reported as
      `baseq2`.
- [ ] **AC4** — It returns the recording player (POV) from `CS_PLAYERSKINS + playernum`, up to the
      first `\`.
- [ ] **AC5** — It returns every player name from every non-empty `CS_PLAYERSKINS` slot.
- [ ] **AC6** — A protocol 3434–3436 demo yields the same facts through that variant's configstring
      layout, and the result records which protocol the demo uses (needed by [[161]]).
- [ ] **AC7** — A `.dm2.gz` yields exactly the same facts as the same demo uncompressed.
- [ ] **AC8** — The parser stops after the header: it reads a bounded number of bytes regardless of
      file size, and the bound is asserted by a test.
- [ ] **AC9** — A truncated, empty, garbage or unknown-protocol file returns a typed "unparsable"
      result with a reason — it never throws out of the parser and never loops; [[145]] shows it.

## Open Questions

- [ ] **Q1 — Real sample before done?** Synthetic fixtures prove the format as documented; is one
      real protocol-34 demo (and one 343x) required as a fixture before this is done, and whose
      licence covers it (§17.3)?
- [ ] **Q2 — 343x layout** — which Q2PRO constants (`CS_MODELS`, `CS_PLAYERSKINS`, …) apply in the
      extended layout; confirm from source before planning.
- [ ] **Q3 — Oversized packets** (`record -e` / `cl_demomsglen`, §6.1) — does the header parser
      flag them so [[161]] can disable r1q2 playback, or is that detected elsewhere?

## Plan

<!-- Filled by /refine 136, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 136. -->

## Model Hints

<!-- Filled by /refine 136. -->

## Acceptance Tests

<!-- Filled by /refine 136. -->

## Done

<!-- Filled by /build 136. -->
