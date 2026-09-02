---
id: 048
title: Every setting is written to the file, and nothing resets to default any more
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-24
---

## Requirement

Two changes that belong together, because the second is only true once the first is: the profile
file stops being "the values I deviated on" and becomes "the state I want the game to be in".

Split out of the originally filed 048 (which also carried the unsaved-changes work) when S09 was
cut — the pending-changes half is now story
[049](049-unsaved-changes-reviewable-and-discardable.md). These two halves must ship in this
order: removing the reset affordances before every setting is written would leave the Settings tab
with no way back to a default, and writing every setting without removing them would leave a
button that resets to a state the file can no longer express.

**1. Every setting the launcher knows is written, not just the changed ones.**

Today a cvar only reaches the `.cfg` when it carries an explicit value - `handleResetAll` in
[SettingsTab.tsx](../../src/renderer/src/modules/config/SettingsTab.tsx) deliberately *deletes*
the key, and [render.ts](../../src/shared/config/render.ts) renders exactly the keys
`profile.cvars` holds. That silently assumes the engine starts from its own default. It does
not: `config.cfg`, an `autoexec.cfg`, a mod's config or an earlier `exec` of another profile can
all have set that cvar already, and the engine keeps whatever was set last. A setting the
launcher shows as "default" therefore does not mean the game runs it at its default - it means
the launcher said nothing about it and something else may have.

So the profile's file should carry a `set` line for **every** setting in the catalogue, with the
value the Settings tab shows for it - explicitly chosen or default. Then the file states the
whole intended configuration, and executing it is idempotent no matter what ran before.

**2. "Reset to default" disappears from every tab - bindings included.**

The concept goes, not just one button. For settings, a per-row reset that clears the key no
longer expresses anything the file can represent once every setting is always written - there is
no "unset" state left to reset to. For bindings it is a different argument with the same answer:
a profile is the user's own key layout, and a one-click "throw it all away and take the
catalogue's suggestions" is not an affordance this launcher needs to keep offering.

What goes:

- the per-row `RotateCcw` button in
  [CvarRow.tsx](../../src/renderer/src/modules/config/components/CvarRow.tsx) (and its grid
  column),
- the "Reset all" header button and its confirm dialog in
  [SettingsTab.tsx](../../src/renderer/src/modules/config/SettingsTab.tsx),
- the "Restore defaults" button and its confirm dialog in
  [ControlsTab.tsx](../../src/renderer/src/modules/config/ControlsTab.tsx), together with
  [lib/restore-defaults.ts](../../src/renderer/src/modules/config/lib/restore-defaults.ts) (story
  020 D10) and its test,
- the i18n keys behind all three (`config.cvar.resetToDefault`,
  `config.settings.header.resetAll`, `config.settings.resetAllDialog.*`,
  `config.controls.restoreDefaults.*`).

**Nothing takes their place.** Not a clickable default value, not a hint in the bind dialog,
nothing. The only thing that exists afterwards is story 049's discard, and it is a different
thing: "back to what I last saved", never "back to the catalogue's defaults".

For a cvar the default value still gets *printed* on the row as a reference - that is information,
not an affordance, and it is the useful half of what the button offered. For a binding there is
no default at all: a bind is what the user chose, full stop. That makes `suggestedKeys` in
[action-catalog.ts](../../src/shared/config/action-catalog.ts) dead data once
`restore-defaults.ts` is gone - it is that file's only consumer today - so it goes with it.

Untouched by all of this: `STANDARD_TEMPLATE`
([shared/modules/config.ts](../../src/shared/modules/config.ts)), the seed behind "create from
template". That is a starting point the user picks explicitly in the create dialog, not a default
the launcher can snap a profile back to.

## Acceptance Criteria

- [ ] A profile's canonical `.cfg` contains a `set` line for every cvar in the catalogue
      (`ALL_CVARS`), whether or not the user has changed it, in the same grouped and aligned
      layout story 040 established - plus, as today, every cvar the profile carries that the
      catalogue does not know.
- [ ] Executing the file twice, or after another config already set those cvars, leaves the same
      state: nothing in the catalogue is left to whatever ran before.
- [ ] Story 042's round-trip still holds: render -> parse -> render is a fixed point, and a
      re-imported launcher-written file does not turn "this was a default" into "the user chose
      this" in a way that changes later renders.
- [ ] The Settings tab has no per-row reset control and no "Reset all" button or dialog; the
      default value stays visible on every row as a reference.
- [ ] The Controls tab has no "Restore defaults" button or dialog, and `lib/restore-defaults.ts`
      is gone rather than left unused.
- [ ] No tab anywhere in the app offers a "reset/restore to default" action; the i18n keys behind
      the removed controls are removed too, not orphaned.
- [ ] Nothing replaces the removed controls: no clickable default value, no "restore" hint
      anywhere in the bind flow. A cvar row still *prints* its default as a reference; a binding
      shows no default, because it has none.
- [ ] `suggestedKeys` is gone from the action catalogue along with its only consumer, and
      creating a profile from `STANDARD_TEMPLATE` is unaffected.
- [ ] Care/cleanup and the Raw File tab stay honest about the bigger file: nothing starts
      reporting the newly written default lines as a problem, and no "tidy up" offers to remove
      them again.
- [ ] The Settings tab's "changed only" filter and the group/catalogue counters still mean
      something true after the change, and cannot disagree with what the rows show.
- [ ] `ui:verify` stays green (0 axe violations) and its Settings/Controls screenshots show the
      removed controls actually gone, not merely disabled.

## Open Questions

- **Which default gets written for an untouched cvar?** The canonical file is one file, synced to
  possibly several installations running different engines, while `effectiveDefaultFor` resolves
  a default *per engine in scope*. Writing the engine-scoped number bakes one installation's
  engine into a file another engine also executes; writing `def.default` writes the launcher's
  engine-neutral recommendation, which for some cvars is not what that engine would have used on
  its own. Story 009's honesty rule points at `def.default`, but this needs to be decided
  explicitly, not inherited.
- **What about a cvar the scoped engine does not have?** A row that is absent on an engine
  (`isCvarSupported` false) is currently non-editable and has no value to write. Written anyway
  it creates a harmless user cvar; skipped, the file is engine-dependent, which the previous
  question just argued against.
- **Where does the always-write happen** - materialised into `profile.cvars` on save, or filled in
  at render time in `render.ts` from `ALL_CVARS`? The latter keeps "the user chose this" and "this
  is the default" distinguishable in state; the former makes the file and the state agree
  literally. This one also decides what story 049's row indicator can be built on, so both
  stories need the answer.
- **What happens to the "changed only" filter and the counters?** Once every cvar is written,
  "changed" as "differs from the default" still has a meaning but a much weaker one. Does the
  filter keep that meaning, switch to story 049's "edited and unsaved", or offer both?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
