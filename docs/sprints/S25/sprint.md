---
sprint: S25
status: planned # planned | in-progress | done
branch: # set by /sprint
milestone: 9.4 — Server list UI
---

# Sprint S25 — The server list shows what's going on

## Goal

Opening the Servers view shows a live server list: each row carries its markers (password,
gamemode, favourite, stale, waiting-for-opponent), the list defaults to favourites-then-occupancy
order with a user-changeable and remembered sort, it can be filtered and searched without hiding
anything by default, and it states its own loading/empty/error states honestly.

## Stories (in build order)

- [ ] 118 — a server row says what's going on
- [ ] 119 — busy servers rise to the top
- [ ] 120 — i filter and search the list
- [ ] 121 — the list says what it's doing

## Notes

Sprint 4 of 7 for the game-browser milestone (9.1–9.7, stories 106–132; see
[ROADMAP.md](../../ROADMAP.md)). Depends on S22–S24 (stories 106–117: module scaffold,
protocol/codecs, persistence, and the streaming scan engine) being built first — this sprint only
renders what that engine produces, it does not scan anything itself. Concept:
[docs/concepts/game-browser.md](../../concepts/game-browser.md).

The build order is a dependency chain, not a preference: 119 (sort) and 120 (filter/search) both
build on the row 118 defines and have to compose with each other without fighting; 121's states wrap
the list all three produce and is verified last. 119 carries an open question (gamemode as grouping
vs. tie-break, concept §18 open point 3) that has to be resolved in the clarification round before
`/refine 119` can turn its AC2 into concrete behaviour.
