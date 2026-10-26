---
id: 252
title: I pick a map in the footer and Play starts in it
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, I choose a map next to the mod in the footer, and Play starts straight into that map, so I
can practise or walk a map without going through the game menu.

User feedback 2026-10-26: optionally choose mod and map and start directly into the map — but not on
Servers and Demos, where the server or demo decides.

Story 249 built this as the "Play with…" dialog, but it lives in the Mods module, which is dev-only
(`src/shared/dev-modules.ts`), so release builds have no map choice. The launch plan already supports
`map` (`launch-plan.ts`), and `map` + `connect` are rejected together by the schema.

## Acceptance Criteria

- [ ] **AC1** — In a release build the footer shows a "Map" select next to "Launch with" on Home and Library.
- [ ] **AC2** — The Map select is not shown on Servers and Demos.
- [ ] **AC3** — The Map select lists "No map" first, then the maps available to the chosen mod (its own and
      baseq2's, loose and in archives, as story 249 defined), sorted by name.
- [ ] **AC4** — With a map chosen, Play launches with `+set deathmatch 1 +map <name>` and the chosen mod.
- [ ] **AC5** — With "No map", Play starts at the menu exactly as today.
- [ ] **AC6** — The map choice is remembered per installation across restarts, and Play from the Library card
      and the rail uses it too.
- [ ] **AC7** — Changing "Launch with" to a mod that does not have the chosen map resets the map to "No map".
- [ ] **AC8** — A server join and demo playback never pass the saved map.

## Open Questions

## Decisions (Sprint)

- **(User)** The map choice is a select in the footer next to "Launch with", not a dialog; remembered per
  installation; never shown on Servers and Demos.
- **(User)** A map start is always a local deathmatch (`+set deathmatch 1 +map <name>`); there is no
  game-type choice.
- Recorded at the cut, the user can veto before `/sprint`: the dev-only "Play with…" dialog (story 249) is
  superseded by the footer select and removed; its map listing (`map-list.ts`) and launch support move to
  release code.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
