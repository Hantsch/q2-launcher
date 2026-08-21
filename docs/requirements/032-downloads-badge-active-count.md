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

This story is explicitly **future work**: the `downloads` module (renamed from `install` in
[[031]]) that would actually produce download jobs is still `status: planned` (see
[src/shared/types/module.ts](../../src/shared/types/module.ts)) and does not exist yet. There is
today no source of truth for "how many downloads are running" outside of a single installation's
repair/update `Job` (see [ActionBar.tsx](../../src/renderer/src/components/shell/ActionBar.tsx)).
File this now so the requirement is captured, but do not schedule it before the downloads module
itself is built — refine should re-check the data source once that module lands instead of
inventing a placeholder count.

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

- Blocked on the `downloads` module's job/queue model existing — the exact data shape to bind
  the count to should be settled during that module's own refine, not guessed here.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
