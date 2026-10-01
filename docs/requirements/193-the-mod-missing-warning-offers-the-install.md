---
id: 193
title: the mod-missing warning offers the install
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player who wants to watch a demo recorded on a mod I do not have, the mod-missing dialog
(story 182) lets me install that mod instead of only *Play anyway* or *Cancel*, whenever the
catalog has it. *Play anyway* and the "asked once" behaviour stay as they are.

Concept: [mods.md](../concepts/mods.md) §11; requirement MOD-18.

## Acceptance Criteria

- [ ] **AC1** — When a demo's mod is missing and the catalog has an entry of that gamedir name
      (case-insensitive), the mod-missing dialog shows an *Install <mod>* action next to *Play
      anyway*.
- [ ] **AC2** — When the catalog has no entry for that mod, the dialog shows no Install action and
      otherwise looks as it does today.
- [ ] **AC3** — Choosing Install starts story 190's install into the installation the demo would
      play in, and closes the dialog without starting playback.
- [ ] **AC4** — After the install has finished, playing the same demo starts without the
      mod-missing dialog.
- [ ] **AC5** — Choosing Install does not add the mod to the "trusted mods" list that suppresses
      the warning (story 182).

## Open Questions

- **Q1** — Does the demo start automatically when the install finishes, or does the player start
  it again?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
