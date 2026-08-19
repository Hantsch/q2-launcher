---
id: 025
title: Validation becomes Care — report, tidy-up actions and sync state in one place
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

"Validation" only ever tells me what is wrong. What I actually want is a **Care** tab: the report,
plus the actions to clean the config up, in the place where the problems are named. Everything
that is maintenance rather than authoring belongs here — including the redundant per-mod config
copies cleanup that currently sits on the profile list, and the out-of-sync state of the profile's
files.

## Acceptance Criteria

- [ ] The tab is called "Care" and still contains the full multi-engine validation report from
      story 009, unchanged in its honesty rules (per engine, equally weighted, explicit "nothing to
      validate against" states, live against unsaved edits).
- [ ] A sync section lists the profile's files (own file + per assigned installation) as
      in-sync / missing / out-of-sync / failed, with a retry for the failed ones (data from story
      022).
- [ ] A tidy-up section offers actions with a preview of exactly what changes before applying, at
      minimum: remove keys bound twice, drop or re-classify imported "preserved lines", remove
      empty layers, remove aliases nothing references, and report bindings referencing an undefined
      alias (story 019).
- [ ] The "Preserved lines" tab is folded in here instead of being its own conditional tab.
- [ ] The installation-wide cleanup of redundant per-mod `.cfg` copies (story 010) moves here from
      the profile list, keeping its scan → review → apply → undo flow and the backup-once contract.
- [ ] Nothing on disk is touched without a preview first, and anything that deletes or overwrites a
      user file stays undoable.
- [ ] With nothing to report and nothing to clean, the tab says so explicitly — it never looks
      identical to "not checked".

## Open Questions

- The mod-copies cleanup is installation-wide, not per profile. Inside a profile's Care tab, does
  it scan only that profile's assigned installations, or stay global with a scope hint?
- Should tidy-up actions be individually applicable only, or is a "fix all safe findings" button
  wanted (and what counts as safe)?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
