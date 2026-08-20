---
id: 028
title: Broken button/nav icons + general design check
status: draft
created: 2026-08-20
---

## Requirement

Icons across the UI appear to be broken. Most clearly visible in the Controls tab
(Config → Controls): custom action rows (e.g. a row named "test") show the outline/box of a
button but no icon inside it, where other rows in the same column render fine. The same kind of
"outline present, icon missing" issue is also visible in the main navigation bar at the top of
the app — icons that used to sit next to/inside the menu are gone.

Beyond the missing icons, the user's general impression is that something about the visual
design has shifted or broken — not just this one icon bug. This story should also produce a
broader design consistency check across the app's surfaces (spacing, icon usage, tokens) to catch
whether this is an isolated icon-rendering bug or a symptom of something wider (e.g. an icon
font/sprite not loading, a broken CSS selector, a regressed build step).

Root-cause analysis and the fix are explicitly **not** done as part of filing this story — they
are the subject of `/refine`, which investigates the cause and turns it into concrete
deliverables (fix + design check) before this goes to `ready`.

## Acceptance Criteria

- [ ] Root cause of the missing icons in the Controls tab action rows (e.g. "test" row) is
  identified and fixed; icons render correctly for all rows, including custom/user-created ones.
- [ ] Root cause of the missing icons in the main navigation bar is identified and fixed; nav
  icons render correctly.
- [ ] A design consistency check has been performed across the app's main surfaces (Home,
  Library, Install, Config tabs, Mods, Assets) confirming icons/spacing/tokens render as intended
  elsewhere, or documenting further issues found.
- [ ] No regression in icon rendering for the rows/elements that already worked before this fix.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
