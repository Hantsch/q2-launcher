---
id: 031
title: Rename the Install module to Downloads and move it next to Settings
status: draft
created: 2026-08-21
---

## Requirement

"Install" currently sits in the primary nav row in
[TitleBar.tsx](../../src/renderer/src/components/shell/TitleBar.tsx) (module manifest order 20
in [src/shared/types/module.ts](../../src/shared/types/module.ts)), between Library and Config,
labelled with icon + text like every other nav entry. Once downloads exist this is really a
status/utility control ("is something downloading, and how much"), not a content section people
browse into — so it belongs with Settings and the window controls on the right, not in the
content nav on the left.

This is a full rename, not just a relabel: the module itself becomes `downloads` end to end —
module id, route, IPC namespace and i18n keys — not just what the user reads. Concretely (exact
list to be confirmed during refine, this is the known surface from a first pass):

- `ModuleId` union and the `install` entry in `MODULE_MANIFESTS`
  ([src/shared/types/module.ts](../../src/shared/types/module.ts)): id → `downloads`, route
  `/install` → `/downloads`, `ipcNamespace` `module:install` → `module:downloads`.
- The `moduleId` enum in
  [src/main/lib/schemas.ts](../../src/main/lib/schemas.ts) (`'install'` → `'downloads'`).
- The commented-out registration placeholders in
  [src/renderer/src/modules/index.ts](../../src/renderer/src/modules/index.ts) (and the
  equivalent on the main side, once it exists).
- `module.install.*` i18n keys in
  [src/renderer/src/i18n/locales/en.json](../../src/renderer/src/i18n/locales/en.json) →
  `module.downloads.*`, plus any `nav.install`-style strings.
- Any other reference to the `install` module id (as opposed to the unrelated "install an
  installation" domain vocabulary, e.g. `installationSchema`, `install-game-files` — those stay,
  they are a different concept and must not be touched).

On top of the rename, move the nav entry out of the primary nav row into its own icon-only
button placed directly left of the Settings gear (`… | Downloads | Settings`), matching the
Settings button's icon-only style. This story is presentation/naming only: it does not add the
running-downloads badge (that is [[032]]), and it does not implement the module's actual
functionality (still `status: planned`, still opens the existing `PlannedModuleView`, now under
the `downloads` id).

## Acceptance Criteria

- [ ] The module formerly known as `install` is fully renamed to `downloads` — id, route,
      IPC namespace, i18n keys — with no leftover reference to the old `install` module id
      anywhere in shared/main/renderer (grep for `'install'` as a `ModuleId`/route/ipc value
      turns up nothing outside history/docs).
- [ ] The nav entry no longer appears in the left-hand primary nav row.
- [ ] A new icon-only button (Download icon, no text label, matching the Settings button's
      style/size) sits directly to the left of the Settings button in the title bar's right
      cluster.
- [ ] Its accessible name/tooltip reads "Downloads".
- [ ] Clicking it routes to `/downloads` and renders `PlannedModuleView` for the `downloads`
      module, unchanged in behaviour.
- [ ] The active-state styling (current bottom-highlight treatment used by primary nav items)
      is adapted to the icon-only right-cluster style already used for Settings, so the button
      visibly shows when `/downloads` is the active route.
- [ ] `npm run ui:verify` screenshots reflect the new position and label.

## Open Questions

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
