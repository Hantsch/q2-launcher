---
sprint: S24
status: in-progress # planned | in-progress | done
branch: sprint/S24
milestone: 9.3 — Scan engine
---

# Sprint S24 — The scan engine finds servers and stays out of the way

## Goal

Opening the Servers view runs a real two-stage scan — list rows appear as `info` replies stream in,
player data follows for the servers that have anyone on them — and that scan respects the user's own
cadence settings, never competes with a running game, and can be narrowed to just favourites or just
one server instead of always reloading everything.

## Stories (in build order)

- [x] 114 — a scan sweeps the servers in two stages
- [x] 115 — how hard the scan works is a setting
- [ ] 116 — no scan runs while the game does
- [ ] 117 — a refresh only reloads what changed

## Notes

Sprint 3 of 7 for the game-browser milestone (9.1–9.7, stories 106–132; concept at
`docs/concepts/game-browser.md`). Depends on S22 (106–109: module scaffold, address validator,
protocol codecs, master codecs) and S23 (110–113: state schema, source settings, favourites, manual
servers + history) being built first — this sprint's scheduler reads the address set and codecs
those sprints produce and has nothing to sweep without them.

Build order is a dependency chain: 115 decides the scan's cadence/budget shape (including whether a
scan is a `Job`) and 116 depends on that decision to model its guard against, but 114's scheduler is
what both settings and the guard attach to, so 114 lands first and 115/116 wire into it. 117's scoped
refreshes reuse 114's machinery directly and come last.

115 carries this sprint's one open point of substance: whether a scan is represented as a `Job` via
the existing `JobsService`, which the concept raises without resolving (game-browser.md §18 open
point #7). That decision should come out of this sprint's clarification round before 114 is built,
since it shapes how 116's no-scan-while-playing guard observes scan state.
