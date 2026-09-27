---
id: 153
title: I search and filter my demos
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

"Every CTF demo on q2ctf5 where I played against Tom" — a user narrows the library down the way the
server browser narrows servers ([[120]]): dropdowns for mod, gamemode and map, a favourites toggle,
a minimum rating, tags, and one search field that finds a player name wherever it was recorded
(concept `docs/concepts/demo-browser.md` §10, DEMO-17, DEMO-18). The date filter is its own story,
[[154]].

The filter engine mirrors or generalises `src/shared/servers/list-filter.ts` (§14) and runs on
effective values ([[148]]). Nothing is hidden until the user asks for it.

## Acceptance Criteria

- [ ] **AC1** — Full-text search matches, case-insensitively, the sidecar name, description and
      tags, player names **from every source** (sidecar sides, parsed configstrings, name facts), the
      map and the file name.
- [ ] **AC2** — Mod, gamemode and map filters are dropdowns filled from the values present in the
      current list (like the servers `filterOptions`).
- [ ] **AC3** — A favourites-only toggle shows only favourite demos.
- [ ] **AC4** — A "rating ≥ n" filter shows only demos rated n or higher; unrated demos are excluded
      while it is set.
- [ ] **AC5** — A tag filter shows only demos carrying the chosen tag(s), with the match rule decided
      in Q1.
- [ ] **AC6** — Filters and search combine with AND; a "Showing X of Y" count, a clear-all action
      and a no-match state are shown.
- [ ] **AC7** — Filtering applies after the sort ([[152]]) and does not change it.
- [ ] **AC8** — The filter engine is pure shared code with unit tests; the decision to generalise
      `list-filter.ts` or mirror it is recorded in the plan.

## Open Questions

- [ ] **Q1 — Several tags** — any of them (OR) or all of them (AND)?
- [ ] **Q2 — Remembered filters** — do filters survive leaving the view / restarting, or reset?

## Plan

<!-- Filled by /refine 153, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 153. -->

## Model Hints

<!-- Filled by /refine 153. -->

## Acceptance Tests

<!-- Filled by /refine 153. -->

## Done

<!-- Filled by /build 153. -->
