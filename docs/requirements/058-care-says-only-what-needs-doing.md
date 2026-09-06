---
id: 058
title: Care says only what needs doing
status: ready
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

1. ~~**Where the redundant-copies cleanup goes**~~ answered → Decisions (Sprint)
2. ~~**The All clear block**~~ answered → Decisions (Sprint)
3. ~~**Refresh**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Redundant-copies cleanup moves to Library, as an action on the installation.
- **(User)** All clear block: one summary line per checked thing (not a full per-engine/file list).
- **(User)** Refresh: Care stays live-updating, no explicit refresh control added.

### Decided during refine

1. **Care becomes one item list, the four panels go away.** `ValidationPanel.tsx`,
   `PreservedLinesPanel.tsx`, `CareSyncSection.tsx` and `CareTidyUpSection.tsx` are deleted (nothing
   else in the app mounts them) and replaced by one shared `CareItemRow` — four section components
   each with their own empty state is the structural cause of the six-screens-of-nothing complaint.
2. **The per-engine report becomes one row per finding, with the engine named on the row.** AC 8
   requires the honesty rules unchanged in *substance*, not the per-engine panel layout; naming the
   engine per row keeps "equally weighted, per engine" true without a header over nothing.
3. **"Nothing to validate against" stays an explicit third state**, neither an item nor part of "All
   clear" — story 025's review finding F2 was exactly a profile with nothing assigned reaching a
   false all-clear, and that regression must not come back.
4. **Care stops tracking cleanup status entirely** (`CareCleanupStatus` and its `notChecked` branch
   leave `care-summary.ts`) — that branch is what forces the permanent "Not all clear" banner the
   requirement names, and with the cleanup in Library there is nothing left to report.
5. **`RawConfigPanel.tsx` is deleted, not remounted.** Story 057's header note expected 058 to
   remount it in Care's Sync, but AC 5 lists only files that *need attention* — a card grid
   previewing every installation copy is precisely the surface this story removes. The retired
   `config-write-preview` ui:verify screen stays retired.
6. **Per-installation file rows keep Open/Reveal through the existing calls** —
   `openProfileFile({ profileId, installationId, mode })` and `app:revealPath`; no new IPC channel,
   so the preload allowlist and the zod payload contract are untouched.
7. **Cleanup in Library = an icon button on the installation row opening a new
   `dialog.kind: 'cleanup'`** that mounts the existing `CleanupPanel` scoped to that one
   installation; the installation picker and the "scan any installation" control disappear because
   the row *is* the scope. This mirrors how rename/remove already work (`LibraryView.tsx:319-344` →
   `components/installations/Dialogs.tsx`), so no new interaction pattern is invented.
8. **`CleanupPanel` stays in `src/renderer/src/modules/config/` and is imported by the library
   surface** — the first cross-module renderer import in this repo, accepted deliberately: the rule
   `docs/ARCHITECTURE.md:177-181` actually guards is the `module:invoke` seam (`moduleId/type`), and
   that is unchanged; the scan/apply/restore logic stays owned by config, Library contributes only
   the trigger. **Dependency call-out:** Library has no per-installation detail view or action
   registry today, so D6 genuinely touches the library view, the dialog switch and the store's
   `dialog.kind` union — it is a Library change, not a config-only move.
9. **"Show in Controls" reuses the existing lifted tab-router state** (`ConfigView.tsx:259-265`
   `goToTab('controls', { focusActionId })`, already used by Overview/Controls deep links); findings
   that name an entry carry an optional `actionId`. No second navigation mechanism.
10. **Validation keeps running against the live draft, tidy-up against the saved profile** (story
    025 decision 3) — unchanged, because tidy-up ops are applied in main to the saved profile.
11. **`ui:verify` gets a second Care screen** (`config-care-clear`, healthy fixture) next to the
    existing findings one — AC 9 names both states, and one screenshot cannot show both.
12. **A raw save's stale installation copies** (the cascade gap story 057 flagged for this story)
    need no new behaviour: they surface by themselves as `outOfSync` file rows with the existing
    Retry action.

## Plan

Care stops being a stack of feature sections and becomes one derived list. A pure model layer
produces `CareItem[]` from the three live sources it already has (validation result, sync rows,
tidy-up findings); the tab renders either an "All clear" block or the grouped rows, and nothing
else. The installation-wide cleanup leaves the profile entirely and becomes an action on the
installation in Library.

1. **Model** — new `lib/care-items.ts`: `buildCareItems({ validation, syncRows, tidyUp })` →
   `CareItem[]` (`{ id, group: 'health' | 'files' | 'tidy', level, titleKey, consequenceKey, params,
   actions[], actionId? }`), grouped and sorted errors-first. `lib/care-summary.ts` is rewritten:
   the cleanup branch drops out, `allClear` becomes "no items *and* every source answered", and it
   gains the summary lines the All clear block prints (engines validated, files in sync (n),
   nothing to tidy).
2. **Shell** — `CareTab.tsx` becomes: All clear block, or groups of `CareItemRow`s. A group with no
   items is not rendered. `ValidationPanel`/`PreservedLinesPanel` unmount and are deleted.
3. **Files group** — the sync fetch in `CareSyncSection.tsx` becomes a `useCareSync` hook; only
   non-`inSync` rows become items (Retry / Reload / Compare kept), each installation row gains
   Open + Reveal; `RawConfigPanel.tsx` is deleted.
4. **Tidy-up group** — tidy-up findings become rows (preserved lines exactly once, with Drop and
   Re-classify); `CareBatchFixDialog` stays, its trigger renders only when at least one safe item
   exists; `CareTidyUpSection.tsx` is deleted.
5. **Deep link** — findings that name an entry carry `actionId`; the row offers "Show in Controls"
   next to the existing "Show in Aliases".
6. **Cleanup moves to Library** — `CleanupPanel` unmounts from `CareTab`, loses its picker/scope
   control, and mounts in a new per-installation dialog reached from the installation row.
7. **Verification** — `screens.mjs` gains `config-care-clear` and the Library cleanup dialog;
   a `ui:flow` script drives one fix end to end.

Order 1 → 2 → 3 → 4 → 5 → 6 → 7. Step 1 must land first (everything renders off it); 6 is
independent of 2–5 and could run in parallel; 7 needs 2 and 6.

## Deliverables

### D1 — The Care item model and the honest summary

New `lib/care-items.ts` (+ test) with `CareItem` and `buildCareItems`, folding validation findings,
non-`inSync` sync rows and tidy-up findings into one grouped, errors-first list; each item carries
its title key, one-sentence consequence key and its available actions. `lib/care-summary.ts` (+ its
test) is rewritten alongside: cleanup drops out of `CareSummaryInput`/`CareSummary`, `allClear`
requires zero items *and* a resolved answer from every source, and the summary exposes the lines the
All clear block prints. Pure model only, no UI.

- Files: `src/renderer/src/modules/config/lib/care-items.ts` (new) + `care-items.test.ts` (new),
  `lib/care-summary.ts`, `lib/care-summary.test.ts`, `src/renderer/src/i18n/locales/en.json`.
- Mirror: `lib/care-sync.ts` for the pure-adapter shape and its test style; `lib/care-summary.ts`'s
  existing `statusFor`/`dedupedFindingCounts` for the counting and dedup rules (keep both).
- Accept: tests pin that a loading or errored sync never yields `allClear`; that an unassigned
  profile (`EngineScopeStatus !== 'ok'`) is neither an item nor "all clear"; that a finding reported
  by both the validator and the tidy-up analyzer produces exactly one item; that errors sort before
  warnings within a group; that a healthy profile yields zero items and the three summary lines.
  Covers AC 1 (data half), AC 2, AC 3 (grouping/sorting), AC 8 (badge dedup unchanged).

### D2 — Care renders a to-do list: All clear block or grouped rows

`CareTab.tsx` is rebuilt around D1: either one All clear block (one summary line per checked thing,
no illustrations, no disabled buttons, no headers over nothing) or the groups that actually have
items, each rendered by a new shared `CareItemRow` (title, one-sentence consequence, action
cluster). The Config health group is wired in this deliverable; `ValidationPanel.tsx` and
`PreservedLinesPanel.tsx` are deleted.

- Files: `src/renderer/src/modules/config/CareTab.tsx`,
  `src/renderer/src/modules/config/CareItemRow.tsx` (new),
  delete `ValidationPanel.tsx` and `PreservedLinesPanel.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: `CareTidyUpSection.tsx:280-400` for row markup, level badges and the non-colour status
  indication; `ValidationPanel.tsx`'s `FindingRow` for the finding-to-text mapping before deleting
  it.
- Accept: a healthy profile shows exactly one block and no other chrome; a profile with findings
  shows one row per finding under a single "Config health" heading with the engine named on the
  row; an unassigned profile still says explicitly that there is nothing to validate against.
  Covers AC 1, AC 3 (row shape).

### D3 — Files group: only what needs attention, with Open and Reveal

The sync fetch moves out of `CareSyncSection.tsx` into a `useCareSync` hook; only rows whose state
is not `inSync` become items (Retry on `failed`, Reload/Compare on the canonical `outOfSync` /
external-edit case, all preserved), and every installation row additionally offers Open and Reveal
through the existing `openProfileFile` / `app:revealPath` calls. In-sync files are only a count in
the All clear block. `CareSyncSection.tsx` and `RawConfigPanel.tsx` are deleted.

- Files: `src/renderer/src/modules/config/lib/use-care-sync.ts` (new),
  `src/renderer/src/modules/config/CareTab.tsx`, `src/renderer/src/modules/config/client.ts`
  (only if `openProfileFile` needs an installation-scoped wrapper),
  delete `CareSyncSection.tsx` and `RawConfigPanel.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: `CareSyncSection.tsx:120-201` for the retry/reload/compare calls before deleting it;
  `RawFileTab.tsx:73-74,194-197` for the open/reveal call shape.
- Accept: with everything in sync the Files group is not rendered and the All clear block names the
  count; deleting one installation's copy on disk makes exactly that row appear as `missing` with a
  working Reveal; a `failed` row still retries; `pending` is still labelled as its own state.
  Covers AC 5.

### D4 — Tidy-up group, preserved lines once, conditional batch fix

Tidy-up findings become rows in the Tidy-up group using D2's `CareItemRow`: preserved lines appear
exactly once with the line text and their Drop / Re-classify actions (the separate preserved-lines
panel is already gone in D2), report-only findings carry no action, and the "Fix all safe findings"
trigger renders only when at least one `mode: 'auto'` finding exists — never as a disabled button
with a duplicated explanation. `CareBatchFixDialog.tsx` is reused unchanged.
`CareTidyUpSection.tsx` is deleted.

- Files: `src/renderer/src/modules/config/CareTab.tsx`,
  `src/renderer/src/modules/config/CareItemRow.tsx`,
  delete `CareTidyUpSection.tsx`, `src/renderer/src/i18n/locales/en.json`.
- Mirror: `CareTidyUpSection.tsx:128-148` (batch trigger) and `:233-266` (`actionsFor`, incl. the
  preserved-line Drop/Re-classify split) before deleting it.
- Accept: a preserved line is visible exactly once in the whole tab, with its text; applying one
  item removes only that row; with zero safe findings there is no "Fix all safe findings" control at
  all; with two, the existing dialog still names both operations before anything changes.
  Covers AC 4, AC 6.

### D5 — "Show in Controls" for findings that name an entry

Tidy-up findings that resolve to a `ConfigAction` carry its `actionId`; the row renders a "Show in
Controls" action next to the existing "Show in Aliases", wired through the existing
`goToTab('controls', { focusActionId })` tab-router state.

- Files: `src/renderer/src/modules/config/lib/tidy-up-findings.ts` (+ its test),
  `src/renderer/src/modules/config/CareItemRow.tsx`,
  `src/renderer/src/modules/config/CareTab.tsx`,
  `src/renderer/src/modules/config/ConfigView.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: `ConfigView.tsx:830-832` (`onNavigateToAlias` → `goToTab('aliases', { alias })`) for the
  wiring; `ALIAS_LINK_KINDS` (`CareTidyUpSection.tsx:199-203`) for the kind-gating pattern.
- Accept: a shadowed-bind finding offers "Show in Controls" and the click lands on that row in
  Controls with it focused; a finding that names no entry offers no such link; the existing Aliases
  deep link still works. Covers AC 8 (deep-link half).

### D6 — The redundant-copies cleanup becomes an action on the installation (Library)

`CleanupPanel` unmounts from `CareTab` and loses its installation picker, its "scan any
installation" scope control and its `onStatusChange` callback; it is mounted instead by a new
per-installation dialog opened from an icon button on the installation row in Library. Scan →
review → apply → undo and the backup-once contract are untouched.

- Files: `src/renderer/src/views/LibraryView.tsx`,
  `src/renderer/src/components/installations/Dialogs.tsx`,
  `src/renderer/src/components/installations/CleanupConfigCopiesDialog.tsx` (new),
  `src/renderer/src/store/useLauncher.ts` (add `'cleanup'` to the `dialog.kind` union),
  `src/renderer/src/modules/config/CleanupPanel.tsx`,
  `src/renderer/src/modules/config/CareTab.tsx`, `src/renderer/src/i18n/locales/en.json`.
- Mirror: `RenameInstallationDialog.tsx` + its `Dialogs.tsx` case for the dialog wiring;
  `LibraryView.tsx:319-325` for the icon-button-opens-dialog row action.
- Accept: the Care tab contains no cleanup surface and never says "not checked"; the installation
  row has a cleanup action; the dialog scans only that installation; a scan → apply → **Undo
  removal** round trip restores the file byte-for-byte and `src/main/modules/config/cleanup.test.ts`
  stays green untouched. Covers AC 7, and AC 2's "manual scan is not a status".

### D7 — Verification: two Care screens, the Library dialog, one flow

`scripts/lib/screens.mjs` gains `config-care-clear` (healthy fixture profile) next to the existing
`config-care` (findings fixture) and a screen for the new Library cleanup dialog; a `ui:flow` script
drives one Care item from listed to fixed.

- Files: `scripts/lib/screens.mjs`, `scripts/flows/` (new flow script, name it `care-fix-item`),
  `docs/UI-VERIFICATION.md` (screen count only if it states one).
- Mirror: the existing `config-care` entry (`screens.mjs:399-405`) and S12's `raw-inline-edit` flow
  script for the flow shape.
- Accept: `npm run ui:verify` is exit 0 with zero axe violations at every impact level across both
  Care screens and the new dialog; `npm run ui:flow -- care-fix-item` applies one tidy-up item and
  asserts the row is gone and the All clear block appears. Covers AC 9.

## Coverage

| AC | Deliverable |
| --- | --- |
| Healthy profile shows one "All clear" block, nothing else | D1 (rollup + lines), D2 (render) |
| "Not all clear" only from an actual item; manual scan is an action, not a status | D1 (cleanup leaves the rollup), D6 (the scan becomes a Library action) |
| Every item is one row, grouped, errors first, empty group not rendered | D1 (grouping/sorting), D2 (row + groups), D3/D4 (the Files/Tidy-up groups) |
| Preserved lines appear exactly once with Drop / Re-classify | D4 (panel already deleted in D2) |
| Files: only what needs attention; in-sync counted; per-installation rows keep open/reveal | D3 |
| "Fix all safe findings" only when a safe item exists | D4 |
| Redundant-copies cleanup leaves the Care tab, flow + backup-once intact | D6 |
| Validation honesty, badge, deep links unchanged; new "Show in Controls" | D1 (badge/honesty), D2 (nothing-to-validate-against state), D5 (deep link) |
| `ui:verify` covers Care healthy and Care with findings, zero axe findings | D7 |

## Model Hints

- D1 → **deliverable-hard** — the `allClear` rollup is exactly where story 025's review found two
  real regressions (a false all-clear for an unassigned profile, and a summary that vanished when
  the sync fetch errored), and this deliverable rewrites it while removing one of its inputs.
- D2 → default (a render of D1's model; three panels deleted, but nothing else mounts them).
- D3 → default (a hook extraction plus row wiring, both with mirrors in the file being deleted).
- D4 → default (rows over findings the analyzer already classifies; the batch dialog is reused).
- D5 → default (one optional field plus the existing deep-link wiring).
- D6 → **deliverable-hard** — this relocates a flow that deletes files from a user's game folder
  across a module boundary, and a broken picker/scope prop could point its scan or its backup-once
  undo at the wrong installation.
- D7 → default.
- Review: → **story-review-hard** — the story deletes four mounted panels, rewrites the badge/
  all-clear honesty rules another story's review already had to fix twice, and moves a destructive
  disk flow into a different module; the review has to hunt silent regressions, not judge new code.

## Test Plan (manual acceptance)

Run `npm run dev` and drive the real UI (P1: every step is a real user action).
`npm run ui:verify` afterwards for the screenshot + accessibility gate.

1. Config → open a healthy profile with an assigned, in-sync installation. **Care** shows one block:
   the engines that were validated, the number of files in sync, nothing to tidy. There is no
   "Not all clear" banner, no empty-state illustration, no disabled button, no section header.
2. In **Controls**, bind one key in two entries. Care now shows a **Tidy-up** group with one row:
   title, one sentence of consequence, an Apply action — and no other group. Apply it; the row goes
   and the block from step 1 returns.
3. Open a profile imported from disk (fixture `PROFILE_UNRECOGNIZED`). Its preserved lines appear
   **once**, in Tidy-up, each with its line text and both **Drop** and **Re-classify**. There is no
   separate preserved-lines panel anywhere in the tab.
4. On that profile the **Fix all safe findings** control is present (safe items exist); on the
   healthy profile from step 1 it is absent — not disabled.
5. Delete one assigned installation's copy on disk and re-enter Care: a **Files** group appears with
   exactly that one row (`missing`), offering **Open** and **Reveal**. The other, in-sync
   installations are not listed — they are the count in the All clear line.
6. Open a profile with **no installation assigned**: Care says explicitly that there is nothing to
   validate against, and does *not* claim "All clear".
7. On a shadowed-bind row press **Show in Controls** — Controls opens with that entry focused. On an
   unreferenced-alias row **Show in Aliases** still works.
8. Go to **Library**. The installation row has a cleanup action; open it, scan, review, apply, then
   **Undo removal** — the file is back byte-for-byte. Return to Config → Care: there is no cleanup
   surface and nothing that says "not checked yet".
9. `npm run ui:verify` — both `config-care` and `config-care-clear` screenshot, zero axe findings at
   every impact level.

## Done
