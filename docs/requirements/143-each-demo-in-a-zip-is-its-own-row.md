---
id: 143
title: each demo in a zip is its own row
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Tournament demo packs arrive as a `.zip`. The user should not have to unpack them to see what is
inside: every demo entry in the archive appears as its own row, with the same parsed facts as a
loose file, and the archive itself stays exactly as it is (concept
`docs/concepts/demo-browser.md` §2, §3, DEMO-2).

Archives are **read-only** by decision: no sidecar, no rename for an entry ([[158]] shows those
actions disabled with the reason). Playing an entry extracts it temporarily ([[160]]). The zip
reader runs in main. The repo has no zip library today; the downloads module ships a `7za` binary,
which may or may not be the right tool for listing and reading entries (Q1).

## Acceptance Criteria

- [ ] **AC1** — A `.zip` in any scanned source contributes one row per `.dm2`, `.mvd2`, `.dm2.gz`
      and `.mvd2.gz` entry; other entries are ignored.
- [ ] **AC2** — Each entry row is parsed like a loose file ([[136]]–[[139]]) and shows its source as
      the archive plus the entry's path inside it.
- [ ] **AC3** — Each entry row carries an "archive entry" marker ([[150]]).
- [ ] **AC4** — The archive file is never modified by scanning (size, modification time and content
      unchanged, asserted by a test).
- [ ] **AC5** — Reading is bounded: an entry whose uncompressed size exceeds the cap decided in Q2,
      or an archive that fails to open, is reported as unparsable/source error — never an
      unbounded read into memory.
- [ ] **AC6** — Zips nested inside zips are not opened.

## Open Questions

- [ ] **Q1 — Zip reader** — reuse the bundled `7za`, or add a JS zip dependency (licence, size)?
- [ ] **Q2 — Size cap** per entry, as zip-bomb protection.

## Plan

<!-- Filled by /refine 143, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 143. -->

## Model Hints

<!-- Filled by /refine 143. -->

## Acceptance Tests

<!-- Filled by /refine 143. -->

## Done

<!-- Filled by /build 143. -->
