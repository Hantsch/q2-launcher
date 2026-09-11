---
id: 090
title: A demo installation upgrades to retail
status: draft
created: 2026-09-11
---

## Requirement

[[074]] gave a demo installation a visible marker but no way out of the demo state. This story
closes that loop — INST-D4: a demo installation offers an action that imports retail data from a
detected store installation, using the exact copy step [[088]] built, and turns the installation
into a normal, non-demo one without re-running the wizard or re-downloading the engine.

## Acceptance Criteria

- [ ] **AC1** — An installation carrying the Demo marker offers an "import retail data" action,
      reachable from wherever the marker itself appears ([[074]]'s tile, library card and action
      bar).
- [ ] **AC2** — When at least one store installation is detected, the action lets the user pick
      which one to copy retail data from, the same way [[088]]'s wizard step does.
- [ ] **AC3** — When no store installation is detected, the action says so plainly instead of
      offering a picker with nothing in it.
- [ ] **AC4** — Completing the action copies `pak0.pak`/`pak1.pak` (never links) from the chosen
      store installation into the existing installation's own folder, overwriting only the demo
      versions of those files — nothing else in the installation is touched.
- [ ] **AC5** — After the action completes, `inspectInstallation` no longer reports the demo check,
      the Demo marker disappears from tile, library card and action bar, and the installation's
      status is re-derived from the inspector, never hand-set.
- [ ] **AC6** — A chosen store installation whose paks cannot be verified as retail (per [[088]]'s
      AC3 check) is rejected with the same reason, before anything is copied.
- [ ] **AC7** — While the installation's own Quake II process is running, the action is unavailable
      (or refuses to start) rather than overwriting files out from under a running game.

## Open Questions

- Does this action run as a `Job` (visible in the Downloads tab, cancellable, per INST-J1), or is
  a direct copy short enough that it does not need job machinery? [[088]]'s copy step should be
  reusable either way; refine should decide based on how that story actually implements it.
- Should the `video`/`players` toggle from [[074]]/[[088]] apply here too (upgrading also backfills
  those if missing), or is this action scoped to the paks alone?
