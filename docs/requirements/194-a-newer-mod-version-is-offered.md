---
id: 194
title: a newer mod version is offered
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player, when the curated catalog pins a newer version of a mod I installed through the
launcher, the Mods view tells me so and lets me update with one click. It never updates by
itself. This is the same model as engine updates: the manifest is the truth, the user decides.

Concept: [mods.md](../concepts/mods.md) §10; requirement MOD-12.

## Acceptance Criteria

- [ ] **AC1** — When the manifest's pinned version of a catalog entry differs from the version in
      the installation's install record, the tile shows *Update available* and the detail panel
      shows both versions.
- [ ] **AC2** — No file in the gamedir changes until the user clicks *Update*.
- [ ] **AC3** — After the update, the gamedir holds the new version's files, the install record
      names the new version and its files, and the tile shows *installed*.
- [ ] **AC4** — A file listed in the old record but not in the new version is removed. A file in
      neither record is kept.
- [ ] **AC5** — A failed update (verification or extraction) leaves the previous version's files
      and record in place, and shows the failure.
- [ ] **AC6** — A manually installed mod never shows *Update available*.

## Open Questions

- **Q1** — Is "newer" any difference from the pinned version (a rollback pin counts as an update
  too, as with engines), or only a higher version?
- **Q2** — A recorded file the user changed since install (hash differs): overwrite, keep, or ask?
  This is the same question as 190 Q2 and 191 Q1, and should get one answer for all three.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
