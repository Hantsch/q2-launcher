---
id: 176
title: The Demos view shows only what helps right now
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

The Demos view carries two pieces of permanent chrome that do nothing for me most of the time:

- The **console command field** at the bottom is only useful while a demo plays. When nothing
  plays it sits there disabled with "Not available: no demo is playing" — a whole band of the
  screen spent on a control I cannot use.
- The **sort caption** under the header ("Favourites first, then newest") repeats what the list
  already shows and only adds noise.

Both go: the console field appears only while a demo plays, the sort caption disappears.

## Acceptance Criteria

- [ ] **AC1** — With no demo playing, the Demos view shows no console command field and no
      "no demo is playing" text.
- [ ] **AC2** — While a demo plays, the console command field is shown and sends a line exactly as
      today ([[166]]); story [[173]]'s Windows stage hint is still shown next to it.
- [ ] **AC3** — When the demo ends (finish, stop or game exit), the console command field disappears
      again.
- [ ] **AC4** — The Demos view shows no sort caption under its header, neither for the default order
      nor for a column sort; the column headers still mark the active sort column and direction.

## Open Questions

- Q1: When the field is only there during playback, it has no "why disabled" state left. Is there a
  platform case where a demo plays but the field cannot send (a channel that does not exist)? If so,
  that case keeps its visible reason (CLAUDE.md platform-parity rule) — refine checks
  `ConsoleCommandField.tsx`'s current reasons.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
