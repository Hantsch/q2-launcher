---
id: 188
title: the mods view shows the mods I have
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player, I open **Mods** in the navigation and see, as tiles, every game directory my
installation already has, with each one labelled for where it came from. Today the entry shows a
"planned" placeholder. This story makes the `mods` module real (main + renderer, registered in
both registries, its own IPC contract) and gives it its view: a tile catalog with a detail panel.
Later stories fill the catalog with installable entries.

Concept: [mods.md](../concepts/mods.md) §9, §12; requirements MOD-1, MOD-2, MOD-14.

## Acceptance Criteria

- [ ] **AC1** — Opening Mods no longer shows the planned-module placeholder, but the Mods view.
- [ ] **AC2** — For the installation the view speaks for, every game directory the inspector found
      (except `baseq2`) appears as one tile carrying the directory's name.
- [ ] **AC3** — A game directory without a launcher install record carries the visible label
      *installed manually*.
- [ ] **AC4** — Clicking a tile opens a detail panel naming the directory and its folder path, with
      a *Reveal folder* action that opens that folder in the OS file manager.
- [ ] **AC5** — A manually installed directory's detail panel offers neither *Update* nor *Remove*.
- [ ] **AC6** — An installation with no game directories besides `baseq2` shows an empty state that
      says so, not an empty grid.
- [ ] **AC7** — Every installation id the renderer sends to the mods channels is validated in main.
      An unknown id is refused, never read from disk.

## Open Questions

- **Q1** (concept §14 item 4) — The tile catalog with a detail panel is a new pattern in this app.
  Do we build a layout prototype under `docs/prototypes/mods/` before this story, or decide the
  layout in the story?
- **Q2** (concept §14 item 6) — Which installation does the view speak for: the globally selected
  one, or an installation picker inside the Mods view?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
