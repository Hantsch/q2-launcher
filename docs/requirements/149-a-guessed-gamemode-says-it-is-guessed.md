---
id: 149
title: a guessed gamemode says it is guessed
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Filtering by "duel" or "CTF" is one of the main reasons to have a demo library — but the demo
content carries no `deathmatch`/`dmflags` (concept `docs/concepts/demo-browser.md` §6.3). So the
gamemode comes from the sidecar, from a file-name pattern, or from a **mod heuristic** — e.g. game
dir `ctf` → CTF, an OpenTDM pattern hit → TDM, exactly two players → duel. A heuristic value is a
guess, and the user sees it as one (§8.3, DEMO-13).

Order for the gamemode: **sidecar → file-name pattern → heuristic → unknown**. The heuristic table is
concept open point §17.5 and is fixed in this story.

## Acceptance Criteria

- [ ] **AC1** — The gamemode resolver applies sidecar → pattern → heuristic → unknown, as pure code
      with a unit test per rung.
- [ ] **AC2** — The heuristic table decided in Q1 is implemented and documented in the concept
      (§17.5 resolved), each rule with a unit test.
- [ ] **AC3** — A heuristic gamemode is shown as **guessed** — as visible text, distinct from a
      sidecar or pattern value — in the row ([[150]]) and the detail view ([[155]]).
- [ ] **AC4** — A demo no rule matches shows "unknown" gamemode, not an empty cell.
- [ ] **AC5** — The gamemode filter ([[153]]) treats guessed and known values the same unless Q2
      decides otherwise.

## Open Questions

- [ ] **Q1 — Heuristic table** (§17.5): which game dirs, pattern hits and player counts map to
      which mode, and in which order the rules are tried.
- [ ] **Q2 — Filtering guesses** — should the filter be able to exclude guessed gamemodes?

## Plan

<!-- Filled by /refine 149, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 149. -->

## Model Hints

<!-- Filled by /refine 149. -->

## Acceptance Tests

<!-- Filled by /refine 149. -->

## Done

<!-- Filled by /build 149. -->
