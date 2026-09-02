---
id: 049
title: I can see what an unsaved change is, review it, and throw it away
status: draft # draft -> ready -> in-progress -> done
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

- [ ] A cvar row's orange left indicator is on exactly when that row carries an unsaved edit, and
      goes off when the profile is saved (or the edit is discarded), not when the value happens to
      equal the default.
- [ ] The Settings tab's filter and the group/catalogue counters mean the same thing as the
      indicator (whatever wording refine settles on), so the header count and the orange rows can
      never disagree.
- [ ] The unsaved-changes bar can be expanded to show the pending changes as before/after, and
      collapsed again; the expanded state does not block saving.
- [ ] The expanded view covers everything a Save would write - cvars, binds, actions, layers and
      per-profile settings - not only cvars.
- [ ] The expanded view is readable without hunting: a profile section with no pending change
      does not contribute noise to it.
- [ ] The bar offers a discard that returns the profile to the last saved state and clears the
      unsaved-changes indicator on the bar and on every row. It never writes to the file.
- [ ] Discard is unavailable (not silently a no-op) when there is no saved state to return to -
      e.g. a profile whose file does not exist yet - and says why.
- [ ] Discard is confirmed before it destroys work, in the same idiom the existing destructive
      dialogs use.
- [ ] An external edit adopted by story 043's refresh, or a conflict resolved through its dialog,
      leaves the baseline correct: what the bar and the rows call "unsaved" afterwards is measured
      against the file as it now stands, not against a stale snapshot.
- [ ] `ui:verify` stays green (0 axe violations) and covers the expanded bar and the discard
      confirm as screens, per the screen-registry convention (story 047).
- [ ] `/frontend-guidelines` and `/design-tokens` hold - no image assets, tokens only, keyboard
      reachable, and the indicator is not colour-only.

## Open Questions

- **What is the baseline for "unsaved"?** Since story 043 the file is the source of truth and
  `setCvars` already persists into `state.json` while only marking the profile dirty, so
  `profile.cvars` is *not* the last saved state. The baseline has to come from the file (or a
  snapshot taken at save time) - which is the same data the before/after view needs, so both are
  one decision. It also depends on where 048 lands the always-write (state vs. render time).
- **Is the before/after a text diff of the rendered file, or a structured list of changes?**
  There is no diff component in the repo yet; `ConfigConflictDialog` composes
  [ConfigCodeView](../../src/renderer/src/modules/config/components/ConfigCodeView.tsx) twice
  side by side. A text diff reuses the renderer and covers everything for free; a structured list
  ("`sensitivity` 3 -> 4.5", "`F1` unbound -> `say gg`") reads better but needs a per-section
  change model. After 048 a rendered-text diff also has to not drown in unchanged default lines.
- **Does discard belong in the bar only, or also per tab/row?** The story asks for it on the bar
  (all-or-nothing, whole profile). A per-row "undo my edit" is a different feature and should be
  named as out of scope if it is not wanted here.
- **Does the indicator idea extend past cvar rows?** Controls rows, layers and the Raw File tab
  have pending state too. Marking only cvar rows is a smaller story; marking everything is more
  consistent with a bar that claims to cover the whole profile.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
