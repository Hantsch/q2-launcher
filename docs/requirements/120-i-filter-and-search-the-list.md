---
id: 120
title: i filter and search the list
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user looking at the server list ([[118]], ordered per [[119]]) wants to narrow it down: only my
mod, only deathmatch, only servers with room, only servers with no password, only the ones waiting
for an opponent, only this map — or find a specific server or a specific player by typing a name.
None of that should ever mean a server disappears from the list *by default*: the browser's whole
premise is that nothing is hidden until the user asks for it, because an empty server is still a
fact worth seeing, not noise to be swept away.

This story is the filtering and search layer over the rows [[118]] defines and the order [[119]]
produces; it does not change what a row shows or how the unfiltered list is ordered — it changes
which subset of that ordered list is currently visible. It lives in the same module as [[106]], over
data the scan engine ([[114]]) supplies.

## Acceptance Criteria

- [ ] **AC1** — Each of the listed filters — mod, gamemode, non-empty, not full, no password,
      waiting-for-opponent, map — can be applied on its own (GB-L5).
- [ ] **AC2** — Multiple filters can be active at the same time, and the visible list reflects their
      intersection (a server must satisfy every active filter to remain visible).
- [ ] **AC3** — With no filter active, every discovered server is listed, including servers with zero
      players (GB-L4).
- [ ] **AC4** — A search term matches against server name for every server in the list, regardless of
      how much data has been fetched for it.
- [ ] **AC5** — A search term additionally matches player names, but only for servers whose stage-2
      detail has actually been fetched; a server with no fetched player data is not falsely excluded
      from a player-name search by virtue of having no player data, nor falsely included as a name
      match it never made.
- [ ] **AC6** — Filters and search compose with the sort order from [[119]]: the visible subset changes
      as filters/search are applied, but the relative order of the servers that remain visible follows
      the active sort without the two fighting each other (e.g. filtering never silently changes the
      sort column, and sorting never re-includes a filtered-out server).

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 120`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 120`. -->

## Model Hints

<!-- Filled by `/refine 120`. -->

## Acceptance Tests

<!-- Filled by `/refine 120`. -->

## Done

<!-- Filled by `/build 120`. -->
