---
id: 249
title: I pick mod and map when I start an installation
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player, when I start an installation I can choose which mod it runs and which map it loads,
so the game opens straight into that map instead of the main menu.

User feedback 2026-10-04: when starting an installation you should be able to choose mod and map.

Today Play starts the installation with `+set game <activeGameDir>` when a mod is set; the mod is a
persisted dropdown in the action bar (`GameDirSelect`, only shown when the installation has mods).
There is no map support anywhere (`+map` is never passed), and no UI edits `launchArgs`.

## Acceptance Criteria

- [ ] **AC1** — Next to Play there is a "Play with…" action that opens a small launch dialog with a
      mod select and a map select.
- [ ] **AC2** — The mod select lists Base game and the installation's game dirs; the map select lists
      the maps available to the chosen mod (its own and baseq2's), sorted by name.
- [ ] **AC3** — Starting from the dialog launches with the chosen mod and loads the chosen map; with
      "No map" the game starts at the menu, as Play does today.
- [ ] **AC4** — The dialog remembers the last choice per installation.
- [ ] **AC5** — A map whose name is not a safe single token is not offered (launch arguments stay
      validated as today).
- [ ] **AC6** — The plain Play button keeps its current behaviour.
- [ ] **AC7** — Maps inside `.pak`/`.pk3` files are listed, not only loose `.bsp` files.

## Open Questions

- **Q1** — Is the map start single-player or a local deathmatch server (`+set deathmatch 1 +map`)?
  `+map` in baseq2 without deathmatch starts a single-player game. Recommendation: a "Game type"
  choice with Deathmatch as the default when a map is picked.
- **Q2** — Does the dialog replace the action bar's mod dropdown, or sit beside it? Recommendation:
  beside it — the dropdown stays the persisted default.
- **Q3** — Should the map list show a levelshot? No (CLAUDE.md: no image assets); name plus the
  map's title from the BSP if cheap.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
