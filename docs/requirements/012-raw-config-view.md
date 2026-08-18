---
id: 012
title: Raw config view with reveal-in-folder
status: draft
created: 2026-08-18
---

## Requirement

As a user, I want to see the physical, rendered text of a profile's config file — exactly what
would be written to disk — so I can verify what the launcher is actually going to produce
without guessing from the UI. From that same view I want to open the folder/file explorer at
the location where that file lives on disk, so I can inspect or hand-edit it myself if needed.

## Acceptance Criteria

- [ ] A profile has a view showing the raw, rendered config file content as plain text, exactly
      as it would be (or was) written to a target installation.
- [ ] The raw view is reachable without leaving the profile's own screens (not buried only inside
      an unrelated write-target flow).
- [ ] From the raw view, an action opens the OS file explorer at the folder containing the
      written file, for an installation the profile is assigned to.
- [ ] If the profile has not been written to any installation yet, this is communicated clearly
      rather than silently failing or opening a folder that doesn't exist.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
