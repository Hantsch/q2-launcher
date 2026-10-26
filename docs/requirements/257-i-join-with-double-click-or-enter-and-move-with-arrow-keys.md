---
id: 257
title: I join a server with double-click or Enter and move through the list with arrow keys
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, I move through the server list with the arrow keys and join with Enter or a double-click,
so joining is fast with mouse or keyboard.

User feedback 2026-10-26: double-click on a server joins it, can be disabled in the settings, default on;
with a server selected, arrow up/down selects another server, Enter joins.

Today there is no double-click and no arrow-key handling in the servers module; Enter/Space toggle
selection.

## Acceptance Criteria

- [ ] **AC1** — Double-clicking a server row joins that server (same flow as the Join action).
- [ ] **AC2** — The Servers settings have a "Double-click joins" switch, on by default, persisted.
- [ ] **AC3** — With the switch off, double-clicking only selects the row.
- [ ] **AC4** — With a server selected and the list focused, Arrow Down/Up selects the next/previous visible
      row, keeps it scrolled into view and updates the detail pane.
- [ ] **AC5** — Arrow keys stop at the first and last row (no wrap).
- [ ] **AC6** — Enter on the selected row joins that server, regardless of the double-click switch.
- [ ] **AC7** — Arrow keys and Enter typed in a filter or search field do not move the selection or join.

## Open Questions

## Decisions (Sprint)

- **(User)** Double-click joins; a Servers setting switches it off; default on.
- **(User)** Enter always joins the selected server — the setting covers double-click only.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
