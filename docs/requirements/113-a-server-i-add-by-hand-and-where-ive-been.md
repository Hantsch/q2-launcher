---
id: 113
title: a server i add by hand, and where i've been
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

Two more pieces of the browser's own data, both global to the launcher and both living in [[110]]'s
state key: servers the user adds by hand, and a record of servers the launcher has actually
connected to.

**Manual servers** (GB-S4) exist for anything no master lists — a private or LAN server that will
never appear in a scan's discovered set. The user enters an `ip:port` directly; it is validated
through the same strict address validator [[107]] built for every other address this app puts into
an argument vector, so a manual entry can never smuggle something unsafe past that check. A manual
server is stored in a way that distinguishes it from a master-discovered one, so the list (once it
exists, [[118]]) can show the difference rather than presenting both identically.

**History** (GB-P3) records servers the launcher itself connected to. The actual moment a join gets
recorded is [[125]]'s job (sprint 9.6, the join flow) — this story does not add that trigger. What
this story builds is the store itself: a bounded, ordered history with a read API and the eviction
behaviour that keeps it bounded. The concept leaves the exact cap open (§11 "bounded in length");
this story fixes it at **200 entries**, evicted oldest-first once a new entry would exceed it — the
same order of magnitude as `downloadFailures`' 50-entry-plus-7-day-retention cap
(`src/main/modules/downloads/failure-log.ts`), scaled up because a join is a much lighter, much
more frequent event than a download failure.

Concept open point #4 ("are history entries queried during a scan?") is a scan-engine decision, not
a persistence one — this story stores history and reads it back; whether the scan address set
folds history in is sprint 9.3's call ([[114]]), and is left to that story rather than answered
here.

## Acceptance Criteria

- [ ] **AC1** — A manually entered `ip:port` is validated through the same address validator
      [[107]] built; a value that fails that validator is refused with a reason and never persisted.
- [ ] **AC2** — A stored manual server carries a flag (or equivalent shape) marking it as
      hand-added, distinguishable from a master-discovered server entry — nothing about a manual
      server's stored shape is indistinguishable from a discovered one.
- [ ] **AC3** — The history store is capped at 200 entries; adding a 201st entry evicts the oldest
      one first, and the store never exceeds the cap.
- [ ] **AC4** — A read API returns history entries in most-recent-first order.
- [ ] **AC5** — Manual servers and history both persist across an app restart, read back from
      [[110]]'s state key unchanged.
- [ ] **AC6** — A manual server can be removed; removing it does not affect history or any other
      manual entry.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 113`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 113`. -->

## Model Hints

<!-- Filled by `/refine 113`. -->

## Acceptance Tests

<!-- Filled by `/refine 113`. -->

## Done

<!-- Filled by `/build 113`. -->
