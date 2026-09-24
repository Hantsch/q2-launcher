---
id: 122
title: a server's detail opens
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user clicks a server row in the list ([[118]]) and sees what is actually happening on that
server: who is there, how full it is, and enough identifying detail (name, address, mod, map,
gamemode, engine, protocol) to know what they would be joining. Today the [[118]] list row is the
only surface a user has — a name, an occupancy count, a ping. The detail view is where the browser
answers the second half of its own vision (concept §1): not just "is anyone out there" but "what is
going on, in detail, on this one server".

This story ships the entry point to that view: its header and its players panel. The header renders
the fields concept §9 item 1 lists, built from the same [[108]] `info`/`status` results the list row
already renders a subset of. The players panel (§9 item 2) is the first place a user actually sees
individual people, not aggregate occupancy — and it is exactly where the protocol's real limit has to
be respected rather than glossed over: a `status` reply carries score, ping and name for each
connected client and nothing else (concept §6.3). Some mods list spectators with score 0, some omit
them entirely; neither case is distinguishable from a player who has not scored yet (§6.4). The view
therefore says nothing about who is spectating anywhere — not a column, not a marker, not a tooltip —
because a plausible-looking guess is worse than silence here (GB-D1's "no claim" language, the
decision the interview reached once the protocol limitation was raised).

This story is also where the view's general robustness rule (GB-D6: "a missing or malformed key
never breaks the view; each field degrades on its own") has to hold for the first time, because it
is the entry point every other detail-view story is opened through. The same discipline — one field
failing never takes the surrounding view with it — applies again in [[123]]'s rule table and dmflags
decode, and in [[124]]'s ping history and local-context statements; it is stated once here as the
shared floor rather than re-derived as a duplicate criterion in each of the three stories.

Out of scope: the rule table and dmflags ([[123]]), ping history and local mod/map availability
([[124]]), and the view's actions row (Join/Spectate/Favourite/Add-to-address-book/Copy-address),
which belongs to sprint 9.6 — see [[125]], [[126]], [[127]]. Together, 122/123/124 compose the one
detail view concept §9 describes as six numbered sections (1-6); this story is sections 1-2.

## Acceptance Criteria

- [ ] **AC1** — Opening a server row from [[118]] opens a detail view whose header shows name,
      address, mod, map, gamemode, occupancy, measured ping, password marker, engine and protocol
      (concept §9 item 1).
- [ ] **AC2** — The players panel lists each connected player's name, score and ping, and the list is
      sortable by at least one of those columns.
- [ ] **AC3** — A server currently reporting zero players shows a stated empty state in the players
      panel, not a blank area.
- [ ] **AC4** — Nowhere in the view — header, players panel or any marker — does the UI claim or
      imply which players are spectating; data the protocol cannot provide is simply not rendered as
      a claim.
- [ ] **AC5** — A single missing or malformed field, in the header or in one player's row, degrades
      on its own (shown as absent/unknown) without breaking the rendering of the rest of the header
      or the rest of the player list (GB-D6).

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 122`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 122`. -->

## Model Hints

<!-- Filled by `/refine 122`. -->

## Acceptance Tests

<!-- Filled by `/refine 122`. -->

## Done

<!-- Filled by `/build 122`. -->
