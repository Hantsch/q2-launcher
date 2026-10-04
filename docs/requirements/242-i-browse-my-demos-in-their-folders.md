---
id: 242
title: I browse my demos in their folders
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player with hundreds of demos sorted into subfolders, the Demos view finds demos in those
subfolders and lets me browse them folder by folder, like Google Drive: open a folder, see its
subfolders and demos, go back up via a breadcrumb.

User feedback 2026-10-04: most users have many demos and structure them in subfolders; the demo
browser should allow that too, "Google Drive style".

Today discovery reads each `demos/` folder one level deep only ("never recursive", `discovery.ts`),
so demos in subfolders are not found at all, and the list is flat.

Concept: [replays-module.md](../systems/replays-module.md), [demo-browser.md](../concepts/demo-browser.md).

## Acceptance Criteria

- [ ] **AC1** — Demos in subfolders of a scanned demo folder are found, at any depth.
- [ ] **AC2** — The list shows the current folder's subfolders first, then its demos; a folder row
      shows its name and how many demos it contains.
- [ ] **AC3** — Opening a folder (double-click or Enter) shows its content; a breadcrumb shows the
      path from the root and each crumb goes back to that level.
- [ ] **AC4** — Search and filters apply across all folders below the current one, and each match
      shows the folder it is in; clearing them returns to the folder view.
- [ ] **AC5** — The user can create a new folder in the current folder and rename an empty or
      non-empty folder; a rename moves sidecars along with their demos.
- [ ] **AC6** — Demos can be moved into another folder by drag and drop (single demo here; several
      at once is [[244]]).
- [ ] **AC7** — Scanning a large tree (e.g. 5 000 demos in 200 folders) keeps the view responsive, and
      a folder loop (junction/symlink) does not hang the scan.
- [ ] **AC8** — Zip archives keep behaving as today — read-only; whether a zip shows as a folder is
      decided in refine.

## Open Questions

- **Q1** — Should zips appear as browsable folders (read-only)? Recommendation: yes — it is the same
  mental model, and their entries are already expanded today.
- **Q2** — Delete folder: in scope, or only with [[244]]'s delete? Recommendation: with 244, behind
  the same confirmation.
- **Q3** — Root of the tree: per installation (with [[238]]) — and how do extra folders appear?
  Recommendation: one top-level folder per demo root (each game dir's `demos/`, each extra folder).
- **Q4** — Is a maximum scan depth needed? Recommendation: no hard depth, but loop detection by real
  path.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
