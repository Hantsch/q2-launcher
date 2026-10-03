---
id: 229
title: tech debt has one home and an ageing rule
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want to see an area's open defects before touching it, and I want a
follow-up to be promoted to a story or deleted before it is rediscovered at a later gate, so that
sprint reviews stop re-listing the same items and the roadmap stays one screen.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F24): docs/ROADMAP.md
"Follow-ups worth doing" holds 34 bullets, five older than six weeks; the four red flows appear
three times; 12 source links are broken (`../sprints/S27/…` resolves outside `docs/`). Sprint
reviews carry "Unfixed minor review findings" paragraphs (S30 ~25 items, S29 ~15, S31 6) that
never reach the roadmap; docs/README.md gives no ageing or escalation rule, and `/sprint` says
"anything bigger is a story proposal for the review's findings section" — where it then stays.

## Acceptance Criteria

- [ ] **AC1** — `docs/TECH-DEBT.md` exists with one row per item (`id`, `since` sprint, area,
      severity, one line, source link) and is referenced from docs/README.md's "Where do I find…"
      table; the review's not-storied findings (F34, F49, F63, F67, F69, F75) are its first rows.
- [ ] **AC2** — The 34 follow-ups and every "Unfixed" item from the S27–S31 reviews are triaged:
      each becomes a story draft, a `TECH-DEBT.md` row, or is deleted with the reason in the
      commit; the roadmap's follow-up list is ≤ 10 lines and contains nothing a story 199–231
      already covers.
- [ ] **AC3** — The roadmap's broken links are fixed (relative to `docs/`); `scripts/check-docs.mjs`
      (story 227) covers `TECH-DEBT.md`.
- [ ] **AC4** — docs/README.md and the `/roadmap check` and `/sprint` review instructions carry
      the rule: a follow-up older than three sprints is promoted or deleted; an unfixed review
      finding goes into `TECH-DEBT.md`, not into the review alone; `/roadmap check` reports
      overdue rows.
- [ ] **AC5** — docs/ROADMAP.md's "Open / unprioritised" lists the codebase review with its story
      range and the suggested sprint cut.

## Decisions (Sprint)

- **(User)** Q1: Rows are removed from TECH-DEBT.md when done; git is the history.
- **(User)** AC4: Ageing rule goes into docs/README.md and `.claude/ai-scrum.md` Notes (plugin files are managed, not edited); add a follow-up "upstream the rule into the ai-scrum plugin" for the user.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Is `TECH-DEBT.md` compacted by `/roadmap check` like the roadmap (rows removed
      when done), or does it keep a done section as history? Recommendation: removed; git is the
      history.

## Plan

<!-- Filled by /refine 229. -->

## Deliverables

<!-- Filled by /refine 229. -->

## Model Hints

<!-- Filled by /refine 229. -->

## Acceptance Tests

<!-- Filled by /refine 229. -->

## Done

<!-- Filled by /build 229. -->
