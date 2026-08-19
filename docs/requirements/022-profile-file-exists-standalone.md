---
id: 022
title: A profile is a real <name>.cfg that exists before any assignment
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

A config profile should be a file I can point at, named after the profile (`<name>.cfg`), which
exists as soon as the profile does — regardless of whether it is assigned to an installation.
Today the rendered file only comes into existence inside an installation, under a generated name
(`baseq2/q2l-profile-<id>.cfg`), so an unassigned profile has nothing on disk to look at, open, or
hand to anyone.

Whether a profile is present in a given installation should then be answerable by "is that file
there" instead of by a separate bookkeeping tab, and keeping the copies current should happen
automatically whenever I change something — no manual write step.

This is the on-disk half; the tab that shows and opens the files is story 023.

## Acceptance Criteria

- [ ] Every profile has a canonical file in a launcher-owned location, named from the profile name
      (sanitised, `<name>.cfg`), written when the profile is created and rewritten on every change.
- [ ] An unassigned profile has that file — creating a profile and looking at it needs no
      installation at all.
- [ ] Renaming a profile renames the file; two profiles that sanitise to the same name do not
      overwrite each other.
- [ ] Assigned installations receive their copy automatically on every change (the existing
      debounced-save → write path), with the existing backup-once and diff-skip guarantees intact.
- [ ] The write pipeline reports, per installation, whether the file is present and whether it
      matches the current profile — the data the Care tab (story 025) renders as out-of-sync.
- [ ] A profile whose file cannot be written (locked, missing directory, running installation)
      surfaces as an error state and is retried, not silently dropped.
- [ ] Existing installations keep working: files written under the old `q2l-profile-<id>.cfg` name
      and the `autoexec.cfg` loader that `exec`s them are handled, not orphaned.

## Open Questions

- Does the copy inside an installation also become `<name>.cfg`, or does it keep the id-based name?
  Name-based is what the user sees; id-based is what makes rename safe and the `autoexec.cfg`
  loader stable. Decide before touching `write-plan.ts`.
- If the name changes: migrate/rename existing files inside installations and rewrite the
  `autoexec.cfg` loader line, or leave the old file behind (and then who deletes it)?
- Where is the launcher-owned location — next to `state.json` in userData, or a user-visible
  "profiles" folder they can back up?
- Does the played-mods selection (which gamedirs get a copy, currently `WriteTargets`' checkbox
  list, session-only) survive here, and where is it configured once that tab is gone?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
