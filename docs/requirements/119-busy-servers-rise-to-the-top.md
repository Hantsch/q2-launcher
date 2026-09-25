---
id: 119
title: busy servers rise to the top
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the Servers view wanting to know where something is going on right now, not to read an
alphabetical directory of mostly-empty infrastructure. So the list they land on has to already be
ordered toward activity: favourites the user cares about pinned on top, then the busiest servers,
without the user touching a single control. From there, a user who wants a different order — by map,
by ping, by name — can change it, and the launcher remembers that choice the next time the view
opens.

This story is the ordering of the rows [[118]] defines; it does not change what a row shows or which
markers appear, and it does not decide which servers are in the list at all — that is [[120]]'s
filters and search, which have to compose with whatever order this story produces. The rows
themselves come from the scan engine ([[114]]) inside the module from [[106]].

## Acceptance Criteria

- [ ] **AC1** — With no user-chosen sort in effect, the list orders favourites first, then the
      remaining servers by occupancy descending (GB-L3).
- [ ] **AC2** — In the default order, gamemode only breaks ties between servers with the same
      favourite status and the same occupancy; it never groups the list — a busier server is always
      above a less busy one, whatever their gamemodes.
- [ ] **AC3** — A user can change which column the list is sorted by, from the list's own UI.
- [ ] **AC4** — A user-chosen sort persists across sessions — reopening the Servers view (or
      restarting the launcher) shows the same sort the user last chose, not the default.
- [ ] **AC5** — The sort/filter engine that produces this ordering is a pure, unit-tested module,
      independent of the list UI (GB-A6).

## Open Questions

- [x] ~~**Q1 — Is gamemode a grouping key or only a tie-break?** (concept §18 open point 3)~~
      answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Gamemode as grouping key or tie-break: **tie-break only** — favourites, then
  occupancy descending, then gamemode among equal occupancy (2026-09-25, planning).

## Plan

<!-- Filled by `/refine 119`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 119`. -->

## Model Hints

<!-- Filled by `/refine 119`. -->

## Acceptance Tests

<!-- Filled by `/refine 119`. -->

## Done

<!-- Filled by `/build 119`. -->
