---
id: 250
title: Scan now refreshes only the servers my filter shows
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player with a filter active, "Scan now" refreshes just the servers I can see, so I get fresh
player counts and pings for them quickly instead of waiting for the whole list.

User feedback 2026-10-04: refresh only filtered servers — when filters are active, Scan now should
only refresh the servers left in the filter.

Today Scan now always runs a full round (`ScanScope 'all'`): master query, `info` to every address,
then `status` to every non-empty server. Other scopes are favourites and one server; there is no
scope for an arbitrary set of addresses. Filtering happens only in the renderer.

Concept: [servers-module.md](../systems/servers-module.md), [game-browser.md](../systems/game-browser.md).

## Acceptance Criteria

- [ ] **AC1** — With a filter active, the button reads "Refresh N shown" and refreshes exactly the
      servers the list currently shows (both scan stages, no master query).
- [ ] **AC2** — With no filter active, the button reads "Scan now" and runs the full scan as today.
- [ ] **AC3** — A full scan stays reachable while a filter is active (e.g. a split-button entry
      "Scan all").
- [ ] **AC4** — A server that no longer matches after the refresh leaves the list, like with any live
      update.
- [ ] **AC5** — The visible set is sent as a validated list of addresses; main refuses addresses it
      does not already know.
- [ ] **AC6** — Works in Online and LAN mode; in LAN it only re-queries known rows, no broadcast.
- [ ] **AC7** — The existing scan rules still hold: one scan at a time, refused while the game runs.

## Open Questions

- **Q1** — Does the free-text search count as "a filter" here? Recommendation: yes — it narrows the
  visible list the same way.
- **Q2** — Should automatic refreshes (auto-refresh interval) also be limited to the filtered set?
  Recommendation: no — only the manual button; auto-refresh keeps the whole list fresh.
- **Q3** — With [[247]]'s ping filter, servers above the limit are never re-pinged by this button and
  cannot come back until a full scan. Acceptable? Recommendation: yes, AC3 covers it.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
