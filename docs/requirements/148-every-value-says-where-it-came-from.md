---
id: 148
title: every value says where it came from
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

The same fact can come from four places: what the user wrote (sidecar, [[146]]), what the demo
content says ([[136]]/[[137]]), what the file name says ([[139]]/[[140]]) and the file time. The
browser shows one **effective value** per field and makes it visible where that value came from, so
a user knows whether "q2dm1" is something they typed, something the demo recorded, or a guess from
the name (concept `docs/concepts/demo-browser.md` §5, §8.3, DEMO-13).

**Precedence per field: sidecar → demo content → file name → file time (date only).** What the user
entered always wins; the content is reliable for map, game dir and players. The resolver is pure
shared code. The gamemode's extra heuristic rung is [[149]].

## Acceptance Criteria

- [ ] **AC1** — For every field, the resolver returns the first of sidecar → content → name → file
      time that has a value, plus which source it came from; a unit test covers each rung for each
      field.
- [ ] **AC2** — The effective name is the sidecar name, else the file name.
- [ ] **AC3** — The effective players/sides are the sidecar's sides, else the players from the demo
      content, else the players from the name facts.
- [ ] **AC4** — The effective date is the sidecar's override, else the name-fact date, else the file
      time per the rule decided in Q1.
- [ ] **AC5** — The detail view ([[155]]) shows each effective value's source as visible text
      (sidecar / demo / name / file / guessed), not only colour or an icon.
- [ ] **AC6** — Clearing a field in the sidecar makes the next lower source's value effective again.

## Open Questions

- [ ] **Q1 — Which file time** — creation (≈ start of recording) or modification (≈ end), and what
      when the platform does not report creation time reliably (§6.3, §17.6)?
- [ ] **Q2 — Mod vs. game dir** — is the effective "mod" the parsed game dir as-is, or mapped to a
      display name (`opentdm` → "OpenTDM")?

## Plan

<!-- Filled by /refine 148, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 148. -->

## Model Hints

<!-- Filled by /refine 148. -->

## Acceptance Tests

<!-- Filled by /refine 148. -->

## Done

<!-- Filled by /build 148. -->
