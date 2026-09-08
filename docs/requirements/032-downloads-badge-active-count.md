---
id: 032
title: Downloads icon shows a running-count badge
status: draft
created: 2026-08-21
---

## Requirement

Once the Downloads icon exists ([[031]]), it should tell the user at a glance whether any
downloads are currently running and how many, via a small numeric badge on the icon — the same
pattern used for unread/active counts elsewhere (e.g. app taskbar badges), so a user does not
have to open the Downloads screen just to check.

This story was filed as **future work** while the `downloads` module (renamed from `install` in
[[031]]) was still `status: planned` and produced no jobs. [[071]] (this sprint) makes it the
first real producer of `Job` objects through `JobsService`; this story now has a real source of
truth to bind to instead of a placeholder.

## Acceptance Criteria

- [ ] The Downloads icon shows a small badge with the current number of running/queued
      downloads whenever that number is greater than zero.
- [ ] The badge disappears when no downloads are active.
- [ ] The count is driven by real job state from the downloads module, not a placeholder or a
      count of unrelated jobs (e.g. per-installation repair jobs shown in the action bar stay a
      separate concept unless the downloads module explicitly folds them in).
- [ ] Badge styling matches existing status/badge conventions (see `Badge` in
      [primitives.tsx](../../src/renderer/src/components/ui/primitives.tsx)) rather than
      introducing a new one-off style.

## Open Questions

- The exact data shape to bind the count to (all `downloads`-module jobs, or a filtered subset)
  should be settled once [[071]]'s job producer exists, during this story's own refine.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
