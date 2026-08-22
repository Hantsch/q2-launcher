---
id: 031
title: Rename the Install module to Downloads and move it next to Settings
status: done
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

- [x] The module formerly known as `install` is fully renamed to `downloads` — id, route,
      IPC namespace, i18n keys — with no leftover reference to the old `install` module id
      anywhere in shared/main/renderer (grep for `'install'` as a `ModuleId`/route/ipc value
      turns up nothing outside history/docs).
- [x] The nav entry no longer appears in the left-hand primary nav row.
- [x] A new icon-only button (Download icon, no text label, matching the Settings button's
      style/size) sits directly to the left of the Settings button in the title bar's right
      cluster.
- [x] Its accessible name/tooltip reads "Downloads".
- [x] Clicking it routes to `/downloads` and renders `PlannedModuleView` for the `downloads`
      module, unchanged in behaviour.
- [x] The active-state styling (current bottom-highlight treatment used by primary nav items)
      is adapted to the icon-only right-cluster style already used for Settings, so the button
      visibly shows when `/downloads` is the active route.
- [x] `npm run ui:verify` screenshots reflect the new position and label.

## Open Questions

None — everything open was decided during refine, see `## Decisions (Sprint)`.

## Decisions (Sprint)

- **Nav placement stays data-driven**: the entry gets `nav: { section: 'secondary', order: 10 }`
  and `TitleBar` splits the manifest list by `section` — `secondary` already exists in
  `ModuleManifest` and had no consumer, so this avoids hardcoding a module id into the shell.
- **Icon-only style is shared with Settings**: one local `UtilityButton` in `TitleBar.tsx` serves
  both, so "matching the Settings button's style/size" is structural instead of copy-pasted.
- **Active state = Settings' treatment** (`bg-hover text-flame-300`), not the primary nav's
  bottom flame bar — the right cluster has no bottom edge to hang a bar on.
- **No `nav.downloads` i18n key**: aria-label and tooltip use `t(module.titleKey)` like every
  other nav entry, which reads "Downloads" and keeps one string per concept.
- **The `planned` dot is dropped for secondary entries**: a 32px icon-only button has no room,
  and the target view already carries the "Planned" badge.
- **32px hit area kept** (`size-8`, matching Settings and the window buttons): the titlebar is
  existing desktop-only chrome, so it gets a row in CLAUDE.md's Deviations table for the same
  reason as the Controls/Settings deviations rather than becoming a lone 44px outlier.
- **`module.downloads.description` copy stays as-is** — rewriting planned-module prose is story
  [[033]]'s job; 031 only moves the key.
- **Stale `lastRoute` self-heals**: the route is persisted in settings, so the `useLauncher`
  bootstrap falls back to Home when the remembered route matches no known destination —
  otherwise an upgrading user boots into `/install`, which nothing highlights.
- **The two `setRoute('/install')` repair links** (`ActionBar`, `ChecksList`) point at
  `/downloads`: repairing/downloading game files is still exactly this module's job.
- **One `downloads` screen is added to `ui:verify`'s registry**: it is the only way to see the
  active-state criterion in a screenshot; the *green* axe gate stays story [[037]]'s scope.
- **Domain vocabulary is off limits**: `installationSchema`, `install-game-files`,
  `action.install`, `updateInstallation`, detection comments — a different concept, untouched.
- **Module stays `status: 'planned'`** with unchanged `capabilities`/`requiresInstallation`, and
  no main-process module half is created: 031 is naming + placement only.
- **Manifest array position and the sparse `nav.order` numbers are left alone** (primary keeps
  10/30/40/50, with 20 now free) — nav order comes from `nav.order`, so renumbering is churn.

## Plan

Rename first, relocate second — the rename is compiler-checked, so it is safest as its own pass.

1. **Contract layer** (`src/shared/types/module.ts`): `ModuleId` `'install'` → `'downloads'`;
   the manifest entry's `id`, `titleKey`, `descriptionKey`, `route` (`/downloads`),
   `ipcNamespace` (`module:downloads`) and `nav` → `{ section: 'secondary', order: 10 }`.
   `icon: 'Download'` and `status: 'planned'` stay. `typecheck` then points at every consumer.
2. **Main** (`src/main/lib/schemas.ts` `moduleInvokeSchema` enum, `src/main/ipc/dev.ts`'s
   simulated job `moduleId`, two doc comments under `src/main/modules/`).
3. **Renderer references** (`modules/index.ts` placeholder comment, `i18n/locales/en.json`
   `module.install` → `module.downloads` with title "Downloads", the two `setRoute('/install')`
   call sites, `SettingsView.tsx`'s comment) plus `lastRoute` validation in `useLauncher.ts`.
4. **TitleBar** (`components/shell/TitleBar.tsx`): filter `navModules` to
   `nav.section === 'primary'`; add a `utilityModules` list (`section === 'secondary'`, sorted);
   extract `UtilityButton` from today's inline Settings button and render the utility modules
   with it immediately before Settings, keeping `data-testid="nav-<id>"`. Add the titlebar row
   to CLAUDE.md's Deviations table.
5. **Verification**: add a `downloads` screen to `scripts/lib/screens.mjs`, run
   `npm run typecheck && npm test && npm run build`, then `npm run ui:verify`.

Not in scope: the running-downloads badge ([[032]]), any downloads functionality, and the taller
titlebar ([[030]]) — this plan assumes today's `--titlebar-h` and today's Settings button.

## Deliverables

- [x] **D1 — Rename the module in the shared contract and the main process.**
  Files: `src/shared/types/module.ts`, `src/main/lib/schemas.ts`, `src/main/ipc/dev.ts`,
  `src/main/modules/index.ts` (doc comment), `src/main/modules/library/index.ts` (doc comment).
  Acceptance: `npm run typecheck` and `npm run build` green; `MODULE_MANIFESTS` has
  `id: 'downloads'`, `route: '/downloads'`, `ipcNamespace: 'module:downloads'`,
  `nav: { section: 'secondary', order: 10 }`; no `'install'` left as a `ModuleId`, route or ipc
  value under `src/shared` or `src/main`; installation/domain uses of the word "install"
  untouched.

- [x] **D2 — Rename the module in the renderer and heal the remembered route.**
  Files: `src/renderer/src/i18n/locales/en.json` (`module.install.*` → `module.downloads.*`,
  title "Downloads", description text unchanged), `src/renderer/src/modules/index.ts`,
  `src/renderer/src/components/shell/ActionBar.tsx`,
  `src/renderer/src/components/installations/ChecksList.tsx`,
  `src/renderer/src/views/SettingsView.tsx` (comment),
  `src/renderer/src/store/useLauncher.ts`.
  Acceptance: `npm run typecheck` green; the "Repair" action and the checks list route to
  `/downloads`; a settings file carrying `lastRoute: '/install'` boots to Home instead of a route
  no nav entry highlights; no `module.install` / `nav.install` key left in `en.json`
  (`action.install` stays).

- [x] **D3 — Move the entry into the titlebar's right cluster as an icon-only button.**
  Files: `src/renderer/src/components/shell/TitleBar.tsx`, `CLAUDE.md` (Deviations row).
  Mirror: the existing inline Settings `<button>` in that same file — `UtilityButton` is that
  block extracted, and Settings is refactored onto it in the same pass.
  Acceptance: the primary nav renders Home + Library + Config only; a Download-icon button with
  `data-testid="nav-downloads"`, `aria-label`/`title` "Downloads" and no text sits directly left
  of the Settings gear; clicking it renders `PlannedModuleView` for `downloads`; while
  `/downloads` is the active route the button shows Settings' active treatment; focus-visible
  ring intact.

- [x] **D4 — Cover the new surface in `ui:verify` and record the run.**
  Files: `scripts/lib/screens.mjs` (one `downloads` entry, `variant: 'populated'`, both
  viewports, `navigate` clicks `nav-downloads`).
  Mirror: the `settings` entry in the same file.
  Acceptance: `npm run ui:verify` completes and produces the `downloads` screenshots plus
  refreshed shots of the existing screens showing the relocated button; if axe reports a new
  violation *on the new screen*, note it in `## Done` for story [[037]] instead of widening this
  story.

Coverage: AC 1 → D1 + D2; AC 2, 3, 4, 6 → D3; AC 5 → D1 (route/manifest) + D3 (the click);
AC 7 → D4.

## Model Hints

- D1 → default — a union rename the compiler verifies end to end.
- D2 → default — mechanical key/route rename plus a short bootstrap guard.
- D3 → default — single-file UI change with the pattern to mirror in the same file.
- D4 → default — one registry entry copied from a sibling.
- Review: → story-review-hard — a project-wide identifier rename whose one real failure mode is
  collateral damage to the unrelated "installation / install game files" domain vocabulary, and
  it is the first story of the sprint that [[030]] then builds on top of.

## Test Plan (manual acceptance)

1. Start the app (`npm run dev`, or the build `ui:verify` produces).
2. Title bar: the left nav shows Home, Library, Config — no "Install" and no "Downloads" there.
3. Right cluster: a download-arrow icon button sits directly left of the gear. Hover it — the
   tooltip reads "Downloads"; it carries no text and is the same size as the gear.
4. Click it: the Downloads planned-module page opens (Planned badge, and `id: downloads`,
   `route: /downloads`, `ipc: module:downloads` in the footer line) and the button stays visibly
   highlighted the way the gear does while Settings is open.
5. Click Library, then the download button again — the highlight follows the active route.
6. Tab to the button: it takes focus with a visible focus ring and Enter activates it.
7. Library → an installation that needs repair → "Repair" opens the same Downloads page.
8. Quit while on Downloads and restart: the app reopens on Downloads.

## Done

Renamed the `install` nav module to `downloads` end to end (shared `ModuleId`, manifest
route/ipcNamespace/nav, main-process schema enum and dev-job simulator, renderer i18n keys,
the two repair-link `setRoute` call sites) and relocated its nav entry from the primary left
nav into a new icon-only `UtilityButton` in the titlebar's right cluster, directly left of the
Settings gear, sharing Settings' extracted style/active-state treatment. `useLauncher.ts` now
heals any persisted `lastRoute` that matches no manifest route by falling back to Home. Added
a `downloads` screen to `ui:verify`'s registry and ran it — clean, no new axe violations on the
new screen. A clean-agent review (`story-review-hard`) returned PASS on all 7 acceptance
criteria and found no scope creep, no weakened tests and no collateral damage to the unrelated
"install a game copy" domain vocabulary; two minor leftover-prose findings (old "install
module" wording in `en.json`'s create-installation copy and in `docs/ARCHITECTURE.md`) were
fixed directly after the review, and typecheck/build/test were re-run green afterward.

**Decisions**
- Fixed two review findings directly instead of a second review pass, since both were
  single-line prose corrections with no behavioural risk: `src/renderer/src/i18n/locales/en.json`
  (`create.body`/`create.notice` said "the install module" — now "the downloads module") and
  `docs/ARCHITECTURE.md` (two references to `install` as a module id — now `downloads`). These
  were outside the story's declared file list but are the same rename this story is about, left
  over from an incomplete initial grep scope (AC 1's grep criterion covers `ModuleId`/route/ipc
  values, not free-text prose, so it did not catch them mechanically).
- Left two review findings unfixed as informational/non-blocking: (1) `useLauncher.ts`'s new
  `isKnownRoute()` guard is untested, consistent with the store having no existing test file —
  a pre-existing coverage gap, not a regression introduced here; (2) the story's own D3
  acceptance text ("primary nav renders Home + Library + Config only") undersells the actual
  primary nav (Home/Library/Config/Mods/Assets, correct per this story's own placement
  Decision) — a wording slip in the story file, not in the shipped code.

**Commit message**

```
031: rename install module to downloads, move nav entry next to Settings
```

**Verification**
- `npm run typecheck` — green (both `typecheck:node` and `typecheck:web`).
- `npm run build` — green.
- `npm test` — green, 51 files / 932 tests.
- `npm run ui:verify` — completed clean, 13 screens / 26 shots written, 0 unreachable, 0
  console/page errors; new `downloads@1280x800`/`downloads@940x620` screenshots show the
  relocated button and correct active-state highlighting; no new axe violation on the new
  screen (pre-existing violations on unrelated screens are out of this story's scope, tracked
  under [[037]]).
- Code review (`story-review-hard`, clean agent): **PASS** on all 7 acceptance criteria with
  file:line evidence; no weakened tests, no scope creep, no collateral damage to the
  "installation"/"install game files" domain vocabulary. Two minor findings fixed post-review
  (see Decisions); three further findings judged non-blocking and left as-is.
- No blockers.
