---
id: 033
title: Planned-module screens explain the feature, not the engineering
status: draft
created: 2026-08-21
---

## Requirement

`PlannedModuleView` ([src/renderer/src/views/PlannedModuleView.tsx](../../src/renderer/src/views/PlannedModuleView.tsx)),
shown today for Mods and Assets, already carries a "Planned" badge but otherwise reads like an
internal engineering ticket: a generic "{{module}} is not built yet" heading, a "What this module
will need" section that lists raw architecture capability tokens (translated, but still things
like "Write files inside an installation", "Long-running jobs with progress and cancel"), and a
literal `id: mods · route: /mods · ipc: module:mods` debug line at the bottom
(`module.planned.*` keys in
[src/renderer/src/i18n/locales/en.json](../../src/renderer/src/i18n/locales/en.json)).

A user landing on Mods or Assets should immediately understand, in plain language, what that
part of the launcher is for and what will eventually be possible there — not read a capability
checklist meant for the people building it. "Planned for the future" should stay clearly visible
(the badge already does this; strengthen the wording if needed), but the capability list and the
id/route/ipc line are implementation detail that does not belong in front of a user.

## Acceptance Criteria

- [ ] Mods and Assets planned screens show a short, plain-language description of what the
      module is for and what it will let the user do — no engineering/capability terms.
- [ ] The "planned for the future" status stays unambiguous (badge and/or heading wording).
- [ ] The capability list (`module.planned.capabilities` / `module.planned.capability.*`) and
      the `id / route / ipc` debug line are removed from what a user sees. If that information
      is still useful during development, it may be gated behind a dev-only flag instead of
      deleted outright — but the default build must not show it.
- [ ] `module.mods.description` / `module.assets.description` (and `module.install.description`
      if it still renders anywhere) are reviewed and rewritten if they read as technical rather
      than descriptive.
- [ ] `npm run ui:verify` screenshots of the Mods and Assets screens reflect the new copy.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
