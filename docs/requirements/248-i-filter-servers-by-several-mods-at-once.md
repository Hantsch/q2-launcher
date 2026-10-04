---
id: 248
title: I filter servers by several mods at once
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player who plays more than one mod, I can select several mods in the server filter at once —
e.g. OpenTDM and CTF — and see servers of any of them.

User feedback 2026-10-04: select multiple mod filters in the server browser, e.g. filter for tdm and
ctf.

Today the mod filter is a single select (`ServerListFilter.mod: string | null`), filled from the
`gamename` values of the current rows.

Concept: [game-browser.md](../systems/game-browser.md).

## Acceptance Criteria

- [ ] **AC1** — The mod filter is a multi-select: the user can check several mods; the closed control
      shows their names (or "3 mods" when they do not fit).
- [ ] **AC2** — With several mods selected, a server is shown if its mod is any of them.
- [ ] **AC3** — With no mod selected the filter is "Any", as today.
- [ ] **AC4** — A selected mod that is no longer in the current list stays selected and visible in the
      control, and is never dropped silently.
- [ ] **AC5** — Saved quick filters store the mod set; a quick filter saved before this story (single
      mod) still loads and applies as a set of one, and a chip is pressed when the sets are equal.
- [ ] **AC6** — The multi-select is keyboard-operable (open, move, toggle with Space, close with
      Escape) and announces the selected count.

## Open Questions

- **Q1** — "tdm" and "ctf" are mods (`gamename`) in the example, but gamemode is a filter too. Should
  gamemode become multi-select as well? Recommendation: no — gamemode is only known for baseq2
  servers; mods only.
- **Q2** — Map filter multi-select too? Not asked for; recommendation: no.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
