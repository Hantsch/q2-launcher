---
id: 047
title: The message editor is covered by ui:verify like every other surface
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

Story 037 took `npm run ui:verify` to 18/18 screens with zero axe violations and fixed a
form-control labelling defect across the app with a shared `Field`/`useId()` helper. `MessageEditor`
(`src/renderer/src/modules/config/components/MessageEditor.tsx`) was not in the screen registry then
and still is not — so it never got the fix and it never gets a screenshot or an axe pass.
`docs/UI-VERIFICATION.md` names it as a known blind spot.

That matters more than it did before: S07's story 041 grew the message editor (colour cvars used as
`$r`-style text variables are now recognised and rendered there), and S06's story 029 made it the
surface behind the drop-row "With message" checkbox. It is now a real authoring surface that no
automated check has ever looked at.

## Acceptance Criteria

- [ ] `MessageEditor` is a screen registry entry, reachable by the harness through the real UI
      (open a message entry from the Controls tab), screenshotted at both viewports and covered by
      the axe report on every full run.
- [ ] The full run's axe report stays at zero critical/serious/moderate/minor violations with the new
      screen included — any labelling defect the new coverage exposes is fixed, using the existing
      shared `Field`/`useId()` helper rather than a local workaround.
- [ ] The colour-code/`$r` variable rendering story 041 added is visible in the committed screenshot,
      so a regression in it is reviewable from the report alone.
- [ ] `docs/UI-VERIFICATION.md` no longer lists `MessageEditor` as a blind spot, and its screen
      count is updated.
- [ ] The two other reachable blind spots the same section names — `RemoveInstallationDialog` and
      `DetectDialog` — are either added in the same pass or the doc states, per surface, why they
      stay out. No blind spot stays on the list without a reason.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
