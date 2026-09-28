---
id: 147
title: a broken sidecar is reported, never overwritten
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A sidecar ([[146]]) is a plain file next to the demo: the user may edit it by hand, a newer launcher
version may have written it, a sync tool may have mangled it. Whatever is in there is the user's
data. The launcher reads it **defensively**: a sidecar it cannot read is shown as an error on the
demo — never silently dropped, never overwritten unless the user explicitly saves (concept
`docs/concepts/demo-browser.md` §8.1, DEMO-12).

## Acceptance Criteria

- [ ] **AC1** — A sidecar that is not valid JSON marks the demo with a "sidecar error" marker and the
      reason ([[150]] row, [[155]] detail).
- [ ] **AC2** — A sidecar with a field that fails the schema marks the demo the same way, naming the
      field.
- [ ] **AC3** — A sidecar with an unknown (e.g. newer) `schemaVersion` marks the demo the same way,
      naming the version.
- [ ] **AC4** — Scanning, listing, opening the detail view and playing never modify an erroneous
      sidecar (content and modification time unchanged, asserted by a test).
- [ ] **AC5** — Saving over an erroneous sidecar happens only after an explicit confirmation that
      names what will be replaced.
- [ ] **AC6** — The demo's effective values while its sidecar is broken follow the rule decided in
      Q1.

## Open Questions

- [x] ~~**Q1 — Partial use** — ignore the whole broken sidecar (effective values from content/name
      only), or use its valid fields and flag the rest?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Newer schema** — read-only view of the fields the launcher does understand, or
      nothing?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Partial use: use the sidecar's still-valid fields for effective values and flag the
  rest, rather than discarding the whole file — least data loss when only part of a sidecar is
  corrupt or fails validation.
- Same principle applies to an unknown/newer `schemaVersion` (Q2): show a read-only view of the
  fields the current launcher does understand (those that pass the known schema shape) rather
  than nothing, consistent with the partial-use decision above.

## Plan

<!-- Filled by /refine 147, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 147. -->

## Model Hints

<!-- Filled by /refine 147. -->

## Acceptance Tests

<!-- Filled by /refine 147. -->

## Done

<!-- Filled by /build 147. -->
