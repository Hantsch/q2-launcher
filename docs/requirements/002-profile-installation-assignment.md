---
id: 002
title: Profile-installation assignment and default profile
status: draft
created: 2026-08-14
---

## Requirement

As a user, I want to assign a config profile to one or more of my installations, and mark one
assigned profile per installation as the default, so the launcher knows which profile belongs
on which installation and which one applies at launch.

Per [docs/concepts/config-module.md](../concepts/config-module.md), assignment is many-to-many:
a profile can be assigned to several installations, and an installation can have several
assigned profiles. Builds on story 001 (profile CRUD exists). Does not write anything to disk
yet — that is story 004.

## Acceptance Criteria

- [ ] From a profile, I can assign it to, and unassign it from, any of my registered
      installations.
- [ ] An installation can have more than one assigned profile at the same time.
- [ ] Exactly one assigned profile per installation can be marked default; marking a new
      default un-marks the previous one for that installation.
- [ ] Assignment and default state persist across app restarts.
- [ ] For a given installation, I can see which profiles are assigned and which one is
      currently the default.
- [ ] Deleting a profile that is assigned to installations removes those assignments cleanly
      (no orphaned references).

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
