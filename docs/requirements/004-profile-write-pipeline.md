---
id: 004
title: Write profile to assigned installations on save
status: draft
created: 2026-08-14
---

## Requirement

As a user, when I save a profile, I want it written to every installation it's assigned to
(except installations currently running), so the settings I configured actually take effect
in the game — not just inside the launcher's own state.

Per [docs/concepts/config-module.md](../concepts/config-module.md#4-core-terms--model): writes
target `<installation>/baseq2`, and `autoexec.cfg` is additionally copied into every mod folder
marked "played" for that installation (`FS_ExecAutoexec` never consults the search path, unlike
everything else). Depends on stories 001–003 (profile content and assignment must exist).
Filesystem writes stay inside the existing path-trust rules — only `baseq2` and known mod
folders of an already-registered installation, never an arbitrary path.

## Acceptance Criteria

- [ ] Saving a profile writes its content into `<installation>/baseq2/` for every non-running
      installation it is assigned to.
- [ ] `autoexec.cfg` is additionally copied into every mod folder the user has marked "played"
      for that installation.
- [ ] A pre-existing file is backed up before its first overwrite; later saves diff rather than
      blindly rewriting.
- [ ] An installation that is currently running is skipped, shown as "pending" in the UI, and
      picked up on the next save (or an explicit retry) once it's no longer running.
- [ ] I can verify on disk (or via a launcher preview) that the written file's content matches
      what I configured in the profile.

## Open Questions

- Detecting "currently running" needs the `game-lifecycle` guard called out for the `mods`
  module in [ROADMAP.md](../ROADMAP.md#mods--game-directories) — confirm during refine whether
  that guard already exists in a reusable form or needs to be built here first.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
