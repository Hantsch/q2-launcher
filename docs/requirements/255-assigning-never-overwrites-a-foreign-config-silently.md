---
id: 255
title: Assigning a profile never overwrites a foreign config silently
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, assigning a launcher profile to an installation never silently replaces a config file of
mine that happens to have the same name.

User feedback 2026-10-26: when a config is assigned to an installation, check whether a config with that
name already exists, so an existing config is not overwritten.

Today the profile file name (`<sanitized-profile-name>.cfg`) is checked only against the launcher's own
profiles; a foreign `baseq2/<name>.cfg` is backed up once and overwritten without a prompt.

## Acceptance Criteria

- [ ] **AC1** — Assigning a profile whose file name matches an existing file in the installation that the
      launcher did not write opens a dialog naming the file and the installation, before anything is
      written.
- [ ] **AC2** — "Cancel" leaves the assignment undone and the existing file byte-identical.
- [ ] **AC3** — "Write" backs up the existing file (story 254's folder), then completes the assignment.
- [ ] **AC4** — A file that the launcher wrote itself (ownership stamp) is updated without the dialog.
- [ ] **AC5** — Assigning to several installations at once asks once per conflicting installation; the
      others are assigned normally.

## Open Questions

## Decisions (Sprint)

- **(User)** When a file with the profile's file name already exists and was not written by the launcher,
  the assignment stops and asks: "Write (the existing file is backed up first)" or "Cancel". Cancel leaves
  the user to rename the profile; there is no automatic free name.
- The backup taken on "Write" goes into story 254's backup folder.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
