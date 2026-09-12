---
id: 094
title: An installation can be removed from disk
status: draft
created: 2026-09-12
---

## Requirement

The [install-module concept](../concepts/install-module.md) (INST-X1–X3) closes the last open
part of Phase 4 M1: today removing an installation only removes its entry from the library,
never the files on disk. Since the launcher now creates installation folders itself (the
bootstrap wizard, retail import, updates), entry-only removal is no longer enough. Removal
from disk requires a confirmation that shows the path, and is locked for installations whose
`source` is Steam, GOG or Epic — the launcher must never dismantle a store-managed game
folder; those keep entry-only removal with a note that the store uninstalls the game.

## Acceptance Criteria

- [ ] **AC1** — Removing an installation whose `source` is not a store offers a choice between
      entry-only removal and removal from disk.
- [ ] **AC2** — Choosing removal from disk shows a confirmation naming the exact path that will
      be deleted before anything happens.
- [ ] **AC3** — Confirming deletes the installation's own folder and everything inside it, and
      nothing outside that folder.
- [ ] **AC4** — An installation whose `source` is Steam, GOG or Epic offers entry-only removal
      only, with a note that the store uninstalls the game — there is no removal-from-disk
      option to select.
- [ ] **AC5** — Removal from disk on an installation whose game is currently running waits per
      [[091]]'s guard, or is refused with that reason, rather than deleting files out from under
      a running process.
- [ ] **AC6** — After removal from disk, the installation no longer appears anywhere in the
      library, rail or dashboard — the same end state entry-only removal already produces.
- [ ] **AC7** — A removal that fails partway (e.g. a locked file) leaves the library entry in
      place with a readable reason, rather than silently succeeding or losing track of the
      installation.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
