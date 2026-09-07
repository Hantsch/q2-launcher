---
id: 065
title: Installation name carries an engine badge everywhere it is shown
status: draft
created: 2026-09-07
---

## Requirement

An installation's engine decides what a config may contain, so wherever the launcher names an
installation the user wants to see which engine it runs — as a badge next to the name, not as a
detail one screen away.

Some surfaces already do it: the installation rail
([InstallationRail.tsx:258-263](../../src/renderer/src/components/shell/InstallationRail.tsx#L258-L263))
and the hero panel
([HeroPanel.tsx:57-64](../../src/renderer/src/components/shell/HeroPanel.tsx#L57-L64)) render
`engineLabel(engineKind)` in a `Badge`. Others name the installation with no engine information at
all — inside the config module:
[InstallationProfilesPanel.tsx:61](../../src/renderer/src/modules/config/InstallationProfilesPanel.tsx#L61)
and
[ProfileAssignmentsPanel.tsx:62](../../src/renderer/src/modules/config/ProfileAssignmentsPanel.tsx#L62)
— and two more show it as plain meta text rather than a badge
([LibraryView.tsx:245](../../src/renderer/src/views/LibraryView.tsx#L245),
[ActionBar.tsx:91](../../src/renderer/src/components/shell/ActionBar.tsx#L91)).

So this is a consistency story: one badge treatment for the engine, applied to every surface that
shows an installation name, driven by the `engineKind` the record already carries
([installation.ts:63](../../src/shared/types/installation.ts#L63)) — and the badge's own markup
extracted once instead of the `engineKind === 'r1q2' ? 'flame' : 'neutral'` tone expression being
repeated per call site.

## Acceptance Criteria

- [ ] **AC1** — Every surface that shows an installation name shows its engine as a badge next to
      that name: rail, hero, library cards, action bar, and the config module's installation lists
      (`InstallationProfilesPanel`, `ProfileAssignmentsPanel`).
- [ ] **AC2** — The badge is one shared component; no call site repeats the tone-per-engine
      expression.
- [ ] **AC3** — An installation whose engine is `unknown` gets a badge too, labelled as unknown
      rather than blank or omitted.
- [ ] **AC4** — The badge does not squeeze the name out: with a long installation name in a narrow
      panel the name truncates and the badge stays visible.
- [ ] **AC5** — No image assets; badge is CSS/inline SVG per the repo rule.

## Open Questions

- [ ] Was the report about the config module's lists specifically, or about every surface? Filed as
      "every surface" because that is the consistent end state — say so if the scope should be just
      the config module.

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
