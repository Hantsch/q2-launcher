---
id: 256
title: Server details are always shown
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, the server detail pane is always visible next to the list, so the layout does not jump and
clicking a server never makes its details disappear.

User feedback 2026-10-26: always show the game info, do not hide it when clicking the server again
(initially empty when nothing was clicked yet); a server cannot be deselected.

Today `ServersView.tsx` toggles selection on click (`current === address ? null : address`) and only
renders `ServerDetailView` when something is selected; the pane has a close button.

## Acceptance Criteria

- [ ] **AC1** — With no server selected, the Servers view shows the detail pane with an empty-state text.
- [ ] **AC2** — Clicking a server shows its details in the pane.
- [ ] **AC3** — Clicking the selected server again keeps it selected and its details shown.
- [ ] **AC4** — The detail pane has no close button.
- [ ] **AC5** — The list keeps its width whether or not a server is selected (no layout jump).
- [ ] **AC6** — The same holds in Online and LAN mode.

## Open Questions

## Decisions (Sprint)

- **(User)** The detail pane is always there; empty until the first server is chosen; a server cannot be
  deselected; clicking the selected server again keeps its details.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
