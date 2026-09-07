---
id: 061
title: Profile header is one row — back left, identity centred, actions right
status: draft
created: 2026-09-07
---

## Requirement

The config profile detail header wastes vertical space and changes shape depending on the tab.
Today (see [ConfigView.tsx:675-750](../../src/renderer/src/modules/config/ConfigView.tsx#L675-L750))
every tab except Raw File gets **two** rows — a row with the back button plus the action cluster,
then a separate block with the profile name, `created` and `updated` — while the Raw File tab
(`isRawFill`, story 057) folds name and tab strip into the single top row to buy editor height.

From the user's side that is two problems in one place:

1. The space in the header row is badly used: the back button sits alone on the left, the actions
   sit on the right, and the middle is empty while the profile's own identity (name, created,
   updated) burns a second row below it.
2. Switching to Raw File **relayouts the header** — the name moves, the created/updated block
   disappears, the tab strip jumps into the header row. The tab a user picks should change the
   panel content, not the frame around it.

Wanted: **one** header row for every tab, three zones — `(← Back to profiles)` left, the profile
identity (name + created/updated + unsaved indicator) centred, the actions (Save/Discard,
Assignments, Rename, Delete) right. The tab strip stays where it is for every tab, Raw File
included, and the header looks identical on all of them.

This supersedes story 057's decision to give the Raw File tab its own folded header — the reason
for it (AC1: at least 30 editor lines visible at 1280x800) is satisfied by a one-row header for
*all* tabs, so the exception is no longer needed. Refine must re-verify that line budget rather
than assume it.

## Acceptance Criteria

- [ ] **AC1** — The profile header is a single row on every tab: back link left, profile identity
      centred, action cluster right.
- [ ] **AC2** — Name, created, updated and the unsaved indicator are all visible in that centred
      zone; no second identity row below the header.
- [ ] **AC3** — Switching between tabs (Overview, Controls, Settings, Aliases, Care, Unsaved, Raw
      File) does not move or change the header, the back link, the identity block, the action
      cluster or the tab strip.
- [ ] **AC4** — At 1280x800 the Raw File editor still shows at least 30 lines (story 057 AC1 stays
      met with the shared header).
- [ ] **AC5** — At a narrow window width the header degrades by wrapping, not by clipping or
      overflowing; every control stays reachable.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
