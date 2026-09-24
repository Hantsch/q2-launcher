---
id: 118
title: a server row says what's going on
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the Servers view (from [[106]]) and, for every server the scan ([[114]]) has found,
sees at a glance what is happening on it — without opening the detail view. That is the whole point
of a *list*: the busy server, the password-protected one, the favourite, the one whose last scan
went unanswered, and — the specific case the browser exists for — the duel server where one person
is sitting alone waiting for an opponent, all have to be readable from the row itself.

This story is the row and its markers only: what a row shows and when each marker lights up. It does
not decide the order servers appear in ([[119]]) or how the list is narrowed down ([[120]]); both of
those stories build on the row this one defines. It also does not decide the scan's own timing or
what data is available at which stage — that is [[114]]'s concern. This story only has to render
whatever data is present at any given moment, correctly, including the moment nothing has arrived
yet.

## Acceptance Criteria

- [ ] **AC1** — A server row shows all five listed fields when known: name, mod, players/slots, map,
      and measured ping (GB-L1).
- [ ] **AC2** — A password marker is shown on a row exactly when that server's `needpass` flag
      indicates a password is required, and is absent otherwise.
- [ ] **AC3** — A gamemode marker is shown on a row, correctly derived from the server's
      `deathmatch`/`coop`/`ctf`/`teamplay` flags, once that data has been fetched for the server.
- [ ] **AC4** — A favourite marker is shown on a row exactly when the server is marked as a
      favourite, regardless of what the scan has or has not fetched for it.
- [ ] **AC5** — A stale marker is shown on a row exactly when the last scan attempt for that server
      timed out without an answer; the row keeps showing the server's previously known field values
      rather than blanking them.
- [ ] **AC6** — A "waiting for an opponent" marker is shown on a row exactly when that server's known
      player count is exactly one, and is absent for zero, two or more players, or when the player
      count is not yet known.
- [ ] **AC7** — A server for which no field has been fetched yet (freshly discovered, nothing scanned
      for it so far) renders a sane placeholder row — it does not appear blank, malformed or throw a
      render error.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 118`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 118`. -->

## Model Hints

<!-- Filled by `/refine 118`. -->

## Acceptance Tests

<!-- Filled by `/refine 118`. -->

## Done

<!-- Filled by `/build 118`. -->
