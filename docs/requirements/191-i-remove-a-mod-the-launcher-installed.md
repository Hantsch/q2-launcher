---
id: 191
title: I remove a mod the launcher installed
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player, I remove a mod I installed through the launcher. My own demos, configs and
screenshots in that folder survive. The launcher deletes exactly the files its install record
(story 190) lists, removes the folder only if it is then empty, and never touches a manually
installed mod.

Concept: [mods.md](../concepts/mods.md) §10; requirements MOD-13, MOD-14.

## Acceptance Criteria

- [ ] **AC1** — The detail panel of a catalog-installed mod offers *Remove*, behind a confirmation
      that names the installation and the mod.
- [ ] **AC2** — After removal, every file in the install record is gone from the gamedir.
- [ ] **AC3** — A file in the gamedir that is not in the install record (for example a recorded
      demo under `demos/`) still exists after removal.
- [ ] **AC4** — The gamedir folder is deleted when it is empty after removal, and kept when it is
      not.
- [ ] **AC5** — After removal, the install record is gone, the tile shows *not installed*, and the
      action bar picker no longer offers the mod if its folder was deleted.
- [ ] **AC6** — While the game runs in that installation, removal waits before deleting and says
      so.
- [ ] **AC7** — The remove channel refuses a mod with no install record, and deletes nothing.

## Open Questions

- **Q1** — A recorded file the user has changed since install (its hash differs from the record):
  delete it anyway, keep it, or list it in the confirmation? This is linked to story 190's Q2.
- **Q2** — If the removed mod was the installation's `activeGameDir` and its folder is gone, does
  the installation fall back to the base game silently (today's revalidation behaviour,
  `installations.ts`), or with a visible note?

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
