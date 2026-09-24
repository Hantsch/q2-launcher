---
id: 112
title: favourites are always there
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A server a user cares about should not depend on a master source still listing it, or on the user
remembering its address. Marking it a favourite fixes that: a favourite is always queried in a
scan whether or not any source currently returns it, and it is always pinned to the top of the
list (GB-S5) — pinning and always-querying are the *scan's* behaviour and belong to the scan engine
and list sorting, sprint 9.3/9.4 ([[114]], [[119]]); this story does not implement either.

This story's scope is deliberately narrower: the persistence and IPC layer that lets something be
marked and unmarked as a favourite, and lets that state survive a restart. There is no server list
to mark a favourite from yet — [[118]] is where that UI lands — so this story proves the favourites
CRUD through its IPC handlers directly (and their tests), not through a list row. Review should not
expect a finished favourite-marking UI; only the storage and the handlers it will be wired to.

Favourites are global to the launcher, not per installation (GB-P1) — the same reasoning as
[[110]]'s state key as a whole, which is where this data lives. A favourite is identified by the
server's address, because that is the only stable thing a scan result carries; nothing here keys
off an ephemeral per-scan result id, which would not survive the next scan.

## Acceptance Criteria

- [ ] **AC1** — A handler exists to mark a server address as a favourite, and a handler exists to
      unmark one; both are backed by a zod payload schema before their implementation (CLAUDE.md's
      IPC contract-first rule).
- [ ] **AC2** — A marked favourite is present in a subsequent read of the favourites list; an
      unmarked one is absent — both without restarting the app.
- [ ] **AC3** — Favourite state persists across an app restart, read back from [[110]]'s state key
      unchanged.
- [ ] **AC4** — A favourite is keyed by server address (`ip:port`), not by any scan-result id —
      marking the same address favourite twice does not create a duplicate entry, and unmarking by
      address removes exactly that entry regardless of when or whether a scan ever produced it.
- [ ] **AC5** — Marking an address that is not, and has never been, a live or scanned server is
      still accepted — a favourite can be created ahead of any scan finding it, consistent with
      GB-S5's "always queried, whether or not any source lists it".

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 112`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 112`. -->

## Model Hints

<!-- Filled by `/refine 112`. -->

## Acceptance Tests

<!-- Filled by `/refine 112`. -->

## Done

<!-- Filled by `/build 112`. -->
