---
id: 238
title: the demo list shows the selected installation's demos
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player with several installations, the Demos view shows the demos of the installation I have
selected in the rail, so the list matches what I am about to play with and is not a mix of every
folder on my PC.

User feedback 2026-10-04: "the demo browser should only show the demos of the selected installation".
Today the list is a union of every installation's `demos/` folders plus the extra folders from
Settings (`discovery.ts`); each row only says where it came from. Playback, on the other hand, is
already tied to the active installation — a demo from elsewhere plays from a temporary copy.

Concept: [replays-module.md](../systems/replays-module.md).

## Acceptance Criteria

- [ ] **AC1** — The list shows only demos found in the active installation's folders (all its game
      dirs, and on Linux its Q2PRO write dir).
- [ ] **AC2** — Switching the active installation in the rail switches the list, without a manual
      rescan and without losing the filter.
- [ ] **AC3** — The view says whose demos it shows (installation name in the list header).
- [ ] **AC4** — With no installation selected or none registered, the list shows an empty state
      that says why, not demos from elsewhere.
- [ ] **AC5** — An empty list for the selected installation says so and names its demo folders,
      rather than looking like a scan error.
- [ ] **AC6** — Favourites, ratings, tags and other sidecar data are unaffected by the scoping — a
      demo shows the same data whichever way it is reached.

## Open Questions

- **Q1** — Where do the extra folders from Settings go? They belong to no installation.
  Recommendation: show them under every installation, in their own labelled group, since they are
  explicitly the user's own collection.
- **Q2** — Is an "All installations" option still wanted (e.g. a toggle in the list header)?
  Recommendation: yes, off by default — the old union view is useful for finding a demo.
- **Q3** — Interaction with [[242]] (folders): does the folder tree root at the installation?
  Recommendation: yes — one tree per selected installation.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
