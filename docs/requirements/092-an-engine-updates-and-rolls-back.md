---
id: 092
title: An engine updates and rolls back
status: draft
created: 2026-09-12
---

## Requirement

The [install-module concept](../concepts/install-module.md) §10 (INST-U1–U4) covers engine
lifecycle after bootstrap: the pinned manifest version is compared against what an
installation actually has, an update is offered (never automatic), applying it replaces the
engine files while moving the previous ones into a backup inside the installation, and
rollback restores that backup in one step. A per-installation "bleeding edge" opt-in follows
upstream instead of the pinned version. This is the first story to write into an existing,
already-playable installation, so it rides [[091]]'s guard rather than inventing its own.

## Acceptance Criteria

- [ ] **AC1** — An installation whose recorded engine version differs from the manifest's
      pinned version for that engine shows an available update, without downloading or
      changing anything on its own.
- [ ] **AC2** — Applying the update downloads and verifies the package (per INST-V1–V3), then
      replaces the engine files, moving the previous ones into a backup kept inside the
      installation.
- [ ] **AC3** — Rollback restores the most recent backup in one step, without re-downloading
      anything.
- [ ] **AC4** — An installation can opt into "bleeding edge": while enabled, the update check
      compares against the newest upstream build instead of the manifest's pinned version, for
      that installation only.
- [ ] **AC5** — Turning bleeding edge off returns that installation's update check to the pinned
      manifest version.
- [ ] **AC6** — Applying an update or a rollback to an installation whose game is currently
      running waits per [[091]]'s guard rather than overwriting files underneath it.
- [ ] **AC7** — After an update or a rollback completes, the installation's recorded engine
      version reflects what is actually on disk (`detectedVersion`, defined in the model but
      never written today).
- [ ] **AC8** — A failed update (download or verification failure) leaves the installation on
      its previous, working engine files — never a half-replaced state.

## Open Questions

- The bleeding-edge probe mechanism (GitHub release API vs. `version.txt`, rate limits, and
  what can be verified without a manifest-supplied hash) is open point §15.12 of the concept
  and has no decision yet.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
