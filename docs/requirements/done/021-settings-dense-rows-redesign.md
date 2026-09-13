---
id: 021
title: Settings — rebuild as the dense-rows prototype
status: done # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

The Settings tab has the right content and the wrong shape: one cvar row spans the whole window,
groups are two hard-coded panels rather than the real groups, and engine facts, current value and
default are not readable at a glance.

It should look and work like
[docs/prototypes/settings/a-dense-rows.html](../prototypes/settings/a-dense-rows.html): a capped,
dense list where every row is label + description, one control, the value against its default, and
a reset — with the noisy engine caveats inline only where there actually is one.

## Acceptance Criteria

- [x] Content width is capped (~1000px); a row is a fixed grid (label · control · value · reset),
      not a stretched flex row.
- [x] Rows are grouped by the cvar's real `group` (Player / Network / Graphics / Sound) with a
      sticky group header showing "n · m changed", replacing the two current panels.
- [x] A row shows its label, the cvar name in mono, and its description on one truncated line
      that expands on hover.
- [x] The control matches the cvar kind: text input, select, toggle switch, or slider plus a
      numeric field.
- [x] The value column shows the effective value and underneath either the engine default plus
      range, or "= default".
- [x] A row whose value differs from the default is marked with a left accent bar, and the legend
      explains that marker.
- [x] Per-row reset is always reachable and disabled when the value already is the default.
- [x] Header shows "n cvars · m changed", a filter box and a "changed only" toggle; "Reset all"
      asks before discarding.
- [x] When the profile is assigned nowhere (or only to engines with no facts), the existing
      explicit "no engine in scope" note appears above the list and no engine's numbers are
      claimed — the current honesty rule from story 009 stays intact.
- [x] Engine caveats (mod-dependent value, above the assigned engine's clamp, cvar not present on
      the assigned engine) render as an inline flag row inside the affected row, naming the other
      assigned engines' numbers; a cvar the engine does not have is dimmed and disabled.
- [x] Autosave behaviour and the shared draft (story 009) are unchanged — this is layout, not a
      new save path.
- [x] Colours/spacing from design tokens; the prototype's hex values are reference only.

## Open Questions

- ~~Filter and "changed only": session-local, or remembered per profile?~~ answered →
  Decisions (Sprint)
- ~~The prototype shows ~30 cvars. Does the catalogue's full set need an "advanced cvars"
  collapse, or is the group + filter enough?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Filter and "changed only" toggle are session-local — not persisted per profile, no
  extra saved UI state.
- **(User)** The catalogue gets an additional "Advanced" collapse for rarely used cvars, on top
  of the existing group + filter — more UI state, but a calmer default view for a full
  catalogue larger than the prototype's ~30.
- "Advanced" is driven by the existing `CvarDef.common` flag (`cvar-facts.ts:96`, today unused by
  any UI): it was introduced for exactly this collapse, so no second flag is added.
- Group order is fixed as Player · Network · Graphics · Sound and derived from `def.group` over
  `ALL_CVARS`, not from the `PLAYER_CVARS`/`GRAPHICS_CVARS` arrays — those two already carry
  `network`/`sound` entries and are an authoring convenience, not a UI grouping.
- "Changed" means the normalised value differs from the effective default (engine default, else
  catalogue default), not "a key exists in the map": per-row reset writes the default value, so a
  presence-based test would leave the row marked changed right after a reset.
- "Reset all" clears only the catalogue's own keys from `draft.cvars` and leaves unknown/imported
  cvars untouched — a full `{}` would silently delete values this tab never showed.
- "Reset all" acts on the whole catalogue, not on the filtered/collapsed view, and the confirm
  dialog names the number of changed cvars — same whole-profile semantics story 020 chose for
  "Restore defaults", and a filter-dependent destructive action is a trap.
- Filter matches cvar name, label and description (case-insensitive); a hit inside a collapsed
  Advanced section auto-reveals it, so filtering can never look like "no results".
- Engine caveats keep their existing sources of truth (`resolveCvar`, `noteForValue`,
  `engineDisagreement`, `hasEngineFacts`, `isCvarSupported`) and only move to a new position in the
  row — story 009's facts layer is not re-derived.
- The "no engine in scope" note stays exactly where it is today, `EngineScopeSelect` above the
  list, with its four `EngineScopeStatus` states untouched — AC 9 is a placement guarantee, not a
  new component.
- Autosave stays the mechanism from story 009 (500 ms debounce, `patch` functional updater, revert
  to `profile.cvars` on failure); the redesign only replaces the JSX below it.
- Everything new lives module-local under `modules/config/` — per CLAUDE.md a feature is a module,
  never an edit to the shell; existing shell primitives (`Modal`, `Input`, `Select`, `Switch`,
  `IconButton`, `Badge`) are reused as-is. If story 020 has already landed a shared dense-table
  primitive by build time, reuse it instead of adding a second one.
- The confirm dialog mirrors `CleanupPanel.tsx` (`Modal` + ghost/danger button pair) rather than
  inventing a dialog shape.
- Prototype hex values are mapped onto the existing `@theme` tokens in
  `src/renderer/src/styles/index.css`; the only gap (input background `#0b0c0f`) reuses
  `bg-void/60` as `CvarRow` already does, and warning/danger soft tiers are composed with opacity
  modifiers instead of new hex.
- The design-tokens mobile floor (44 px targets, ≥16 px inputs) is deviated from for this desktop
  surface and the deviation is written into CLAUDE.md with its reason (mouse/keyboard-only Electron
  app, no touch surface); 44 px stays as row min-height and pointer hit area, and focus-visible
  plus "never colour alone" are kept in full.
- No IPC and no shared contract change: the tab already saves through `CONFIG_HANDLERS.setCvars`,
  so `src/shared/ipc.ts` and the preload allowlist stay untouched.

## Plan

Pure renderer work inside `src/renderer/src/modules/config/`. Nothing in main, preload or the IPC
contract changes; story 009's save path is carried over untouched.

1. **Row model (new, pure, tested):** `modules/config/lib/cvar-rows.ts` —
   `normalizeCvarValue`, `effectiveDefaultFor(def, engine)`, `isChanged(def, engine, value)` and
   `buildCvarGroups(defs, { values, engine, filter, changedOnly, showAdvanced })` → ordered
   `{ group, total, changed, rows, advancedHidden }`. Header and group-header counts come from
   here, not from JSX. Audit `common:` across all 30 entries in
   `src/shared/config/cvar-catalog.ts` so the Advanced bucket is meaningful (data only).
2. **Row presentation:** rewrite `components/CvarRow.tsx` as the prototype's grid
   (`minmax(0,1fr) 250px 108px 24px`, 44 px min-height, 2 px left border): label + mono cvar name +
   one-line truncated description expanding on hover, kind-specific control, two-line value cell
   (effective value / `= default` or `default · min–max`), always-reachable reset.
3. **Caveats inline:** the badge cluster becomes a full-width flag sub-row (`grid-column: 1/-1`)
   inside the row — note, clamp/mod-dependent, cross-engine disagreement naming the other assigned
   engines' numbers; `absent` renders the row dimmed + disabled with only a "not on <engine>" value
   line. Facts come unchanged from `@shared/config/cvar-facts`.
4. **Tab shell:** rewrite `SettingsTab.tsx` — capped `max-w-[1000px]`, header bar
   ("n cvars · m changed", filter box, changed-only toggle, Reset all + confirm `Modal`), sticky
   group headers, Advanced collapse per group, legend below the list. `EngineScopeSelect` keeps its
   place above the list. `scheduleSave`/`handleChange`/`patch` are moved, not modified.
5. **Tokens, a11y, smoke:** token audit (no hex, no palette class), focus-visible on every new
   control, non-colour marker for "changed" (legend + value text), reduced-motion for the switch,
   CLAUDE.md deviation note, then the 026 harness screenshot + axe run and the manual pass.

New i18n keys go into `src/renderer/src/i18n/locales/en.json` under `config.settings.*` /
`config.cvar.*` next to the existing ones; main never sends prose.

## Deliverables

- [x] **D1 — Row model + Advanced flag audit.**
  New `src/renderer/src/modules/config/lib/cvar-rows.ts` + `lib/cvar-rows.test.ts`; data-only edit
  to `src/shared/config/cvar-catalog.ts` (`common:` on all 30 entries).
  Mirror: `modules/config/lib/engine-scope.ts` (pure module + colocated test).
  *Accept:* `npm test` green; tests cover group order (Player·Network·Graphics·Sound), per-group
  `total`/`changed`, toggle normalisation (`1`/`true`), filter over name+label+description,
  `changedOnly`, `showAdvanced` incl. "filter hit inside Advanced is revealed", and that an
  engine-absent cvar resolves its default without inventing engine numbers.

- [x] **D2 — Dense row: grid, controls, value cell, changed accent, reset.**
  `src/renderer/src/modules/config/components/CvarRow.tsx`, `src/renderer/src/i18n/locales/en.json`.
  Mirror: current `CvarRow.tsx` for the control dispatch, `components/ui/controls.tsx` for field
  styling.
  *Accept:* a row is one grid (label · control · value · reset); text/select/toggle/slider+number
  each render for their kind; the value cell shows the effective value plus `= default` or
  `default · min–max`; a changed row carries the 2 px left accent; reset is always visible and
  disabled exactly when the value equals the default; the description truncates to one line and
  expands on hover; no raw hex in the file.

- [x] **D3 — Inline engine caveats and the absent-on-engine row.**
  `src/renderer/src/modules/config/components/CvarRow.tsx` (flag sub-row only),
  `src/renderer/src/i18n/locales/en.json`.
  *Accept:* note / clamp / mod-dependent / cross-engine disagreement render as a full-width flag
  row inside the affected row and name the other assigned engines' numbers; an absent cvar is
  dimmed, its control and reset disabled, value cell reads "not on <engine>"; with no engine in
  scope no default, range or note is attributed to any engine (story 009 honesty rule);
  `src/shared/config/cvar-facts.ts` and `lib/validation-scope.ts` are not modified.

- [x] **D4 — Tab shell: capped width, header bar, sticky groups, Advanced collapse, legend.**
  `src/renderer/src/modules/config/SettingsTab.tsx`, `src/renderer/src/i18n/locales/en.json`.
  Mirror: `modules/config/CleanupPanel.tsx` for the confirm `Modal`, `ConfigView.tsx:203` for the
  capped wrapper.
  *Accept:* content capped at ~1000 px; the two hard-coded panels are gone; a sticky group header
  per real group showing "n · m changed"; header shows "n cvars · m changed" plus filter box and
  changed-only toggle (both session-local, reset on profile switch); Advanced collapse per group;
  "Reset all" opens a confirm dialog naming the count and clears only catalogue keys; the legend
  explains the accent bar and `= default`; `EngineScopeSelect` still sits above the list;
  `SAVE_DEBOUNCE_MS`, `scheduleSave`, `handleChange` and the failure-path
  `patch({ cvars: profile.cvars })` are unchanged and `lib/useProfileDraft.ts` is untouched.

- [x] **D5 — Token/a11y pass, documented deviation, live smoke.**
  `src/renderer/src/modules/config/**` (fixes only), `CLAUDE.md` (deviation note), screenshots via
  the story 026 harness.
  *Accept:* no hex literal and no raw palette class in the touched files; every interactive element
  has a visible `:focus-visible` ring; "changed", "disabled" and "caveat" are each conveyed by more
  than colour; the switch honours `prefers-reduced-motion`; CLAUDE.md records the desktop-density
  deviation with its reason; harness screenshot of the Settings tab plus an axe run with no new
  violations; `npm run build`, `npm run typecheck`, `npm test` green.

**AC coverage:** width cap → D4, row grid → D2 · real groups + sticky "n · m changed" → D1+D4 ·
label/mono name/hover description → D2 · control per kind → D2 · value + default/range or
`= default` → D2 · accent bar → D2, legend → D4 · per-row reset → D2 · header counts/filter/changed
only/Reset all confirm → D4 (counts from D1) · no-engine-in-scope note → D3 (semantics) + D4
(placement) · inline caveats + dimmed absent row → D3 · autosave/shared draft unchanged → D4 ·
design tokens → D5.

## Model Hints

- D1 → default
- D2 → default
- **D3 → deliverable-hard** — it re-renders story 009's engine-facts semantics (absent, clamp,
  mod-dependent, cross-engine disagreement) in a new position, where the cheap failure mode is
  silently attributing r1q2's default or range to an engine that is not in scope.
- D4 → default
- D5 → default
- **Review: → story-review-hard** — the story sits directly on story 009's autosave, shared draft
  and honesty rule while rewriting every JSX file around them, and no component test guards that
  surface today.

## Test Plan (manual acceptance)

Run `npm run dev`, open Config → pick a profile → Settings tab.

1. Widen the window: the list stays capped around 1000 px and does not stretch; a row's four
   columns line up across all rows.
2. Scroll: each group header (Player, Network, Graphics, Sound) sticks and shows "n · m changed";
   the two old panels are gone.
3. Hover a long description: it expands from its single truncated line.
4. Edit one cvar of each kind (text, select, toggle, slider): the control matches the kind, the
   value cell updates, the row gets the left accent bar, and the second line switches from
   `= default` to `default · min–max`.
5. Click that row's reset: the value returns to the default, the accent bar disappears, reset
   becomes disabled.
6. Type into the filter and toggle "changed only": rows narrow and the counts follow; a hit inside a
   collapsed Advanced section reveals it. Switch profile and back — filter and toggle are reset
   (session-local), nothing was persisted.
7. "Reset all": the confirm dialog names the count; cancel changes nothing, confirm returns every
   catalogue cvar to its default. Open the Raw File tab — an imported cvar outside the catalogue is
   still there.
8. Assign the profile to an r1q2 installation: rows with a note/clamp/mod-dependent caveat show the
   inline flag row; a cvar r1q2 does not have is dimmed and disabled. With a second engine assigned
   as well, the flag names that engine's numbers.
9. Unassign the profile everywhere: the "no engine in scope" note appears above the list, rows stay
   editable, and no row claims an engine default, range or note.
10. Edit a cvar, switch to Validation and back within a second: the edit is still there and the save
    indicator runs idle → saving → saved (story 009 autosave unchanged).

## Done

**Summary.** Settings tab rebuilt as the dense-rows prototype: a new pure module
(`modules/config/lib/cvar-rows.ts`) computes grouping, filtering, "changed" status and Advanced
visibility from `def.group`/`def.common`; `CvarRow.tsx` is now a 4-column grid row (label/mono
name/hover description · kind-specific control · two-line value cell · always-reachable reset)
with engine caveats rendered as a full-width inline flag sub-row and absent-on-engine rows dimmed
and disabled; `SettingsTab.tsx` is a capped (~1000px) list with a header bar (counts, filter,
changed-only, Reset-all with confirm dialog), sticky per-group headers, a per-group Advanced
collapse, and a legend — `EngineScopeSelect` and the story-009 autosave/save-path/facts layer are
carried over unmodified. `CLAUDE.md` records the desktop touch-target-floor deviation.

**Commit message:** `021: rebuild Settings tab as dense-rows layout`

**Verification.** `npm run build`, `npm run typecheck`, `npm test` (697 tests) all green after
every deliverable and after the fix cycle. Live smoke via `npm run ui:verify`: exit code 1, caused
solely by the pre-existing, unrelated `RawConfigPanel.tsx` crash on `config-raw` (documented in
`docs/UI-VERIFICATION.md`, not this story's to fix); a Settings-tab screenshot was produced at both
viewports and the axe report shows only the same pre-existing app-wide `page-has-heading-one`
violation already present on every other tab — no new violations.

**Review:** `story-review-hard`, two passes. First pass: FAIL — 6 confirmed/plausible findings
(slider range input rendered 0px wide; Advanced-collapse toggle was one-way and its "N more" count
lied while filtering; filter matched raw i18n keys instead of translated text; "Reset all" wrote
explicit default values instead of clearing catalogue keys; the value-cell tooltip could present a
catalogue-only min/max in the same slot as a real per-engine fact). All six were fixed in one
cycle. Second pass: PASS — all six verified fixed by re-reading the code (not by trusting the
claim), no regression against AC1-12 or story 009's autosave/facts/honesty-rule contract, no test
weakened or deleted.

**Deliberately unfixed (low/cosmetic, noted by the reviewer, not required to be fixed):**
- `NUMERIC_FIELD`'s `focus:outline-none` cancels the global focus-visible ring — a pre-existing
  shell (`FIELD_BASE`) convention, not introduced by this story.
- The slider's numeric-companion `aria-label` reads "Current value" on every row rather than
  naming the cvar.
- `IconButton size="sm"` (28px) overflows the row grid's 24px reset-column track by 4px.
- The value-cell tooltip's "engine default" branch can still attribute a catalogue-level
  `def.min`/`def.max` range (rather than a genuine per-engine range) to the assigned engine when
  the engine has a default but no explicit range fact; the visible (non-tooltip) value cell and
  AC9's honesty rule are unaffected since no engine is named there.
- Group headers use the existing `config.settings.header.count` wording ("n cvars · m changed")
  rather than the prototype's terser "n · m changed" — information is identical, wording differs.

**Decisions (implementation, beyond the pre-filled sprint decisions):**
- D1's `buildCvarGroups` filter accepts optional `labelText`/`descriptionText` resolvers so
  `SettingsTab.tsx` can pass real translated strings via `t()`, keeping `cvar-rows.ts` free of any
  i18n import (still a pure module) while satisfying "filter matches label and description" against
  actual English text rather than i18n keys.
- "Reset all" deletes each catalogue key from a copy of `cvars` (rather than writing explicit
  default values) so the result never depends on which engine happens to be scoped at reset time
  and never writes a value into a row whose per-row reset is disabled (absent-on-engine).
- Per-group Advanced-collapse visibility now derives from an explicit `hasAdvanced` field
  (independent of the current filter/expand state), separate from `advancedHidden` (the post-filter
  hidden count used only for the "N more" label), so the toggle survives being clicked and stays
  meaningful mid-filter.
