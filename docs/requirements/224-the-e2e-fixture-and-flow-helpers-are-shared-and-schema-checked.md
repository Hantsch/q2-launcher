---
id: 224
title: the e2e fixture and flow helpers are shared and schema-checked
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want the seeded `state.json` every flow depends on to be proven valid against
the real schema on every test run, and the helpers flows share to live in one place, so that a
schema or default change cannot silently desynchronise 136 flows and a protocol or test-id change
is one edit instead of fifteen to twenty-two.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F22, F52):
`scripts/lib/fixture.mjs` is 5,737 lines with 231 exports and 97 "Mirrors src/…" comments;
`STATE_SCHEMA_VERSION = 1` (comment: "currently 2") while src is at 5; `DEFAULT_SETTINGS`,
`WINDOW_STATE_FILE`, failure shapes and the controls seed are retyped by hand; variant dispatch
is a 20-branch if-chain; nothing validates a seeded file against the real zod schema — the
fixture relies on four migrations running silently on every launch. Across `scripts/flows`,
`buildStatusReplyBytes`/`buildInfoReplyBytes`/`bindResponder`/`closeResponder`/`decodeQueryKind`
appear in 15 servers flows (14 identical, 1 drifted), `waitForScan` in 22, `waitForDemosScanToFinish`
in 14 files in four variants, `rowFor` in 10, `libraryCard` in 7 — 595 module-level helpers in
total.

Depends on story 223 (quarantine and CI) so a fixture change is gated.

## Acceptance Criteria

- [ ] **AC1** — `src/main/services/fixture-parity.test.ts` writes every fixture variant into a
      temp dir and loads it through the real `StateStore`, asserting zero migration warnings and
      zero dropped rows; it fails when `STATE_SCHEMA_VERSION` or a default drifts.
- [ ] **AC2** — Plain literals both sides need (`STATE_SCHEMA_VERSION`, `DEFAULT_SETTINGS`, file
      names) come from one importable source (`src/shared/fixture-constants.json` or a tiny
      shared module) instead of being retyped.
- [ ] **AC3** — `fixture.mjs` is a facade over `scripts/lib/fixture/{core,installations,servers,
      replays,news,controls}.mjs` with a `VARIANTS: Record<name, writer>` map; no file exceeds
      1,500 lines.
- [ ] **AC4** — UDP responder builders live in `scripts/lib/servers-stub.mjs`, scan-wait helpers
      in `scripts/lib/servers-flow.mjs`, the reconciled `waitForDemosScanToFinish` in
      `scripts/lib/replays-copy-in.mjs`; local copies are deleted.
- [ ] **AC5** — `scripts/flow-helper-duplication.test.mjs` fails when a function name is declared
      in more than three flow files.
- [ ] **AC6** — `ui:flows` (non-quarantined) is green after the change.

## Open Questions

- none

## Plan

<!-- Filled by /refine 224. -->

## Deliverables

<!-- Filled by /refine 224. -->

## Model Hints

<!-- Filled by /refine 224. -->

## Acceptance Tests

<!-- Filled by /refine 224. -->

## Done

<!-- Filled by /build 224. -->
