---
id: 025
title: Validation becomes Care — report, tidy-up actions and sync state in one place
status: done # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

"Validation" only ever tells me what is wrong. What I actually want is a **Care** tab: the report,
plus the actions to clean the config up, in the place where the problems are named. Everything
that is maintenance rather than authoring belongs here — including the redundant per-mod config
copies cleanup that currently sits on the profile list, and the out-of-sync state of the profile's
files.

## Acceptance Criteria

- [x] The tab is called "Care" and still contains the full multi-engine validation report from
      story 009, unchanged in its honesty rules (per engine, equally weighted, explicit "nothing to
      validate against" states, live against unsaved edits).
- [x] A sync section lists the profile's files (own file + per assigned installation) as
      in-sync / missing / out-of-sync / failed, with a retry for the failed ones (data from story
      022).
- [x] A tidy-up section offers actions with a preview of exactly what changes before applying, at
      minimum: remove keys bound twice, drop or re-classify imported "preserved lines", remove
      empty layers, remove aliases nothing references, and report bindings referencing an undefined
      alias (story 019).
- [x] Alongside individual apply, a "fix all safe findings" button applies every finding the
      tidy-up section classifies as safe in one step, behind an explicit pre-apply warning that
      names what it is about to change; it is disabled and says so when nothing is classified safe.
- [x] The "Preserved lines" tab is folded in here instead of being its own conditional tab.
- [x] The installation-wide cleanup of redundant per-mod `.cfg` copies (story 010) moves here from
      the profile list, keeping its scan → review → apply → undo flow and the backup-once contract.
- [x] Nothing on disk is touched without a preview first, and anything that deletes or overwrites a
      user file stays undoable.
- [x] With nothing to report and nothing to clean, the tab says so explicitly — it never looks
      identical to "not checked".

## Open Questions

- ~~The mod-copies cleanup is installation-wide, not per profile. Inside a profile's Care tab, does
  it scan only that profile's assigned installations, or stay global with a scope hint?~~ answered
  → Decisions (Sprint)
- ~~Should tidy-up actions be individually applicable only, or is a "fix all safe findings" button
  wanted (and what counts as safe)?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Mod-copies cleanup inside a profile's Care tab scans only that profile's assigned
  installations, with a hint pointing at the global cleanup for everything else.
- **(User)** A "fix all safe findings" button is in scope alongside individual apply. It carries an
  explicit warning before running (what it is about to change, in line with the existing
  preview-before-apply rule) — "safe" is whatever the tidy-up section already classifies as an
  automatic, non-destructive action per its own preview.

### Decided during refine

1. **Tab id and label rename together:** `DetailTab`'s `'validation'` becomes `'care'`,
   `config.tabs.validation` becomes `config.tabs.care`, and `scripts/lib/screens.mjs` renames
   `config-validation` → `config-care` and drops `config-preserved` — the ui:verify harness
   addresses tabs by their `DetailTab` id (`config-tab-<tabId>`), so a rename that skips the
   harness silently breaks the live-smoke gate instead of failing loudly.
2. **Care is a section stack in a new `CareTab.tsx`; `ValidationPanel`, `PreservedLinesPanel` and
   `CleanupPanel` are mounted as sections, not rewritten** — AC 1 and AC 5 both demand existing
   behaviour "unchanged", and re-mounting keeps that literal instead of trusting a rewrite.
3. **The validation report keeps validating the live draft (story 009 untouched); the tidy-up
   section computes against the *saved* profile** — tidy-up applies in main to the saved profile,
   so a preview computed on unsaved draft state would promise a change apply would not make.
4. **The sync section reads through exactly one renderer adapter,
   `modules/config/lib/care-sync.ts`** — story 022 is being refined in parallel, so confining the
   dependency on its final field/handler names to one file keeps a naming change at one file plus
   its test rather than spread through the UI.
5. **State mapping:** `in-sync` = file present and content matches, `out-of-sync` = present but
   differs, `missing` = not present, `failed` = write error; a write deferred because the
   installation is running keeps its existing `pending` status as an explicitly labelled fifth
   state — collapsing a deliberately deferred write into "out-of-sync" would report a failure
   where the launcher chose to wait.
6. **Sync rows cover the profile's own canonical file plus one row per assigned installation**, in
   that order — AC 2 names both, and the canonical file is the one that exists without any
   assignment (story 022).
7. **Retry is a per-row action on failed rows and calls the existing `writeConfigProfile`
   path** (the same call `WriteTargets` used before story 023 deleted it) — story 022 owns the
   retry mechanics, 025 only owns the trigger, and a second write entry point would be a second
   place for the running-installation guard to be forgotten. The build step greps that no retry
   affordance survives anywhere else after 023.
8. **Tidy-up items are their own derived model (`TidyUpFinding`), not an extension of `Finding`** —
   a `Finding` carries a translated fix *hint*, a tidy-up item needs machine-readable operations,
   and overloading `Finding` would force every validator rule to answer "am I fixable".
9. **Tidy-up mutations go through one new atomic handler `tidyUp.apply`, taking explicit operation
   descriptors, not through the four existing whole-field setters** — a re-classify touches
   `unrecognized` plus one of `cvars`/`binds`/`actions`, and two setter calls would bump
   `updatedAt` twice and write two half-tidied files to disk; `unrecognized` also has no setter
   today.
10. **Main re-validates every operation against the current profile and returns rejects rather
    than throwing** — mirrors `cleanup.apply`'s re-scan guard, the pattern this module already
    uses for "the renderer's list may be stale".
11. **"Safe" = fully determined without a user choice AND removes only something that has no
    effect in the rendered config.** That makes *remove shadowed duplicate bind* and *remove empty
    layer* safe/`auto`; *drop or re-classify a preserved line* and *remove an unreferenced alias*
    are `review` (individual apply only — they need a choice or destroy authored content); *binding
    references an undefined alias* is `report` (no automatic fix; removing the bind or inventing
    the alias is a judgement call, and AC 3 only asks that it be reported).
12. **The duplicate-bind fix keeps the binding that actually wins in the rendered file and removes
    the shadowed ones** — in Quake II the last `bind` for a key wins, so the shadowed entries have
    no in-game effect and removing them is provably inert, which is what makes this one safe.
13. **"Fix all safe findings" opens a modal listing every operation it will run, grouped by
    category, with an explicit warning line; it is disabled with an explicit "nothing classified
    safe" label at count 0** — AC 6 forbids touching anything without a preview, and the batch
    button is the one place a per-row preview cannot serve.
14. **One cleanup surface only: `CleanupPanel` leaves the profile-list screen for the Care tab,
    its installation picker restricted to the profile's assigned installations, plus an explicit
    "scan any installation" widening control** — that satisfies AC 5's move literally and the
    (User) decision's profile scoping *and* its route to the rest, without leaving two duplicate
    cleanup surfaces behind.
15. **The cleanup's scan → review → apply → undo flow, its handlers and its backup-once contract
    are untouched; only the installation list is filtered and the scope control is added** — AC 5
    requires the flow and contract intact, so this is a props change, not a rewrite.
16. **The preserved-lines section is always present with its own empty state**, never conditional —
    AC 4 removes the conditional tab, and a section that vanishes reintroduces exactly the
    "is it clean or unchecked" ambiguity AC 7 forbids.
17. **AC 7's empty state is a Care-level summary at the top of the tab that distinguishes "all
    clear" from "not checked yet"** — the cleanup scan is the one section that needs a user action
    before it can say anything, so a single flat "nothing to do" would be a false all-clear.
18. **The tab badge counts validation findings and tidy-up findings together, de-duplicated by
    finding id, errors before warnings** — the tab is now the single maintenance surface, a badge
    counting only the validation half would hide the actionable items, and the alias rules feed
    both lists so a naive sum would double-count them.
19. **i18n: new keys under `config.care.*` in `en.json` only**; `config.validation.*`,
    `config.preservedLines.*` and `config.cleanup.*` keys keep their names — only `en` ships
    (CLAUDE.md), and renaming keys whose panels are unchanged is churn without a reader.

## Plan

Rename the tab, then grow it into the module's one maintenance surface: the untouched story-009
report, a sync section fed by story 022, a new tidy-up section, the folded-in preserved lines, and
the relocated mod-copies cleanup — with a Care-level summary on top that can say "all clear".

1. **Rename + shell** — `DetailTab` `'validation'` → `'care'`, drop the conditional `'preserved'`
   tab, new `CareTab.tsx` that stacks sections and mounts `ValidationPanel` and
   `PreservedLinesPanel` as the first two. `screens.mjs` renamed/pruned in the same step.
2. **Sync section** — `lib/care-sync.ts` maps story 022's per-installation present/matches/error
   data (plus the existing `WriteTargetStatus`) onto
   `in-sync | out-of-sync | missing | failed | pending`, one row for the canonical file and one per
   assigned installation; `CareSyncSection.tsx` renders them and puts a retry on failed rows.
3. **Tidy-up contract + applier** — `src/shared/config/tidy-up.ts`: the `TidyUpOp` descriptors and
   a pure `applyTidyUpOps(profile, ops)`; `tidyUp.apply` in `CONFIG_HANDLERS`, its zod schema, and
   a main handler that re-validates ops against the live profile and returns rejects.
4. **Tidy-up analyzer** — `lib/tidy-up-findings.ts`: compose `findBindConflicts` (with the
   render-order winner), `generateLayerAliases`' `layer.empty` issues, `validateActions`'
   `aliasUnreferenced`/`undefinedAlias`/`aliasDuplicate` and `profile.unrecognized` into
   `TidyUpFinding[]` carrying `mode: 'auto' | 'review' | 'report'` and their ops.
5. **Tidy-up UI** — `CareTidyUpSection.tsx`: grouped findings, per-finding before/after preview,
   individual apply; then the "fix all safe findings" button with its warning modal.
6. **Cleanup moves** — `CleanupPanel` unmounts from the list screen, mounts in `CareTab` with an
   `installations` prop and a scope control.
7. **Summary + badge** — Care-level all-clear / not-checked summary and the de-duplicated tab
   badge, last, because it needs every section's counts.

Order 1 → 2 → 3 → 4 → 5 → 6 → 7. Step 2 depends on story 022 having landed; steps 3–5 depend on
nothing outside this story. Step 1 must land before 6/7 so there is a tab to mount into.

## Deliverables

### D1 — Validation becomes Care, Preserved lines folds in [x]

Rename the tab id/label, delete the conditional `preserved` tab, and introduce `CareTab.tsx` as a
section stack whose first two sections are the unchanged `ValidationPanel` and
`PreservedLinesPanel` (the latter now always present, with an explicit "no preserved lines" empty
state). Update the ui:verify screen list in the same step.

- Files: `src/renderer/src/modules/config/ConfigView.tsx`,
  `src/renderer/src/modules/config/CareTab.tsx` (new),
  `src/renderer/src/modules/config/PreservedLinesPanel.tsx` (empty state only),
  `src/renderer/src/i18n/locales/en.json`, `scripts/lib/screens.mjs`.
- Mirror: `ControlsTab.tsx` for a tab component that composes sections; the existing
  `validation`/`preserved` entries in `screens.mjs` for the screen shape.
- Accept: the tab reads "Care"; no `preserved` tab exists; the validation report renders
  identically to before inside it; `npm run ui:verify --screens=config-care` produces a screenshot
  and the accessibility report stays clean. Covers AC 1 (naming + report intact) and AC 4.

### D2 — Sync section: five states, one adapter, retry on failure [x]

`lib/care-sync.ts` (+ test) turns story 022's per-installation sync data and the existing
`WriteTargetResult`/`WriteState` into `CareSyncRow[]`
(`{ target: 'canonical' | installationId, path, state, messageKey? }`) with
`state: 'inSync' | 'outOfSync' | 'missing' | 'failed' | 'pending'`. `CareSyncSection.tsx` renders
one row for the profile's own file and one per assigned installation, each with a non-colour state
indicator, and a retry button on `failed` rows calling `writeConfigProfile`.

- Files: `src/renderer/src/modules/config/lib/care-sync.ts` (new) + `care-sync.test.ts` (new),
  `src/renderer/src/modules/config/CareSyncSection.tsx` (new),
  `src/renderer/src/modules/config/CareTab.tsx`,
  `src/renderer/src/modules/config/client.ts` (only if story 022 left no wrapper for its query),
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: the deleted `WriteTargets.tsx` (git history) for the row layout and its retry call;
  `src/renderer/src/components/installations/ChecksList.tsx` for status-row markup.
- Accept: unit tests pin all five states including a running installation staying `pending`; in the
  app, an assigned installation whose file was deleted on disk shows `missing`, and a failed write
  shows `failed` with a working retry. Covers AC 2.

### D3 — Tidy-up operation contract and atomic applier [x]

`src/shared/config/tidy-up.ts`: `TidyUpOp` as a discriminated union
(`removeShadowedBind`, `removeEmptyLayer`, `removeUnreferencedAlias`, `dropPreservedLine`,
`reclassifyPreservedLine`) plus a pure `applyTidyUpOps(profile, ops): { profile, applied, rejected }`
that re-checks each op against the profile it is given. Then the contract and handler:
`CONFIG_HANDLERS.tidyUpApply = 'tidyUp.apply'`, `TidyUpApplyInput/Result` in
`src/shared/modules/config.ts`, a zod payload in `schemas.ts`, and a handler that loads the
profile, applies the ops in one write, and triggers the existing write-to-installations path once.

- Files: `src/shared/config/tidy-up.ts` (new) + `tidy-up.test.ts` (new),
  `src/shared/modules/config.ts`, `src/main/modules/config/schemas.ts`,
  `src/main/modules/config/index.ts`, `src/main/modules/config/index.test.ts`.
- Mirror: the `cleanup.scan/apply/restore` block in `src/main/modules/config/index.ts` for the
  handler + re-validate + return-rejects shape; `setActions`/`setLayers` for the save-and-write
  tail; `src/shared/config/validate-actions.ts` for pure-shared file style.
- Accept: tests prove each op type, that a stale op (the layer already gone, the bind already
  changed) is returned as a reject and mutates nothing, that a `reclassifyPreservedLine` updates
  `unrecognized` and its target field in the same result, and that `updatedAt` bumps exactly once
  for a batch. Covers AC 6 (main side: nothing applies that was not previewed and still true).

### D4 — Tidy-up analyzer with the safe/review/report classification [x]

`lib/tidy-up-findings.ts` (+ test): `analyzeTidyUp(profile): TidyUpFinding[]`, each
`{ id, kind, mode: 'auto' | 'review' | 'report', level, messageKey, params, ops, sourceFindingId? }`.
Sources: `findBindConflicts` — resolving which owner wins in render order and emitting
`removeShadowedBind` ops for the rest; `generateLayerAliases`' `layer.empty` issues;
`validateActions`' `aliasUnreferenced` (review), `undefinedAlias` (report) and `aliasDuplicate`
(report); `profile.unrecognized` (review, drop or re-classify). Classification per Decision 11.

- Files: `src/renderer/src/modules/config/lib/tidy-up-findings.ts` (new) +
  `tidy-up-findings.test.ts` (new), `src/renderer/src/i18n/locales/en.json`.
- Mirror: `src/renderer/src/modules/config/lib/validation-scope.ts` for the pure-aggregator shape
  and its test style; `lib/bind-conflicts.ts` for the conflict source; `src/shared/config/render.ts`
  for the emission order that decides the duplicate-bind winner.
- Accept: tests cover a key bound by two actions (only the loser gets an op), a key bound in a
  layer vs. base (not a conflict), an empty layer, an alias nobody calls, a bind calling a missing
  alias (`report`, zero ops), and a preserved line offering both drop and re-classify; `auto`
  contains exactly the shadowed-bind and empty-layer findings. Covers AC 3 (detection half).

### D5 — Tidy-up section: grouped findings, per-item preview, individual apply [x]

`CareTidyUpSection.tsx`: findings grouped by kind with a count per group, each row showing its
level, subject and mode; a `review`/`auto` row expands to a before/after preview of exactly the
lines its ops change and only then offers Apply; a `report` row offers no apply and says why. A
preserved-line row offers Drop and Re-classify as two distinct actions. Applying calls
`tidyUp.apply` through a new `client.ts` wrapper, re-runs the analyzer on the response and reports
rejects inline.

- Files: `src/renderer/src/modules/config/CareTidyUpSection.tsx` (new),
  `src/renderer/src/modules/config/client.ts`,
  `src/renderer/src/modules/config/CareTab.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: `CleanupPanel.tsx` for the scan → review → apply → result rhythm and its result/reject
  rendering; `PreviewProfileDialog.tsx` for read-only preview markup; `ValidationPanel.tsx` for
  finding-row layout and level badges.
- Accept: in the app, each of the five item classes appears with a preview naming the exact change;
  Apply on one item changes only that item and the report above updates; a report-only item has no
  Apply. Covers AC 3 (UI + preview half) and AC 6 (preview-before-apply).

### D6 — "Fix all safe findings" with an explicit pre-apply warning [x]

A button in the tidy-up section header labelled with the count of `auto` findings, disabled with an
explicit "nothing classified safe" label at zero. It opens a modal that lists every operation it
will run, grouped by category, above a warning line stating that these changes are applied to the
profile in one step, with Cancel / Apply. Apply sends all `auto` ops in a single `tidyUp.apply`
call and shows applied/rejected counts.

- Files: `src/renderer/src/modules/config/CareTidyUpSection.tsx`,
  `src/renderer/src/modules/config/CareBatchFixDialog.tsx` (new),
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: `CleanupPanel.tsx`'s `confirmOpen` + `Modal` footer confirm flow (L283-316) for the
  warning dialog; `DeleteProfileDialog.tsx` for the destructive-confirm wording pattern.
- Accept: with two safe findings the button reads "2", the modal names both operations before
  anything changes, Cancel changes nothing, Apply clears both in one save; with none it is disabled
  and says why. Covers the new "fix all safe findings" criterion.

### D7 — Mod-copies cleanup moves into Care, scoped to the profile [x]

`CleanupPanel` unmounts from `ConfigView`'s list screen and mounts in `CareTab`, gaining
`installations` (the profile's assigned installations) and a "scan any installation" scope control
that widens the picker to all installations, with a hint line explaining the default scope. Scan,
review, apply, undo and the backup-once contract are unchanged.

- Files: `src/renderer/src/modules/config/CleanupPanel.tsx`,
  `src/renderer/src/modules/config/ConfigView.tsx`,
  `src/renderer/src/modules/config/CareTab.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: `CleanupPanel.tsx` itself — this is a props + picker change, not a rewrite;
  `EngineScopeSelect.tsx` for a scope control's wording.
- Accept: the list screen no longer shows a cleanup panel; the Care tab's picker offers only the
  profile's assigned installations until the scope control is used; a scan → apply → undo round
  trip still restores the file byte-for-byte and existing `cleanup.test.ts` stays green. Covers
  AC 5 and AC 6 (undoable disk change).

### D8 — Care summary: all clear vs. not checked, and the de-duplicated tab badge [x]

A summary at the top of `CareTab` that states, per section, whether it is clean, has n items, or
has not been checked yet (cleanup, which needs a scan) — and one overall line that only says "all
clear" when every section is clean *and* the cleanup has been scanned. The `ConfigView` tab badge
now counts validation findings plus tidy-up findings, de-duplicated by finding id, errors before
warnings.

- Files: `src/renderer/src/modules/config/CareTab.tsx`,
  `src/renderer/src/modules/config/lib/care-summary.ts` (new) + `care-summary.test.ts` (new),
  `src/renderer/src/modules/config/ConfigView.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: `lib/validation-scope.ts`'s `totalCounts` for the counting helper and its test style;
  `ConfigView.tsx`'s existing badge block for the tone logic.
- Accept: tests pin that an unscanned cleanup never yields "all clear" and that a finding reported
  by both the validator and the tidy-up analyzer counts once; in the app a clean profile with a
  completed scan says "all clear" explicitly. Covers AC 7.

## Coverage

| AC | Deliverable |
| --- | --- |
| Tab is called "Care", story-009 report unchanged | D1 |
| Sync section: in-sync / missing / out-of-sync / failed + retry (022 data) | D2 |
| Tidy-up section with preview, all five item classes | D3 (contract + apply), D4 (detection), D5 (preview + apply UI) |
| "Fix all safe findings" + explicit pre-apply warning (new) | D6 |
| "Preserved lines" tab folded in | D1 (fold-in), D4/D5 (drop + re-classify actions) |
| Mod-copies cleanup (010) moves here, flow + backup-once intact | D7 |
| Nothing on disk without a preview; deletes/overwrites undoable | D5 (per-item preview), D6 (batch warning), D7 (cleanup undo), D3 (main re-validates) |
| Explicit "nothing to report, nothing to clean" ≠ "not checked" | D8 |

## Model Hints

- D1 → default (a rename plus a composing tab component; the risk is mechanical, and ui:verify
  catches a missed harness id).
- D2 → default (a pure mapping plus a status list, both with existing mirrors).
- D3 → **deliverable-hard** — `applyTidyUpOps` is the first code path that mutates a *saved*
  profile from a finding, and every mutation it makes is written straight to disk in every assigned
  installation, so a wrong or half-applied op silently corrupts real config files.
- D4 → **deliverable-hard** — which of two duplicate binds actually wins depends on the renderer's
  emission order, and getting it backwards deletes the effective binding while leaving the dead one
  in place: a change that looks correct in the UI and is wrong in-game.
- D5 → default.
- D6 → default (a confirm dialog over ops D4 already classified).
- D7 → default (props + picker change; the flow and its tests stay put).
- D8 → default.
- Review: → **story-review-hard** — the story renames another story's tab, relocates two existing
  panels, deletes a tab, and depends on story 022's data shape landing as refined; the review has
  to hunt silent regressions in the validation report, the cleanup contract and the write path, not
  just judge new code.

## Test Plan (manual acceptance)

Run `npm run dev` and drive the real UI (P1: every step below is a real user action in the app).
`npm run ui:verify` afterwards for the screenshot + accessibility gate on `config-care`.

1. Config → open a populated profile. The tab formerly called **Validation** now reads **Care**,
   and there is no separate **Preserved lines** tab.
2. Inside Care, the validation report is the same per-engine report as before; change `r_maxfps` in
   **Settings** and come back — the report still updates without saving first.
3. The **sync** section lists the profile's own file first, then one row per assigned installation.
   Delete one installation's copy on disk and re-enter the tab: that row reads **missing**.
4. Make one assigned installation unwritable (or launch it), trigger a save, and return: the row
   reads **failed** (or **pending** for the running one). Press **Retry** on the failed row —
   it turns in-sync once the cause is removed.
5. In **Controls**, bind one key in two entries. Care's **tidy-up** section lists a
   "key bound twice" item; expand it — the preview names which binding is shadowed and which
   survives. Apply it: only the shadowed one is gone, and the Controls conflict badge clears.
6. Create an alt layer with no overrides, and an alias entry nothing references. Both appear in
   tidy-up; the empty layer is marked safe, the unreferenced alias is not.
7. Bind a key to `+nosuchalias`. It appears as **report only** — there is no Apply button on it.
8. Open a profile imported from disk (fixture `PROFILE_UNRECOGNIZED`): its preserved lines are a
   section in Care, each offering **Drop** and **Re-classify** with a preview.
9. Press **Fix all safe findings**: the dialog lists both safe operations and the warning line
   before anything changes. Cancel — nothing changed. Press it again and Apply — both are gone in
   one step, and the count on the button drops to 0 and the button disables with a reason.
10. The **cleanup** section is here, not on the profile list. Its picker offers only this profile's
    assigned installations until "scan any installation" is used. Run scan → apply → **Undo
    removal**: the file comes back byte-for-byte.
11. With everything fixed and the cleanup scanned, the top of the tab says **all clear**
    explicitly. Reload the app and re-enter the tab: it now says the cleanup has *not been checked*
    rather than "all clear".

## Done

**Summary.** The old "Validation" tab is now "Care": one section stack (`CareTab.tsx`) holding, in
order, a Care-level all-clear/not-checked summary, the unchanged story-009 validation report, the
now-always-present preserved-lines panel, a new sync section (story 022 data, 5 states, retry), a
new tidy-up section (6 finding kinds, per-item preview/apply, "fix all safe findings" batch dialog),
and the mod-copies cleanup panel (moved from the profile list, scoped to the profile's assigned
installations with a "scan any installation" widening control). All eight acceptance criteria are
met and ticked above.

**Commit message:**
```
025: Care tab replaces Validation — sync, tidy-up and cleanup in one place
```

**Decisions made during build (beyond the refine-time ones already in this file):**
- D8's sync/cleanup status reaches `CareTab` via one optional callback prop each
  (`CareSyncSection`'s `onStateLoaded`/`onStatusChange`, `CleanupPanel`'s `onStatusChange`) rather
  than a second IPC call or lifted fetch — each section keeps owning its own live state and only
  reports the result up once it already has it.
- The Care-level summary treats "cleanup not yet scanned" and "validation has nothing to check
  against" (`EngineScopeStatus !== 'ok'`, e.g. an unassigned profile) as the same kind of
  `notChecked` state, distinct from `clean` — both are "no real answer yet", not "nothing wrong".

**Verification:** `npm run build`, `npm test` (932 tests), `npm run typecheck` all green. Clean-agent
review (`story-review-hard`) returned FAIL on first pass with 3 confirmed findings, fixed in one
review-fix cycle, then all three gates re-verified green:
- F1: the tab badge's de-duplication (decision 18) only matched finding ids for r1q2-assigned
  profiles, because `Finding.id` is engine-prefixed while the tidy-up analyzer always computes
  alias-wiring findings at a fixed `r1q2`. Fixed by normalizing the `<engine>:actions:...` prefix
  away before comparing, symmetrically on both sides, in `lib/care-summary.ts`.
- F2: a profile with nothing assigned (`EngineScopeStatus !== 'ok'`) read its zero-count validation
  report as `clean` rather than `notChecked`, so it could reach a false "all clear" once cleanup was
  scanned. Fixed in `careSummary`.
- F3: the whole Care summary panel silently disappeared if the sync-state fetch failed, reproducing
  the exact ambiguity AC 8 exists to forbid. Fixed by giving `CareSyncSection` a status callback
  (`'loading' | 'loaded' | 'error'`) instead of a success-only one, so the summary always renders and
  never claims "all clear" while sync is errored/unresolved.

A fourth, cheaper issue surfaced only during the live-smoke pass, not the code review: `ui:verify`
flagged a new axe **critical** (`select-name`) on `config-care` — `CleanupPanel`'s installation
`<Select>` had no accessible name. Root cause predates this story (the `Field`/`Select` pair never
wired `htmlFor`/`id`, a pattern several other dialogs in this codebase share unfixed) and was simply
never audited before because `CleanupPanel` lived on an already-clean screen; moving it into a
tracked `ui:verify` screen exposed it for the first time. Fixed directly (added `useId()` +
`htmlFor`/`id`) since it was cheap and now visible on a screen this story ships. The same latent
pattern elsewhere (`ImportProfileDialog`, `CreateProfileDialog`, `LayersPanel`, `MessageEditor`,
`ActionEditor`, `CreateInstallationDialog`) is out of this story's scope and left as-is.

**Accepted-but-unfixed findings (reviewed, judged acceptable, not fixed):**
1. *Main-side `removeShadowedBind` re-validation trusts the op's claimed "loser," not just that the
   claim exists and the key is contested* (`src/shared/config/tidy-up.ts`). Decision 11/12 already
   frame "which claim wins" as the analyzer's call, not the applier's; D4's UI is the only caller and
   only ever emits loser ops, so this is unreachable today. Left as documented, not hardened further,
   to avoid re-deriving "who wins" a second time in the applier.
2. `ui:verify`'s `config-care` screen only exercises the `PROFILE_UNRECOGNIZED` fixture (to also
   cover the preserved-lines section with content) where the pre-story `config-validation`/
   `config-preserved` entries together covered both fixture profiles. One shot per screen id is this
   harness's existing budget; the Care tab's structure (same five sections regardless of which
   profile is open) doesn't need a second shot to prove it renders, so this was accepted as adequate
   coverage rather than adding a second `config-care*` screen entry.
3. Several cosmetic/low findings from the review (a single shared `retrying` flag disabling every
   failed sync row's retry button at once instead of per-row; the sync section's loading state
   rendering without its own heading; one dead defensive branch in `resolveWinner`) were left
   unfixed as genuinely low-impact UI polish outside this story's acceptance criteria.
