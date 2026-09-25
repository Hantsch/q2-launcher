---
sprint: S24
status: done # planned | in-progress | done
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
- [x] 116 — no scan runs while the game does
- [x] 117 — a refresh only reloads what changed

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

## Regression gate

Ran once on `HEAD` (`9dc1153`, "117: a refresh only reloads what changed") after all four stories
were built and committed.

- `npm run build` — green.
- `npm test` (full suite) — green (278 files, 4536 passed, 8 skipped, 0 failed).
- `npm run ui:verify` — green (45/45 screens, axe clean).
- `npm run ui:flows` — red: 45/59 flows passed, 14 failed.

All 14 failures attributed via the merge-base check (`git merge-base dev HEAD` → `9e4e6de`, "sprint
23 done"): every one of them fails identically on that pre-sprint commit, before any of stories
114-117 touched the `servers` module. None are flaky (all reproduced identically on a HEAD re-run)
and none bisect to a story commit — verdict for all 14 is **pre-existing**, not caused by this
sprint, not fixed here:

`app-update`, `bootstrap-failure`, `bootstrap-failure-retry`, `bootstrap-incomplete-package`,
`bootstrap-r1q2`, `bootstrap-wizard`, `config-header-geometry`, `controls-subcategory`,
`custom-action-row`, `engine-badge-surfaces`, `engine-not-client`, `harness-offscreen`,
`home-hero-carousel`, `news-cover-template`.

None of these flows touch the `servers` module this sprint built; the failure signatures (window
sizing/clamping, a stale fixture-tile-count expectation, folder-picker stub timing, a duplicate
test-id match) read as pre-existing harness/environment issues, not product regressions. Worth a
follow-up sweep, but out of this sprint's scope.
