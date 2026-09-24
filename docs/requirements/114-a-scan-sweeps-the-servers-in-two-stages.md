---
id: 114
title: a scan sweeps the servers in two stages
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user opens the Servers view and, within a second, sees rows filling in for the servers that are
actually reachable right now — not a spinner that only resolves once the slowest server on the
internet has answered or timed out. Behind that, a second pass quietly fetches who is actually
playing on the servers that turned out to have anyone on them at all, so the occupancy sort, the
"waiting for an opponent" marker and (once unlocked) the watchlist all have real player data to work
from, without every server on the list paying the cost of a full `status` query.

This is the scan scheduler itself: the thing that turns [[106]]'s empty module into a working list.
It resolves the address set from every enabled source configured in [[111]], every favourite
([[112]]), and every manually added server ([[113]]), using the query and reply codecs [[108]] and
the master/HTTP list codecs [[109]] already built. Whether history entries also join that address
set is the concept's own open point (game-browser.md §18.4) and is [[113]]'s decision to record, not
this story's — this story only sweeps whatever [[113]] hands it. One source failing to answer
must not take the rest of the scan down with it — a dead master is exactly the kind of failure the
concept calls out (game-browser.md §7.1, GB-S3) as routine, not exceptional. And a favourite has to
show up even when every configured source has forgotten about it, because a favourite is a promise
the user made to the launcher, not a claim the launcher has to verify against a master list first
(GB-S5).

The scan is asynchronous end to end: nothing in the renderer polls for progress. Main owns the scan
state and pushes every result the moment it exists, the same `module:event` push already used for
`jobs:changed` elsewhere in the app — the store applies what arrives, it does not ask for it.

Out of scope here: the cadence this scan runs on (auto-scan on open, auto-refresh interval,
concurrency/timeout/retry budget) is [[115]]; the hard "never while the game runs" rule is [[116]];
the narrower "refresh favourites only" / "refresh one server" variants of this same mechanism are
[[117]]. This story is the two-stage sweep itself, triggered once, top to bottom.

## Acceptance Criteria

- [ ] **AC1** — A scan produces list rows from stage-1 `info` replies as they arrive; the list is
      populated and usable before the stage-1 sweep across the whole address set has finished.
- [ ] **AC2** — Stage 2 (`status`) is fetched only for the currently selected server and every server
      stage 1 reported as non-empty; a server stage 1 reported as empty is not queried a second time
      in the same scan.
- [ ] **AC3** — A source that errors (unreachable master, malformed HTTP reply) is reported as failed
      for that source specifically, and the scan still completes using every other source's
      addresses — the whole scan does not abort because one source did.
- [ ] **AC4** — Every favourite address is included in the stage-1 sweep even when no enabled source
      returns it that round.
- [ ] **AC5** — Stage-1 and stage-2 results are delivered to the renderer as `module:event` pushes as
      each one arrives, not read back by the renderer polling an invoke channel.
- [ ] **AC6** — The address set for one scan is the union of every enabled source's addresses, every
      favourite, and every manually added server, with duplicates (same address from two origins)
      collapsed to one entry that still carries all of its origins.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 114`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 114`. -->

## Model Hints

<!-- Filled by `/refine 114`. -->

## Acceptance Tests

<!-- Filled by `/refine 114`. -->

## Done

<!-- Filled by `/build 114`. -->
