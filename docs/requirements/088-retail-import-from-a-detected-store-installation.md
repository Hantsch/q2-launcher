---
id: 088
title: Retail import from a detected store installation
status: draft
created: 2026-09-11
---

## Requirement

The bootstrap wizard ([[074]]) can only ever produce a demo installation today — its one data
source is the free download. This story adds the wizard's second data source, described in
[concepts/install-module.md §8](../concepts/install-module.md) step 2 and required by INST-D1,
INST-D2 and the "copy from a detected store installation" half of INST-W2: a user who owns Quake
II on Steam, GOG or Epic picks that installation instead of downloading, and the wizard copies its
retail `pak0.pak`/`pak1.pak` (plus, behind the same optional toggle [[074]] introduced,
`baseq2/video/` and `players/`) into the new installation. The result is a normal (non-demo)
installation from the very first run — turning an existing demo installation into a retail one is
[[090]], not this story.

This story reuses the store detection the launcher already has (Steam's `libraryfolders.vdf`,
GOG's registry entries, Epic's manifests) rather than scanning again, and reuses the engine
step, target-folder step and job/registration machinery [[074]] built — this is a new *data
source*, not a new wizard.

## Acceptance Criteria

- [ ] **AC1** — The wizard's game-data step offers "copy from a detected installation" as a second
      option, alongside the existing free-download option, whenever the store-detection service
      finds at least one Steam, GOG or Epic Quake II installation; the option is absent (not
      shown disabled) when none is found.
- [ ] **AC2** — When more than one store installation is detected, the user picks which one to
      copy from; each is identified by its store and its path.
- [ ] **AC3** — Choosing a detected installation whose `pak0.pak`/`pak1.pak` do not match the
      launcher's known retail sizes tells the user this installation's data could not be
      verified as retail, instead of silently offering to copy it.
- [ ] **AC4** — Running the wizard with this data source copies `pak0.pak` and `pak1.pak` (never
      links or references them) from the chosen installation into the new installation's target
      folder; the free-download engine package for the chosen engine is still fetched and
      verified exactly as [[074]] already does.
- [ ] **AC5** — Before the job starts, the confirm step names the copy source, what will still be
      downloaded (the engine only) and its size, and the target path.
- [ ] **AC6** — The resulting installation is registered with a status computed by
      `inspectInstallation`, exactly as [[074]]'s AC6 requires, and does **not** carry the Demo
      marker [[074]] introduced, since its base data is retail.
- [ ] **AC7** — This data source produces `baseq2` only, same as the free-download path — no
      `ctf`, `xatrix` or `rogue` directory is created even if the source installation has one.

## Open Questions

- Whether a 2023 re-release Steam/GOG installation's `pak0`/`pak1` actually match
  `RETAIL_PAK_SIZES` (classic-edition sizes) is unverified — concept open point 5. If it does not,
  AC3's "could not be verified as retail" path is what a re-release owner will actually see; worth
  confirming during refine whether that is acceptable or whether re-release sizes need their own
  allowance.
- Does the `video`/`players` toggle need its own detected-store availability check (a store
  installation missing `video/` should not offer a toggle it cannot fulfil), or is a copy failure
  for just that toggle acceptable to report after the fact?
