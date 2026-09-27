---
id: 150
title: a demo row says what it is
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user scrolling the Demos view recognises a demo from its row alone — which match it was, on which
map, who against whom, when, how long — and sees at a glance which demos they have already
annotated, which are favourites, which come from an archive and which have a problem (concept
`docs/concepts/demo-browser.md` §10, DEMO-13).

The row shows **effective values** ([[148]]). Order is [[152]]'s, narrowing is [[153]]/[[154]]'s,
list states are [[151]]'s. Demo-provided text (player names, map, level name) and sidecar text are
data, not i18n prose. The concept leaves the final column set to refine (§10).

## Acceptance Criteria

- [ ] **AC1** — A row shows, when known: effective name, map, mod, gamemode, players or sides
      (`A vs B`, team names where the sidecar has them), date, duration, format and source
      (installation + game dir, extra folder, or archive).
- [ ] **AC2** — A guessed gamemode is marked as guessed ([[149]]).
- [ ] **AC3** — Favourite and rating are shown when the sidecar sets them.
- [ ] **AC4** — Markers for "has sidecar", "sidecar error" ([[147]]), "archive entry" ([[143]]) and
      "unreadable" ([[145]]) appear exactly when they apply, and none relies on colour alone.
- [ ] **AC5** — A value that is unknown shows a sane placeholder; a row never renders blank,
      malformed or throws.
- [ ] **AC6** — Selecting a row opens its detail ([[155]]).
- [ ] **AC7** — The list stays responsive with the demo count decided in Q2.
- [ ] **AC8** — The row is a `ui:verify` screen with zero axe violations; any sub-44px density gets a
      CLAUDE.md deviation row with the desktop-only rationale.

## Open Questions

- [ ] **Q1 — Column set** (§10): which of the fields above are columns, which are secondary text,
      which only appear in the detail?
- [ ] **Q2 — Scale** — how many demos must the list handle smoothly (1 000? 10 000?), and does that
      need virtualisation?

## Plan

<!-- Filled by /refine 150, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 150. -->

## Model Hints

<!-- Filled by /refine 150. -->

## Acceptance Tests

<!-- Filled by /refine 150. -->

## Done

<!-- Filled by /build 150. -->
