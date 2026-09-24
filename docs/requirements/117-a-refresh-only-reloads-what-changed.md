---
id: 117
title: a refresh only reloads what changed
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user checking whether their three favourite servers filled up does not need to wait for, or pay
the network cost of, a full sweep of every server on every configured master — and a user sitting
on a server's detail view wanting a fresher ping does not need the whole list to reload around them.
The concept calls this out directly: "damit man nicht immer alles neu laden muss" (game-browser.md
§3, §7.2.1, GB-N9) — refreshes are scoped to what the user actually asked to see updated, not a
single "reload everything" button standing in for all of them.

This story adds two narrower entry points on top of [[114]]'s two-stage scan and reuses its
machinery rather than duplicating it: a favourites-only refresh runs stage 1 and stage 2 for the
favourite addresses only, and a single-server refresh from the detail view issues exactly one stage-2
`status` query for that one address. Both still go through [[116]]'s no-scan-while-playing guard and
[[115]]'s manual-scan-is-always-available rule — scoping the work does not exempt it from the one
hard rule.

The concept explicitly parks a fourth possible control — a dedicated "re-check the watchlist"
refresh — as a decision for later, made from the [[115]] measurement rather than guessed now (§7.2.1,
§18 open point #16): if a full pass turns out cheap, "refresh servers" already covers it and a
fourth button is clutter. That decision belongs to sprint 9.7's watchlist stories ([[131]]), not
here — this story ships the three refreshes the concept already commits to (all servers, favourites,
one server) and leaves the fourth where the concept leaves it.

## Acceptance Criteria

- [ ] **AC1** — "Refresh servers" runs the same two-stage sweep [[114]] specifies over the same
      address set — it is not a separate, parallel implementation of a full scan.
- [ ] **AC2** — "Refresh favourites" runs stage 1 and stage 2 for the favourite addresses only, and
      does not issue any query for a non-favourite address; the rest of the list's data is left as it
      was before the refresh.
- [ ] **AC3** — "Refresh this server", available from the detail view, issues exactly one stage-2
      `status` query for that server's address and updates only that server's row and detail — no
      other row changes as a result.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 117`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 117`. -->

## Model Hints

<!-- Filled by `/refine 117`. -->

## Acceptance Tests

<!-- Filled by `/refine 117`. -->

## Done

<!-- Filled by `/build 117`. -->
