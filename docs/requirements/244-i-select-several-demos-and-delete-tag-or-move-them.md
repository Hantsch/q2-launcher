---
id: 244
title: I select several demos and delete, tag or move them
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player cleaning up a large demo collection, I select several demos at once and delete them,
tag them or move them to another folder in one action.

User feedback 2026-10-04: bulk actions in the demo list — multi-select, then delete, tag or move.

Today selection is a single demo, and there is no delete or move at all (left out of v1 on purpose,
[demo-browser.md](../concepts/demo-browser.md) §2); the only file actions are reveal, copy path and
rename.

## Acceptance Criteria

- [ ] **AC1** — Demos can be multi-selected: Ctrl/Cmd-click toggles, Shift-click selects a range,
      Ctrl+A selects all visible, Escape clears; each row also has a checkbox.
- [ ] **AC2** — With two or more demos selected, a bulk bar shows the count and the actions Delete,
      Tag and Move, and the detail panel shows a summary instead of one demo.
- [ ] **AC3** — Delete asks for confirmation naming the count, then moves the demos and their
      sidecars to the system trash/recycle bin.
- [ ] **AC4** — Tag adds one or more tags to every selected demo, and can remove a tag that some of
      them carry; demos without a sidecar get one.
- [ ] **AC5** — Move asks for a target folder and moves the demos with their sidecars; a name clash
      in the target is reported per demo and never overwrites a file.
- [ ] **AC6** — A bulk action reports its outcome ("12 deleted, 1 failed: in use") and leaves the
      failed demos selected.
- [ ] **AC7** — Zip entries in the selection are skipped for delete, move and tag, and the bar says
      how many and why, as visible text.
- [ ] **AC8** — A demo that is currently playing is not deleted or moved; it is reported as skipped.
- [ ] **AC9** — Delete and move work on Windows and Linux (trash on Linux via the desktop's trash).

## Open Questions

- **Q1** — Move targets: only folders within the current tree ([[242]]), or also another
  installation's demos folder? Recommendation: any folder within the scanned demo roots, plus
  "Choose folder…".
- **Q2** — Is single-demo delete/move (detail panel, context menu) part of this story?
  Recommendation: yes — a selection of one is the same action.
- **Q3** — Depends on [[242]] for the folder target; build 242 first.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
