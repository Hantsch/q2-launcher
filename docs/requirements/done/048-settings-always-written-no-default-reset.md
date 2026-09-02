---
id: 048
title: Every setting is written to the file, and nothing resets to default any more
status: done # draft -> ready -> in-progress -> done
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

- [x] A profile's canonical `.cfg` contains a `set` line for every cvar in the catalogue
      (`ALL_CVARS`), whether or not the user has changed it, in the same grouped and aligned
      layout story 040 established - plus, as today, every cvar the profile carries that the
      catalogue does not know.
- [x] Executing the file twice, or after another config already set those cvars, leaves the same
      state: nothing in the catalogue is left to whatever ran before.
- [x] Story 042's round-trip still holds: render -> parse -> render is a fixed point, and a
      re-imported launcher-written file does not turn "this was a default" into "the user chose
      this" in a way that changes later renders.
- [x] The Settings tab has no per-row reset control and no "Reset all" button or dialog; the
      default value stays visible on every row as a reference.
- [x] The Controls tab has no "Restore defaults" button or dialog, and `lib/restore-defaults.ts`
      is gone rather than left unused.
- [x] No tab anywhere in the app offers a "reset/restore to default" action; the i18n keys behind
      the removed controls are removed too, not orphaned.
- [x] Nothing replaces the removed controls: no clickable default value, no "restore" hint
      anywhere in the bind flow. A cvar row still *prints* its default as a reference; a binding
      shows no default, because it has none.
- [x] `suggestedKeys` is gone from the action catalogue along with its only consumer, and
      creating a profile from `STANDARD_TEMPLATE` is unaffected.
- [x] Care/cleanup and the Raw File tab stay honest about the bigger file: nothing starts
      reporting the newly written default lines as a problem, and no "tidy up" offers to remove
      them again.
- [x] The Settings tab's "changed only" filter and the group/catalogue counters still mean
      something true after the change, and cannot disagree with what the rows show.
- [x] `ui:verify` stays green (0 axe violations) and its Settings/Controls screenshots show the
      removed controls actually gone, not merely disabled.

## Open Questions

- ~~**Which default gets written for an untouched cvar?**~~ answered → Decisions (Sprint)
- ~~**What about a cvar the scoped engine does not have?**~~ answered → Decisions (Sprint)
- ~~**Where does the always-write happen?**~~ answered → Decisions (Sprint)
- ~~**What happens to the "changed only" filter and the counters?**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Default value written for an untouched cvar: `def.default` (engine-neutral), not
  per-engine `effectiveDefaultFor` — keeps one canonical file valid across installations running
  different engines, per story 009's honesty rule.
- **(User)** A cvar the scoped engine does not support (`isCvarSupported` false) is written anyway
  — becomes a harmless unknown user cvar on that engine, keeping the file engine-independent.
- **(User)** The always-write happens at render time in `render.ts` from `ALL_CVARS`, not
  materialised into `profile.cvars` on save — keeps "user chose this" vs. "default" distinguishable
  in state, which story 049's row indicator and unsaved-baseline require.
- **(User)** The "changed only" filter and the group/catalogue counters switch meaning to "edited
  and unsaved" (story 049's semantics), replacing "differs from default".

<!-- Taken during refine (S09), not by the user. Each with its reason. -->

- **Read-back strips catalogue values equal to `def.default` back out of `profile.cvars`** (only
  where a *launcher-written* file is adopted: `profiles.ts#adoptFromFile`, `rebuild.ts`) — without
  it, the first save+reload materialises all 30 catalogue defaults into state and turns "this was a
  default" into "the user chose this", which is exactly what AC3 forbids.
- **A foreign (non-launcher) import is not stripped** — it must keep recording what the imported
  file really said, and it is not affected by the always-write in the first place.
- **A catalogue cvar already present in `profile.cvars` under any casing is written from the stored
  key(s) only; no second default line is emitted** — two `set` lines for one cvar would let the
  later (default) line win at exec time and silently clobber the user's value.
- **A stored empty/whitespace-only value for a catalogue cvar is treated as unset and rendered with
  the default**; a non-catalogue cvar keeps today's verbatim rendering — `set x ""` states nothing to
  the engine, and the Settings tab already treats `''` as unset.
- **Write value and strip comparison both use `def.default`, compared numeric-/toggle-normalized,
  through one shared helper module** — render and read-back must not be able to drift into a state
  where the file grows a line every round-trip.
- **The exec-buffer size budget keeps reporting the real, larger file — no exemption for default
  lines** — the engine really reads them, so hiding them from the budget would be the dishonest
  answer; only the absence of *new* Care findings is regression-tested.
- **The orange cvar row indicator switches to "edited and unsaved" in this story, not in 049** —
  048's own AC forbids counters and rows disagreeing, and they share one predicate.
- **The "edited and unsaved" baseline is an interim cvar-scoped snapshot in `useProfileDraft`**
  (seeded whenever a profile with `dirty: false` arrives; a profile that arrives already dirty shows
  nothing as edited until the user edits) — smallest honest thing that satisfies AC10, and it is the
  exact shape 049 widens to the whole profile per its own baseline decision.
- **The i18n keys behind the filter/counters/legend are renamed, not reused** — a key called
  `changedOnly` describing "unsaved" is the kind of drift the next reader pays for.
- **`renderLoaderFile` and `STANDARD_TEMPLATE` are untouched** — the loader carries no cvars, and
  the template is an explicitly picked seed, not a default to snap back to.

## Plan

**Order:** shared rule → render → read-back/round-trip → Care honesty → UI removals → semantics
switch → dead data → verify. The three shared/main steps land before any UI work, so the Settings
tab is never in a state where the reset is gone but the file is still deviation-only.

1. **One rule, one file.** New `src/shared/config/cvar-defaults.ts`: `isDefaultValue(def, value)`,
   `writeValueFor(def, stored)` and `stripCatalogDefaults(cvars)`, all comparing numeric-/toggle-
   normalized (same rule `cvar-facts.ts`'s private `sameValue` and `cvar-rows.ts#normalizeCvarValue`
   use). Render and read-back both call it, so they cannot drift apart.
2. **`render.ts#buildCvarSections` writes every `ALL_CVARS` def** instead of only
   `Object.keys(cvars)`: catalogue defs in today's group/index order with `writeValueFor`, plus every
   stored key the catalogue does not know in the unchanged "Other" section. Stored keys win over the
   catalogue line for the same def (case-insensitive), grouping/alignment/tie-breaks unchanged.
   *This is the 039/042 risk path — see Model Hints.*
3. **Read-back stays deviation-only:** `stripCatalogDefaults` in `profiles.ts#adoptFromFile` and
   `rebuild.ts#buildRebuiltProfile`, then re-run story 042's round-trip fixed-point property
   (`src/main/modules/config/round-trip.test.ts`) plus a new "render → parse → adopt → render is
   byte-identical **and** `profile.cvars` did not grow" case.
4. **Care/Raw File honesty:** regression tests that a default-filled file produces no new
   `validateCvars` (`cvar-absent`/range/choice), `tidy-up` or `validate-structure` findings, and that
   the size budget simply reports the bigger file.
5. **Remove the affordances:** per-row `RotateCcw` + its 4th grid column (`CvarRow.tsx`), "Reset all"
   + dialog + `handleResetAll` (`SettingsTab.tsx`), "Restore defaults" + dialog + handler
   (`ControlsTab.tsx`) and `lib/restore-defaults.ts` + test; i18n keys deleted, not orphaned. The
   printed default reference in the value cell stays.
6. **Switch the semantics:** saved-cvars baseline in `useProfileDraft`, `isEdited` replacing
   `isChanged` for filter, counters and the row indicator, wording renamed. Shaped so 049 can widen
   the baseline from cvars to the whole profile without unwinding it.
7. **Drop the dead data:** `suggestedKeys` (type + the 7 movement entries) out of
   `action-catalog.ts`.
8. **Verify:** `npm run build`, `npm test`, `npm run typecheck`, then `npm run ui:verify` (0 axe
   violations, Settings/Controls screenshots show the controls gone).

## Deliverables

**D1 — the shared default rule.** [x]
New `src/shared/config/cvar-defaults.ts` + `cvar-defaults.test.ts`.
*Accept:* `isDefaultValue`/`writeValueFor`/`stripCatalogDefaults` handle case-insensitive names
(`findCvar`'s rule), `"true"`/`"1"` toggles, `"1.0"`/`"1"` numerics, empty/whitespace = unset, and
leave non-catalogue keys untouched. Pure, no consumers yet.

**D2 — every catalogue cvar is written.** [x]
`src/shared/config/render.ts` (`buildCvarSections`/`buildCvarSection` + doc comment),
`src/main/modules/config/render.test.ts`. Mirror: the existing group/index ordering already in
`buildCvarSections`.
*Accept:* a profile with an empty `cvars` map renders a `set` line for all 30 `ALL_CVARS` names in
the story-040 grouped, name-aligned layout; unknown stored cvars still land in "Other"; a stored
`Sensitivity` produces exactly **one** line (no second `sensitivity` default line); a stored `''`
renders the default; output stays byte-deterministic across two renders of the same profile.

**D3 — read-back does not inflate the profile, and 042's round-trip still holds.** [x]
`src/main/modules/config/profiles.ts` (`adoptFromFile`), `src/main/modules/config/rebuild.ts`,
`src/main/modules/config/round-trip.test.ts`.
*Accept:* `render(parse(render(p))) === render(p)` green for every `ROUND_TRIP_FIXTURES` entry; a
launcher file adopted from disk yields the same `profile.cvars` it was rendered from (no default
inflation, user values equal to a default included only where they were stored before); a foreign
import path is unchanged.

**D4 — Care and the Raw File tab stay honest about the bigger file.** [x]
Tests only (co-located with `validate-cvars.test.ts`, `tidy-up.test.ts`, `validate-structure.test.ts`
or one new `default-lines.test.ts` under `src/main/modules/config/`).
*Accept:* an adopted default-filled profile produces no new cvar findings (notably no
`cvar-absent-*` storm for cvars the scoped engine lacks), tidy-up offers nothing to remove, and the
size-budget finding reports the real byte count with unchanged wording.

**D5 — the Settings tab loses both reset affordances.** [x]
`src/renderer/src/modules/config/components/CvarRow.tsx` (button + `ROW_GRID` 4th column),
`src/renderer/src/modules/config/SettingsTab.tsx` (`handleResetAll`, header button,
`confirmResetAllOpen` state/effect, dialog), `src/renderer/src/i18n/locales/en.json`
(`config.cvar.resetToDefault`, `config.settings.header.resetAll`,
`config.settings.resetAllDialog.*`).
*Accept:* no reset control and no dialog anywhere on the tab, nothing takes their place (no
clickable default), the row still prints its default as text, grid columns line up, keys gone from
`en.json` with no references left.

**D6 — "changed" becomes "edited and unsaved".** [x]
`src/renderer/src/modules/config/lib/useProfileDraft.ts` (saved-cvars baseline),
`src/renderer/src/modules/config/lib/cvar-rows.ts` + `cvar-rows.test.ts` (`isEdited` alongside/
replacing `isChanged` in `buildCvarGroups`), `SettingsTab.tsx`, `CvarRow.tsx` (left border),
`en.json` (filter/count/legend wording).
*Accept:* a freshly loaded, saved profile shows 0 edited and no orange row even where values differ
from the default; editing a row marks exactly that row and bumps the group + catalogue counter;
saving clears both; the counter can never disagree with the visible rows because both read one
predicate. Baseline is a snapshot object, not a boolean, so 049 can widen it to the whole profile.

**D7 — the Controls tab loses "Restore defaults".** [x]
`src/renderer/src/modules/config/ControlsTab.tsx` (button, `showRestoreDefaults`,
`handleRestoreDefaults`, dialog), delete
`src/renderer/src/modules/config/lib/restore-defaults.ts` and its test, `en.json`
(`config.controls.restoreDefaults.*`).
*Accept:* no restore control, no dialog, file deleted rather than left unused, no hint about
defaults added anywhere in the bind flow, keys gone.

**D8 — `suggestedKeys` is dead data and goes.** [x]
`src/shared/config/action-catalog.ts` (the `Action.suggestedKeys` field + the 7 movement entries
carrying it), `src/shared/config/action-catalog.test.ts`.
*Accept:* typecheck green with no consumer left repo-wide; creating a profile from
`STANDARD_TEMPLATE` is unchanged (pinned by a test).

**D9 — verification pass.** [x]
No production files expected; `docs/UI-VERIFICATION.md` screen registry only if a screen id moved.
*Accept:* `npm run build`, `npm test`, `npm run typecheck` and `npm run ui:verify` green (0 axe
violations); Settings and Controls screenshots show the removed controls actually absent, not
disabled; a repo-wide grep for the five removed i18n key prefixes returns nothing.

**Coverage (AC top to bottom):** AC1 → D2 · AC2 → D2 · AC3 → D3 (on D1) · AC4 → D5 · AC5 → D7 ·
AC6 → D5+D7, orphan check in D9 · AC7 → D5+D7 · AC8 → D8 · AC9 → D4 · AC10 → D6 · AC11 → D9.

## Model Hints

- **D2 → `deliverable-hard`** — `render.ts`'s cvar path is the mirror/render code where story 039
  took four review rounds and 042 eight; the case-insensitive stored-key-wins rule is a silent
  clobber bug (duplicate `set` line, default wins at exec) if it is got wrong.
- **D3 → `deliverable-hard`** — it changes what a *re-imported* file means; a strip rule that is one
  normalization off makes the round-trip fixed point fail one render later, which is precisely the
  failure mode 042 kept rediscovering.
- D1, D4, D5, D6, D7, D8, D9 → default tier.
- **Review: → `story-review-hard`** — the story rewrites the rendered file's cvar block and the
  read-back that consumes it; the sprint's carry-over rule explicitly says not to trust a diff read
  on this path, and asks for an adversarial re-render pass against constructed edge-case profiles
  (stored casing variants, empty values, unknown cvars, an engine-absent cvar).

## Test Plan (manual acceptance)

1. Start the app, open a profile with a few changed settings → **Settings** tab. The rows show no
   reset icon and the header has no "Reset all" button; every row still prints its default value.
2. **Controls** tab: no "Restore defaults" button anywhere in the header or the bind dialogs.
3. Back on **Settings**, change `sensitivity`. Exactly that row turns orange and the group +
   catalogue counters go up by one. Save from the profile bar → the marker and the counters clear
   while the value stays.
4. Switch on the "unsaved only" filter with nothing pending → the list is empty (not "everything
   that differs from a default").
5. **Raw File** tab: the profile's `.cfg` now lists a `set` line for every setting the Settings tab
   shows, grouped under Player/Network/Graphics/Sound, plus any imported cvar under "Other".
6. Close and reopen the profile (or hit refresh): the Settings tab still shows the same values, no
   row is marked edited, and the **Validation** tab has not gained findings about cvars you never
   touched.
7. Launch the game with the profile once, quit, launch again → the same settings apply both times.

## Done

**Summary.** The profile's canonical `.cfg` now carries a `set` line for every cvar in `ALL_CVARS`
(catalogue defaults included), not just the ones the user deviated on, so exec of the file is
idempotent regardless of what ran before it. Read-back strips catalogue-default lines back out of
`profile.cvars` so state never inflates and story 042's round-trip fixed point still holds. All
three "reset/restore to default" affordances (Settings per-row, Settings "Reset all", Controls
"Restore defaults") are gone along with their i18n keys and `restore-defaults.ts`; `suggestedKeys`
is dead data and removed from the action catalogue. The Settings "changed" filter/counters/row
indicator were switched to "edited and unsaved" (a saved-cvars baseline in `useProfileDraft`), so
they never disagree with a file that intentionally differs from default on every load.

**Commit message:**
```
048: profile files always write every cvar, reset-to-default affordances removed
```

**Verification.**
- `npm run build` — green.
- `npm run typecheck` — green (node + web).
- `npm test` (`npx vitest run`) — 1671 passed, 2 failed; both failures are known, pre-existing,
  unrelated flakes confirmed independent of this story's diff: `core/import-reader.test.ts`'s
  512-file fan-out test (5s timeout only under full parallel load, passes in isolation) and
  `file-source-pipeline.test.ts`'s Windows `EBUSY` temp-file lock on `state.json`.
- `npm run ui:verify` — 0 axe violations across all screens; Settings/Controls screenshots
  confirmed to show the removed controls actually absent (no per-row reset icon, no "Reset all",
  no "Restore defaults"), header reading "30 cvars · 0 edited", filter renamed "Edited only".
- Code review (`story-review-hard`, two rounds): round 1 **FAIL** — found a confirmed high-severity
  data-loss regression in `src/shared/config/cvar-defaults.ts`'s D1 toggle-normalization (collapsed
  any non-boolean toggle value, e.g. `gl_shadows: "2"`, to `"0"`, so read-back silently deleted it)
  plus a medium one (case-insensitive comparison applied to `kind: 'text'` cvars like `name`,
  mangling casing on round-trip). Fixed in `cvar-defaults.ts` (toggle normalization now only
  canonicalizes recognized boolean spellings and leaves other values as their own literal; text-kind
  comparison is now case-sensitive while choice/numeric kinds keep their existing equivalence) with
  new regression tests. Round 2 **PASS** — reviewer independently re-derived the fix's correctness
  with its own adversarial probes (every toggle default × out-of-range value, text/choice/numeric
  collateral-damage check, full render→adopt→render pipeline) and confirmed AC3 now holds.

**Decisions.**
- The toggle-value normalization bug (D1) and the text-kind case-sensitivity bug (D1) were fixed
  within `src/shared/config/cvar-defaults.ts` during the review-fix cycle, since they were newly
  introduced by this story's own read-back strip (`stripCatalogDefaults`) turning a previously
  cosmetic normalization quirk into real data loss on disk. Not a plan gap — a D1 implementation
  bug caught by the mandated adversarial review pass.
- Left unfixed, as a documented pre-existing limitation outside this story's diff: `cvar-rows.ts`'s
  `normalizeCvarValue` (renderer-side, feeding only the "= default" reference text via `isChanged`)
  still has the same toggle-collapse shape `cvar-defaults.ts` was just fixed for, so a row like
  `gl_shadows = "2"` can print "= default" even though it isn't. Display-only (no data loss — the
  edited-indicator and counters use `isEdited` against the saved baseline, not this), pre-dates
  story 048, and out of scope for this story's deliverables; worth a follow-up story if it proves
  confusing in practice.
- The review's finding of a theoretical double `set` line for a cvar name stored with stray
  whitespace was judged unreachable (no code path produces such a key) and, even if constructed,
  self-correcting (the user's value renders last and wins at exec) — not fixed, per the reviewer's
  own recommendation not to add a guard for it.
- `ControlsRow.tsx`'s per-row "Reset" button (clears both bind slots to empty) was confirmed
  out of scope for AC6/AC7: the story's own `## Requirement` says a binding has no default at all,
  so clearing slots is not "restoring a default" — it predates this story and is a different
  feature (clear binds), not the banned affordance.
- `changelog-path` is not set in `.claude/ai-scrum.md`, so no changelog entry was added.
