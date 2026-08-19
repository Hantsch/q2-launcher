---
id: 023
title: Raw File absorbs Write targets — see and open the profile's file anywhere
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

"Write targets" earns its own tab for nothing: I already know which installations a profile is
assigned to, and whether it landed there is visible from the file itself. The tab goes away and
its useful part moves into **Raw File**.

Raw File should let me navigate to the current profile's file — the profile's own `<name>.cfg`
(story 022) first, which exists even without an assignment, and then the copy in each assigned
installation. I want to look at it in the launcher, and I want to open it in whatever editor I
use, or open its folder.

## Acceptance Criteria

- [ ] The "Write targets" tab is gone; nothing that used to be reachable only there becomes
      unreachable.
- [ ] The automatic write-on-change that `WriteTargets` used to trigger still happens after that
      component is deleted — this is the regression to guard, and a test covers it.
- [ ] Raw File always shows the profile's own file, including for a profile assigned nowhere, with
      its full path visible and selectable.
- [ ] Below it, one entry per assigned installation: path, present/absent on disk, and whether the
      content matches the current profile.
- [ ] Each entry offers "Open in editor" (the OS default application for `.cfg`) and "Reveal in
      folder"; both are disabled with a reason when the file is not on disk.
- [ ] The file content is shown read-only in the launcher, byte-faithful (latin1/high-ASCII, no
      trimming, no reformatting).
- [ ] Switching profiles or installations re-reads the file rather than showing a stale copy.
- [ ] Opening a path goes through main with the usual path validation — no renderer-supplied path
      is trusted, and nothing but the profile's own files can be opened this way.

## Open Questions

- With the tab gone, where do the per-installation write *errors* and the retry live — a state
  chip in this tab's row, or only the Care tab (story 025)?
- Same question for the played-mods selection (see story 022's open question).

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
