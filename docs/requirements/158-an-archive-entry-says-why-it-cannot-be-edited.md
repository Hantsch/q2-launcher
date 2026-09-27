---
id: 158
title: an archive entry says why it cannot be edited
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Demos inside a `.zip` ([[143]]) are read-only by decision: there is nowhere simple to put a sidecar
for an entry, and renaming inside an archive is not a file action. The user still sees the actions —
they are visible, disabled, and say why, the same way a platform gap is explained (concept
`docs/concepts/demo-browser.md` §3, §8.1, DEMO-15; CLAUDE.md platform-parity rule applied to
archives).

## Acceptance Criteria

- [ ] **AC1** — For an archive entry, the sidecar editor ([[155]]) is visible but disabled, with the
      reason as visible text (e.g. "Demos inside an archive are read-only — extract it to annotate
      it").
- [ ] **AC2** — For an archive entry, rename ([[157]]) is visible but disabled, with the reason as
      visible text.
- [ ] **AC3** — The reasons are i18n keys.
- [ ] **AC4** — The main-side sidecar-write and rename handlers reject an archive-entry id even if
      called directly, with a typed error.
- [ ] **AC5** — Reveal, copy path ([[156]]) and Play ([[159]]/[[160]]) stay available for entries.

## Open Questions

<!-- None known from the concept. -->

## Plan

<!-- Filled by /refine 158. -->

## Deliverables

<!-- Filled by /refine 158. -->

## Model Hints

<!-- Filled by /refine 158. -->

## Acceptance Tests

<!-- Filled by /refine 158. -->

## Done

<!-- Filled by /build 158. -->
