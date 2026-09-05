---
id: 058
title: Care says only what needs doing
status: draft
created: 2026-09-05
---

## Requirement

Care was meant to be the one maintenance surface (story 025). On my current profile there is
nothing to do, and I still get roughly three screens: an "Overview" strip of four status chips plus a
"Not all clear yet - see the sections below" banner (the redundant-copies cleanup is a manual scan
and therefore always "Not checked yet", which alone forces that banner -
`lib/care-summary.ts:204-212`), one panel per engine saying "No findings for this engine", a
full-height "No preserved lines" illustration, a Sync list that also lists the files that are fine,
a Tidy-up header with a disabled "Fix all safe findings (0)" whose explanation is rendered twice
(`CareTidyUpSection.tsx:135-146`) above a second illustration, and the cleanup form waiting for a
scan (`CareTab.tsx:118-139`, six sections, none of which ever collapses). Preserved lines appear twice
(their own panel and as tidy-up rows). Lots of surface, no information - it reads as if every feature
got a section regardless of whether it has anything to say.

What I want: Care is a to-do list. If there is nothing to do, it says so in one calm block and
stops. If there is, each item is one line with what, why and the action - and nothing else on the
screen.

## Acceptance Criteria

- [ ] A healthy profile shows one "All clear" block: one line per thing that was checked (engines
      validated, files in sync, nothing to tidy) - no empty-state illustrations, no disabled buttons,
      no section headers over nothing.
- [ ] "Not all clear" is only ever caused by an actual item; anything that requires a manual scan
      is not a status but an action offered in one line.
- [ ] Every item is one row: title, one-sentence consequence, the action (Fix / Reload / Compare /
      Retry / Drop / Re-classify / Show in Controls / Show in Aliases); rows are grouped by area
      (Config health - Files - Tidy-up) and sorted errors first; a group with no items is not
      rendered.
- [ ] Preserved lines appear exactly once, as tidy-up items with the line text and their Drop /
      Re-classify actions.
- [ ] Files: only files that need attention are listed (out of sync, missing, failed, pending,
      changed outside the launcher); in-sync files are counted in the All clear block; the
      per-installation rows the Raw file tab shows today are consolidated here per story 057's
      decision, keeping open/reveal.
- [ ] "Fix all safe findings" is shown only when at least one safe item exists.
- [ ] The installation-wide redundant-copies cleanup (story 010/025) leaves the profile's Care tab
      (see Open Questions), keeping its scan -> review -> apply -> undo flow and the backup-once
      contract untouched.
- [ ] The tab badge, the deep links, the validation rules and their honesty (per engine, live
      against unsaved edits, an explicit "nothing to validate against" for an unassigned profile)
      are unchanged in substance; a "Show in Controls" deep link exists for findings that name an
      entry (today Care links to Aliases only, `CareTidyUpSection.tsx:199-203`).
- [ ] `npm run ui:verify` covers Care healthy and Care with findings; both stay at zero axe findings.

## Open Questions

1. **Where the redundant-copies cleanup goes:** (a) Library - an action on the installation; (b) a
   single collapsed line at the bottom of Care ("Scan this profile's installations for redundant
   copies"); (c) the app's Settings screen. Recommendation: (a), with (b) as the interim if Library
   has no installation detail surface yet.
2. **The All clear block:** list every engine and file, or one line each ("Validated against r1q2 -
   3 files in sync - nothing to tidy")? Recommendation: one line each.
3. **Refresh:** does Care need an explicit refresh once statuses are lines, or does it stay live as
   today? Recommendation: live.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
