---
id: 154
title: I filter demos by date
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

"What did I record in the last 30 days?" or "everything from last season's tournament weekend" — a
user filters demos by date with a few presets and a custom from–to range (concept
`docs/concepts/demo-browser.md` §3, §10, DEMO-18). The filter uses the effective date ([[148]]) and
combines with every filter of [[153]].

The renderer has no date picker yet (§14), so this story introduces one — a component built from the
design tokens, no image assets, keyboard operable.

## Acceptance Criteria

- [ ] **AC1** — Date presets are offered, including "last 30 days", with the full set decided in Q1.
- [ ] **AC2** — A custom range with from and to dates can be set; either end may be left open.
- [ ] **AC3** — A from-date later than the to-date is rejected with a visible reason.
- [ ] **AC4** — The date filter matches on the effective date, including the rule decided in Q2 for
      demos whose only date is the file time.
- [ ] **AC5** — The date filter combines with [[153]]'s filters (AND) and is cleared by its
      clear-all action.
- [ ] **AC6** — The date picker is fully keyboard operable, shows a visible focus state and has zero
      axe violations in `ui:verify`.
- [ ] **AC7** — Dates are shown and entered in the user's locale format.

## Open Questions

- [ ] **Q1 — Presets** (§17.6) beyond "last 30 days": today, 7 days, 90 days, this year…?
- [ ] **Q2 — File-time-only demos** (§17.6): filtered by file time like every other date, or marked
      and optionally excluded?
- [ ] **Q3 — Picker reuse** — is the new component a shared atom/molecule other modules may use
      (e.g. a future playtime range)?

## Plan

<!-- Filled by /refine 154, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 154. -->

## Model Hints

<!-- Filled by /refine 154. -->

## Acceptance Tests

<!-- Filled by /refine 154. -->

## Done

<!-- Filled by /build 154. -->
