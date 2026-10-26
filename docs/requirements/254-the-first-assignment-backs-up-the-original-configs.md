---
id: 254
title: The first assignment backs up the original configs and I can restore them
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, before the launcher writes its config into my installation for the first time, my existing
config files are saved, and I can restore that original state with one button.

User feedback 2026-10-26: before writing the launcher's configs into an installation, back up the existing
ones, so that if writing destroys something of the user's we can return to the original state.

Today `writeTargetFile` (`src/main/modules/config/writer.ts`) overwrites a non-launcher file after
`backupOnce` writes a single `<file>.q2l-backup` next to it, without telling the user, and there is no
restore.

## Acceptance Criteria

- [ ] **AC1** — Assigning a profile to an installation for the first time copies every existing file the
      launcher is about to write (`<profile>.cfg`, `autoexec.cfg` in baseq2 and mod folders) into a backup
      folder inside the installation, before anything is written.
- [ ] **AC2** — Files that do not exist yet are not backed up, and files the launcher does not write are not
      touched.
- [ ] **AC3** — Later writes to the same installation do not replace an already backed-up original.
- [ ] **AC4** — The installation shows a "Restore original configs" action while a backup exists.
- [ ] **AC5** — Restoring, after a confirmation, puts every backed-up file back byte-identical, removes the
      launcher-written files that did not exist before, and unassigns the launcher's profiles from that
      installation.
- [ ] **AC6** — After a restore, the action is gone and assigning again starts a fresh backup.

## Open Questions

## Decisions (Sprint)

- **(User)** Backed up are exactly the files the launcher is about to write into the installation — the
  profile's `<name>.cfg` and `autoexec.cfg` (in baseq2 and any mod folder the loader is copied to) — when
  they already exist. Nothing else.
- **(User)** The backup is taken once, when a launcher config is first assigned to that installation, into
  a backup folder inside the installation; its purpose is to get back to the original state if the
  launcher's write destroys something of the user's.
- **(User)** Restore is a button in the UI, with a confirmation.
- A file first written later (another profile, see 255) joins the same backup folder before it is
  overwritten; the first original of a path always wins.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
