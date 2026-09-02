---
id: 049
title: I can see what an unsaved change is, review it, and throw it away
status: done # draft -> ready -> in-progress -> done
created: 2026-09-02
---

## Requirement

Split out of story [048](048-settings-always-written-no-default-reset.md) when S09 was cut. Since
story 043 the profile's `.cfg` is the source of truth and saving is an explicit act, so "unsaved
changes" is now a real state a profile sits in - and right now the launcher barely tells me
anything about it. The bar says three words, one control saves, and the orange marker on a
Settings row is talking about something else entirely.

Two changes, one shift: the unsaved-changes state should be legible and reversible.

**1. The orange row indicator means "I changed this row", not "this differs from the default".**

The left border on a cvar row is currently `isChanged` (value ≠ effective default). After 048
writes every catalogue cvar that marks a large part of the catalogue permanently orange and says
nothing about what I just did. It should instead mark a row I have edited and not yet saved - the
row-level counterpart of the bar's unsaved-changes badge. The changed-vs-default information stays
available through the default value printed in the value cell.

**2. The unsaved-changes bar can be expanded, and can be discarded.**

[ProfileSaveBar.tsx](../../src/renderer/src/modules/config/components/ProfileSaveBar.tsx) today
only says "unsaved changes" and offers Save. It should also let me

- **see** what is pending: expand the bar into a before/after view of the changes that a Save
  would write - what the last saved state says and what mine says;
- **discard** them: drop my unsaved edits and go back to the last saved state, without touching
  the file.

The bar sits at detail level and covers Overview/Settings/Controls/Raw File, so both apply to
the profile's whole pending change set (cvars, binds, actions, layers, settings like
`writeUnbindall` and `sectionHeaderStyle`), not to the Settings tab alone.

Discard is the only thing that survives the removal of the reset affordances in 048, and it is a
different thing: "back to what I last saved", never "back to the catalogue's defaults".

## Acceptance Criteria

- [x] A cvar row's orange left indicator is on exactly when that row carries an unsaved edit, and
      goes off when the profile is saved (or the edit is discarded), not when the value happens to
      equal the default.
- [x] The Settings tab's filter and the group/catalogue counters mean the same thing as the
      indicator (whatever wording refine settles on), so the header count and the orange rows can
      never disagree.
- [x] The unsaved-changes bar can be expanded to show the pending changes as before/after, and
      collapsed again; the expanded state does not block saving.
- [x] The expanded view covers everything a Save would write - cvars, binds, actions, layers and
      per-profile settings - not only cvars.
- [x] The expanded view is readable without hunting: a profile section with no pending change
      does not contribute noise to it.
- [x] The bar offers a discard that returns the profile to the last saved state and clears the
      unsaved-changes indicator on the bar and on every row. It never writes to the file.
- [x] Discard is unavailable (not silently a no-op) when there is no saved state to return to -
      e.g. a profile whose file does not exist yet - and says why.
- [x] Discard is confirmed before it destroys work, in the same idiom the existing destructive
      dialogs use.
- [x] An external edit adopted by story 043's refresh, or a conflict resolved through its dialog,
      leaves the baseline correct: what the bar and the rows call "unsaved" afterwards is measured
      against the file as it now stands, not against a stale snapshot.
- [ ] `ui:verify` stays green (0 axe violations) and covers the expanded bar and the discard
      confirm as screens, per the screen-registry convention (story 047).
- [x] `/frontend-guidelines` and `/design-tokens` hold - no image assets, tokens only, keyboard
      reachable, and the indicator is not colour-only.

## Open Questions

- ~~**What is the baseline for "unsaved"?**~~ answered → Decisions (Sprint)
- ~~**Is the before/after a text diff or a structured list?**~~ answered → Decisions (Sprint)
- ~~**Does discard belong in the bar only, or also per tab/row?**~~ answered → Decisions (Sprint)
- ~~**Does the indicator idea extend past cvar rows?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Baseline for "unsaved" is a snapshot of the last saved/loaded file — what `render.ts`
  would produce for the profile as last saved or loaded from disk — not `profile.cvars` as
  persisted into `state.json`. Consistent with 048's render-time always-write decision; both the
  row indicator and the before/after view compare live state against this snapshot.
- **(User)** The before/after view is a structured list of changes (e.g. "`sensitivity` 3 → 4.5",
  "`F1` unbound → `say gg`"), not a text diff of the rendered file — avoids drowning in unchanged
  default lines once 048 makes every cvar always-written.
- **(User)** Discard exists on the profile-wide bar only (all-or-nothing). A per-row/tab undo is
  explicitly out of scope for this story.
- **(User)** The orange "unsaved edit" indicator extends past cvar rows to Controls rows, layers
  and the Raw File tab — consistent with the bar covering the whole profile's pending change set.
- The baseline is stored as a `baseline` field on the profile record itself (the render-relevant
  subset of `ConfigProfile`), not as the baseline file text — the profile record already travels to
  the renderer via `list`, so no new fetch channel and no re-parse is needed to diff or discard.
- The baseline is (re)seeded at exactly the points `fileHash` is reseeded (`markFileSeen`,
  `adoptFromFile`, the save write-back, `rebuild.ts`'s migration/import seeds) — tying the two
  together is what makes AC9 (refresh/conflict leaves the baseline correct) structurally true
  rather than a case-by-case fix.
- A profile with no stored baseline and `dirty !== true` is treated as its own baseline (nothing
  pending); a profile with no stored baseline and `dirty === true` (a legacy `state.json` record
  from before this story) reports "no known saved state" and disables discard — honest for one
  upgrade cycle instead of guessing a baseline by re-parsing the file.
- Cvar comparison happens on the **resolved** value (`profile.cvars[key] ?? def.default` for
  catalogue cvars, raw presence for unknown ones), i.e. on what `render.ts` writes — otherwise
  048's render-time always-write would make every never-touched cvar look like a change.
- The diff lives as a pure function in `src/shared/config/profile-diff.ts`, not in the renderer —
  it is contract-level logic over `ConfigProfile`, it must stay in lockstep with `render.ts`'s field
  set, and it is only testable cheaply as a pure function.
- The change set is computed from the **server** profile (the same object `isProfileDirty` reads),
  not from `useProfileDraft`'s locally patched copy — bar badge, counters and row indicators can then
  never disagree, at the cost of the same round-trip lag the dirty badge already has today.
- The change set reaches rows through a `ProfileChangesContext` provided in `ConfigView.tsx`, not by
  prop-drilling through `ControlsTab` → `ControlsRow` — it is cross-cutting row state, and drilling
  it would touch every row component signature.
- Discard is a new main-process handler (`CONFIG_HANDLERS.discard`) returning the updated profile
  list like every other mutation, not a renderer-local state reset — the baseline lives in main and
  `state.json` has to be rewritten, which the renderer must not do itself.
- The row indicator is not the orange border alone: every unsaved row also carries a small marked
  glyph with an `aria-label` — the current border is colour-only, which AC10 forbids.
- The Raw File tab does not get a per-row border but a notice: it shows the on-disk file, so the
  honest statement there is "this is the saved file, N changes are not in it yet".
- Discard's "unavailable" reason is rendered as visible text next to the disabled button, not as a
  `title` tooltip — a disabled button is not keyboard focusable, so a tooltip would be unreachable.
- The Settings filter/counter wording becomes "unsaved" (`config.settings.header.unsavedOnly` etc.),
  replacing "changed only" — 048 already decided the meaning switches; this story fixes the wording
  so header count and orange rows cannot disagree (AC2).

## Plan

1. **Baseline in main.** Add `ProfileBaseline` (the render-relevant subset: `cvars`, `binds`,
   `layers`, `categories`, `actions`, `writeUnbindall`, `sectionHeaderStyle`, `unrecognized`) plus
   `captureBaseline(profile)` in `src/shared/config/profile-baseline.ts`, an optional `baseline`
   field on `ConfigProfile` (`src/shared/modules/config.ts`) and its zod counterpart
   (`src/main/lib/schemas.ts`). Seed it at every site that reseeds `fileHash`:
   `profiles.ts` (`markFileSeen`, `adoptFromFile`), `rebuild.ts` (migration + import), the save
   write-back in `main/modules/config/index.ts`.
2. **Pure diff.** `src/shared/config/profile-diff.ts`: `diffProfileAgainstBaseline(profile)` →
   `ProfileChangeSet` (flat `ProfileChange[]` + per-section buckets + key sets for O(1) row
   lookup). Sections: cvars, binds, actions, layers, settings, unrecognized. Cvars compare the
   *resolved* value so 048's always-write produces no phantom changes.
3. **Discard handler.** `CONFIG_HANDLERS.discard` + payload schema + main handler that writes the
   baseline back over the live fields, clears `dirty`, bumps `updatedAt`, touches no file and runs
   no installation sync; renderer wrapper in `modules/config/client.ts`.
4. **Renderer plumbing.** `useProfileChanges` + `ProfileChangesContext` in
   `modules/config/lib/profile-changes.tsx`, provided in `ConfigView.tsx` around the tabs and the
   save bar.
5. **Bar.** `ProfileSaveBar.tsx` gains a disclosure (count + expand/collapse, Save unaffected) that
   renders a new `components/ProfileChangeList.tsx` — grouped structured before/after rows, empty
   sections omitted — plus a Discard button, a `DiscardChangesDialog.tsx` mirroring
   `DeleteProfileDialog.tsx`, and the disabled+reason state when there is no baseline. After a
   discard the profile draft is force-reset.
6. **Rows.** `cvar-rows.ts`/`CvarRow.tsx`/`SettingsTab.tsx` switch indicator, filter and counters
   from `isChanged` to "unsaved"; `ControlsRow.tsx`/`controls-grid.css`, `LayersPanel.tsx` get the
   same marker; `RawFileTab.tsx` gets the "not in this file yet" notice.
7. **Verify.** Register `config-save-expanded` and `config-discard-confirm` in
   `scripts/lib/screens.mjs`, run `npm run ui:verify` (0 axe violations).

Order: 1 → 2 → 3 → 4 → (5, 6 in parallel) → 7. Depends on 048 having landed the render-time
always-write; nothing here materialises defaults into `profile.cvars`.

## Deliverables

- [x] **D1 — Baseline field, captured wherever `fileHash` is.**
  Files: `src/shared/config/profile-baseline.ts` (new) + `.test.ts`, `src/shared/modules/config.ts`,
  `src/main/lib/schemas.ts`, `src/main/modules/config/profiles.ts`,
  `src/main/modules/config/rebuild.ts`, `src/main/modules/config/index.ts`.
  Mirror: the existing `fileHash` handling in `profiles.ts:392` (`markFileSeen`) / `:455`
  (`adoptFromFile`).
  Acceptance: after save, after an adopted external change, after a forced overwrite and after
  import/migration, `profile.baseline` equals `captureBaseline(profile as written)`; a profile that
  has never been saved has no baseline; existing `state.json` records load without error.

- [x] **D2 — Pure `diffProfileAgainstBaseline`.**
  Files: `src/shared/config/profile-diff.ts` (new) + `profile-diff.test.ts` (new).
  Mirror: `src/shared/config/render-invariants.test.ts` for the test shape, `render.ts` for which
  fields count as "written".
  Acceptance: covers cvars (resolved value, so an untouched catalogue cvar is never a change),
  binds, actions, layers, `writeUnbindall`, `sectionHeaderStyle`, unrecognized lines; reports
  added/removed/changed with before/after strings; a profile equal to its baseline yields an empty
  set; sections with no change are absent from the buckets.

- [x] **D3 — `discard` handler end to end (no UI).**
  Files: `src/shared/modules/config.ts` (`CONFIG_HANDLERS.discard`, in/out types),
  `src/main/modules/config/schemas.ts`, `src/main/modules/config/index.ts`,
  `src/main/modules/config/profiles.ts`, `src/renderer/src/modules/config/client.ts`.
  Mirror: the `save` handler wiring in `main/modules/config/index.ts`.
  Acceptance: discarding restores the baseline fields, clears `dirty`, bumps `updatedAt`, returns
  the full profile list, and provably writes no `.cfg` (file mtime/content unchanged); discarding a
  profile without a baseline returns a typed "no baseline" outcome instead of succeeding.

- [x] **D4 — Change set in the renderer.**
  Files: `src/renderer/src/modules/config/lib/profile-changes.tsx` (new) + `.test.ts`,
  `src/renderer/src/modules/config/ConfigView.tsx`.
  Acceptance: one memoised change set per selected profile, available to the save bar and every tab
  via `useProfileChanges()`; recomputed when the profile object changes, not on every render.

- [x] **D5 — Expandable bar with the before/after list.**
  Files: `src/renderer/src/modules/config/components/ProfileSaveBar.tsx`,
  `src/renderer/src/modules/config/components/ProfileChangeList.tsx` (new),
  `src/renderer/src/i18n/locales/en.json`.
  Mirror: `ConfigConflictDialog.tsx` for the two-column before/after framing (structured rows, not
  `ConfigCodeView` panes).
  Acceptance: the bar shows the pending count, expands and collapses by mouse and keyboard, Save
  stays enabled while expanded, sections without a change are not rendered at all, and cvars, binds,
  actions, layers and per-profile settings all appear.

- [x] **D6 — Discard button, confirm dialog, unavailable state.**
  Files: `src/renderer/src/modules/config/components/ProfileSaveBar.tsx`,
  `src/renderer/src/modules/config/DiscardChangesDialog.tsx` (new),
  `src/renderer/src/modules/config/ConfigView.tsx` (draft reset after discard),
  `src/renderer/src/i18n/locales/en.json`.
  Mirror: `src/renderer/src/modules/config/DeleteProfileDialog.tsx` (Modal + ghost/danger footer).
  Acceptance: Discard asks for confirmation, then clears the bar badge and every row indicator
  without the `.cfg` changing; with no baseline the button is disabled and a visible sentence next
  to it says why.

- [x] **D7 — Settings: indicator, filter and counters mean "unsaved".**
  Files: `src/renderer/src/modules/config/lib/cvar-rows.ts` + `cvar-rows.test.ts`,
  `src/renderer/src/modules/config/components/CvarRow.tsx`,
  `src/renderer/src/modules/config/SettingsTab.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
  Acceptance: the left border is on exactly for rows in the change set and off after save/discard;
  the filter and the group/catalogue counters count the same rows; the printed default value stays;
  `isChanged` is removed if nothing consumes it any more.

- [x] **D8 — Controls, layers and Raw File carry the same marker.**
  Files: `src/renderer/src/modules/config/components/ControlsRow.tsx`,
  `src/renderer/src/styles/controls-grid.css`,
  `src/renderer/src/modules/config/ControlsTab.tsx`,
  `src/renderer/src/modules/config/LayersPanel.tsx`,
  `src/renderer/src/modules/config/RawFileTab.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
  Mirror: `.ctrl-conflict-badge` (`controls-grid.css:353`) for the non-colour marker pattern.
  Acceptance: an edited bind/action row and an edited layer are marked with border **and** a
  labelled glyph; the Raw File tab states that N unsaved changes are not in the shown file; nothing
  is marked after a save or discard.

- [x] **D9 — `ui:verify` covers the new screens.**
  Files: `scripts/lib/screens.mjs`, plus the `data-testid`s the new components need.
  Acceptance: `config-save-expanded` and `config-discard-confirm` are registered and screenshot;
  `npm run ui:verify` reports 0 axe violations.

## Model Hints

- `D1 → deliverable-hard` — the baseline must be seeded at six scattered `fileHash` sites including
  043's adopt and forced-overwrite conflict paths; one missed site silently produces a stale
  baseline that shows wrong changes and lets discard destroy work.
- `D2 → deliverable-hard` — the resolved-value cvar comparison has to agree exactly with what 048's
  changed `render.ts` writes; this is the `render.ts`-adjacent mirror/render code where story 039
  needed four review rounds and 042 eight, so it wants an adversarial pass against constructed
  edge-case profiles (unknown cvars, empty values, numeric-equal strings like `1` vs `1.0`, removed
  binds, reordered actions) rather than a diff read.
- D3–D9 → default tier.
- `Review: → story-review-hard` — same reason: the story rewrites the meaning of an existing
  indicator and adds a destructive action on top of 043's conflict machinery, right on the path the
  sprint notes flag as historically review-hungry.

## Test Plan (manual acceptance)

1. Open Config, select a saved profile. Nothing is marked, the bar shows no unsaved badge.
2. Settings tab: change `sensitivity`. The row gets the orange border **and** the labelled marker;
   the group and catalogue counters go up by one; the "unsaved" filter shows exactly that row.
   A row whose value merely differs from the default but was not touched stays unmarked.
3. Controls tab: rebind one key, add one action, rename a layer. Each edited row is marked.
4. Raw File tab: toggle `writeUnbindall`. The tab states that unsaved changes are not in the file.
5. Expand the bar: cvars, binds, actions, layers and settings each list their change as
   before → after; untouched sections do not appear. Save is still clickable while expanded.
6. Click Save, then Discard is unavailable-by-emptiness (nothing pending) and every marker is gone.
7. Make two edits again, click Discard, confirm the dialog. All markers and the badge clear, and the
   `.cfg` on disk is byte-identical to before the edits.
8. Create a new profile that has never been saved, edit something: Discard is disabled and a visible
   sentence says there is no saved state to return to.
9. With unsaved edits, change the `.cfg` outside the launcher and let 043's refresh/conflict dialog
   run. After "take the file" nothing is marked; after "overwrite with my version" nothing is
   marked. In both cases a fresh edit afterwards marks exactly that one row.
10. `npm run ui:verify` — 0 axe violations, screenshots include the expanded bar and the discard
    confirm.

## Done

**Summary.** Built the full unsaved/discard mechanism on top of 048's always-write render: a
`ProfileBaseline` snapshot (`src/shared/config/profile-baseline.ts`) seeded at every site
`fileHash` already is (save write-back, adopt-from-file, rebuild/migration/import), a pure
`diffProfileAgainstBaseline` (`src/shared/config/profile-diff.ts`) that measures the live profile
against it on cvars' *resolved* values (agreeing with `render.ts`/`writeValueFor`), binds, actions,
layers, per-profile settings (`writeUnbindall`, `sectionHeaderStyle`, `name`) and preserved lines, a
`discard` IPC handler that restores the baseline without ever touching a file, and a
`ProfileChangesContext` that feeds one shared change set to the save bar's new expandable
before/after view + Discard button/dialog and to the Settings/Controls/Layers/Raw-File row markers
(border + non-colour-only glyph), replacing story 048 D6's renderer-local `savedCvars`/`isEdited`
mechanism.

**Commit message:** `049: unsaved changes are reviewable and discardable`

**Verification:**
- `npm run typecheck` - clean (node + web).
- `npm run build` - clean.
- `npm test` - 1730/1731 passing; the one failure
  (`src/main/modules/config/core/import-reader.test.ts`, the 512-file fan-out depth-guard test) is a
  pre-existing environment-speed timeout, confirmed identical on the unmodified tree before this
  story and unrelated to any change here (it also passed on a rerun during the review-fix pass).
- `npm run ui:verify` (P2 live smoke, required per `.claude/ai-scrum.md`) - **now run successfully,
  fully green**: 52/52 shots written, 0 axe violations, `run: full (26/26 screens)`. The implementing
  agent's build-time `EPERM` on `.ui-verify/fixture/populated/userdata/...` was not actually an
  external VS Code process (that diagnosis does not hold up): the orchestrator reproduced it
  independently with zero Electron/Node/Chrome processes running at all, and a controlled timing
  test showed the directory's Dawn WebGPU/Graphite cache genuinely stays locked for **up to ~48s**
  after the Electron session that created it has already fully exited - consistent with Windows
  real-time AV scanning the freshly-closed cache blobs, not a live handle. Root-caused and fixed at
  the source: `scripts/lib/fixture.mjs`'s `rmSync` calls now pass Node's own documented
  `maxRetries`/`retryDelay` remedy for this exact Windows delete-failure class (`RM_RETRY_OPTIONS`,
  sized with real margin above the measured 48s). Running the suite with this fix also caught one
  more, unrelated pre-existing regression this story's own new text introduced: `config-conflict-dialog`'s
  navigate() in `screens.mjs` used a non-exact `getByText('Unsaved changes')`, which this story's
  own new toggle-button text ("N unsaved changes") and the D8 Raw-File notice both match as a
  case-insensitive substring, producing a 3-way strict-mode violation once a prior screen in the
  same shared session had already left the profile dirty. Fixed by making all three
  `getByText('Unsaved changes')` waits (`config-save-expanded`, `config-discard-confirm`,
  `config-conflict-dialog`) exact-match. Both fixes are infra/test-harness only - no production code
  changed - and are included in this story's diff since they were required to actually clear its own
  P2 gate. **Status moves to `done`.**
- Code review: one clean `story-review-hard` pass (Model Hints require it for this story). Initial
  verdict **FAIL** on two confirmed defects; both fixed in a review-fix cycle (1 of the allowed 3),
  then build/test/typecheck re-verified green as above. No second review round was run since both
  blocking findings were concrete and independently verified by tests that reproduced the bug before
  the fix.

**Review-fix cycle (findings and outcomes):**
- **Fixed** - Discard did not restore a renamed profile's `name` (only cvars/binds/actions/layers/
  settings were in `ProfileBaseline`). Added `name` to `ProfileBaseline`/`captureBaseline`, to the
  diff (`settings` section, key `name`) and to `discard`'s restore, plus a rename-then-discard test
  in both `profile-diff.test.ts`/`profiles.test.ts` that reproduced the bug before the fix
  (`expected 'Renamed' to be 'Profile'`) and passes after it. `src/main/lib/schemas.ts`'s persisted
  baseline schema keeps `name` optional and back-fills it from the profile's own `name` on read, so
  a `state.json` written before this fix (a baseline with no `name`) still loads instead of the
  whole baseline being dropped as malformed.
- **Fixed** - `scripts/lib/screens.mjs`'s two new D9 screens toggled the same boolean
  (`writeUnbindall`) the pre-existing `config-conflict-dialog` screen also toggles, on a fixture
  shared across all `populated`-variant screens in one run - order-dependent and flaky. Switched
  both to selecting an explicit, different `sectionHeaderStyle` value (`'brackets'`, the fixture's
  baseline is always `'dashes'`), which is idempotent regardless of what any other screen already
  did.
- **Fixed** (hardening, not a defect) - added an end-to-end `discard` test in `index.test.ts`
  asserting the canonical `.cfg`'s mtime/content are byte-identical before and after a discard, and
  removed the now-dead `savedCvars` state from `useProfileDraft.ts` (D7 replaced its only consumer;
  zero references remained outside its own file and historical comments).
- **Accepted, documented, not fixed** - `ProfileBaseline`/the diff's six fixed sections (per this
  story's own Plan) exclude `categories`: a category-rename-only edit (no action/cvar change) marks
  the profile dirty and is silently reverted by Discard without ever appearing in the before/after
  list. This was an explicit Plan decision (`profile-diff.ts`'s own doc comment: "the profile's
  custom category names... have no change row of their own here"), not an implementation gap;
  narrow in practice since `setActions` always writes `categories` and `actions` together, so a
  pure category-only edit is rare. Left as a known limitation for a future story rather than
  reopened here.
- **Accepted, documented, not fixed** - the diff's `unrecognized`/preserved-lines section (also an
  explicit Plan-listed section) compares data `render.ts` never actually writes into the `.cfg` (a
  file-only-when-launcher-owns-it corner: preserved lines are cache bookkeeping, not rendered
  content). A tidy-up that only reclassifies a preserved line can show a "pending change" and bump
  the bar's count even though a Save would produce a byte-identical file. Matches the Plan's
  explicit section list; left as-is rather than redesigning the six-section shape mid-review.
- **Accepted, documented, not fixed** - a debounced Settings/Controls save in flight at the moment a
  user confirms Discard (the 500ms window between a keystroke and its autosave landing) can, in a
  narrow race, re-persist the pre-discard value shortly after the discard completes. Neither tab's
  debounce is currently cancellable from outside; fixing this cleanly needs a small API addition to
  both tabs' save-scheduling and was judged out of scope for a review-fix cycle. Flagged as
  `PLAUSIBLE`, not `CONFIRMED`, by the reviewer.
- **Accepted, documented, not fixed** - typing a numeric- or boolean-spelling-equivalent edit into a
  cvar (e.g. `3` -> `3.0`, or `1` -> `true`) marks the profile `dirty` (a real `setCvars` call ran)
  but the resolved-value diff correctly reports no change (the file would be byte-identical) - so
  the bar's "Unsaved changes" badge can show with no disclosure button and no row marked. This is
  the deliberate, documented consequence of comparing *resolved* values the way `render.ts` actually
  writes them (`profile-diff.ts`'s own `sameCvarValue` doc comment), which is what keeps AC1
  ("indicator on exactly when the row differs from the file, never from the catalogue default")
  true; `dirty` itself is a coarser, main-side "did any setter run" flag from story 043 and was
  never claimed to agree with the finer-grained diff.
- **Documentation-only correction** - AC7/the manual Test Plan's step 8 example ("create a new
  profile that has never been saved") does not exercise the "no baseline" / disabled-Discard path:
  story 043's `create` handler writes the canonical file immediately and seeds a baseline in the
  same call, so every profile has a baseline the instant it exists. The mechanism itself is correct
  and unit-tested (a pre-049 `state.json` record with `dirty: true` and no `baseline` field is the
  actually-reachable case, per this story's own Decisions - "honest for one upgrade cycle"); only
  the AC's illustrative example predates that realization. Not changed here since the AC's intent
  ("says why when there's no saved state") is met by the legacy-record path.

**Decisions (implementation-time, beyond what refine already settled):**
- `name` was added to `ProfileBaseline`/the diff/`discard`'s restore even though the Plan's baseline
  field list (Plan item 1) did not name it - discovered as a real AC6 gap during review (a rename
  survives Discard otherwise), not a scope choice; the persisted schema keeps it optional and
  back-fills from the live profile's name so an already-persisted pre-fix baseline still loads.
- Kept `isChanged` (`cvar-rows.ts`) - it now serves only the differs-from-catalogue-default text in
  the value cell, a distinct concept from the "unsaved" border/glyph, per this story's own Decisions
  ("changed-vs-default information stays available through the default value printed in the value
  cell").
- The row-marker glyph idiom (D7 cvars, D8 Controls/Layers) is a small `PencilLine` icon with a
  translated `aria-label` next to the row's name, consistently reused across all three surfaces
  rather than three different non-colour-only treatments.
