---
id: 248
title: I filter servers by several mods at once
status: done # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player who plays more than one mod, I can select several mods in the server filter at once —
e.g. OpenTDM and CTF — and see servers of any of them.

User feedback 2026-10-04: select multiple mod filters in the server browser, e.g. filter for tdm and
ctf.

Today the mod filter is a single select (`ServerListFilter.mod: string | null`), filled from the
`gamename` values of the current rows.

Concept: [game-browser.md](../systems/game-browser.md).

## Acceptance Criteria

- [x] **AC1** — The mod filter is a multi-select: the user can check several mods; the closed control
      shows their names (or "3 mods" when they do not fit).
- [x] **AC2** — With several mods selected, a server is shown if its mod is any of them.
- [x] **AC3** — With no mod selected the filter is "Any", as today.
- [x] **AC4** — A selected mod that is no longer in the current list stays selected and visible in the
      control, and is never dropped silently.
- [x] **AC5** — Saved quick filters store the mod set; a quick filter saved before this story (single
      mod) still loads and applies as a set of one, and a chip is pressed when the sets are equal.
- [x] **AC6** — The multi-select is keyboard-operable (open, move, toggle with Space, close with
      Escape) and announces the selected count.

## Open Questions

- ~~**Q1** — "tdm" and "ctf" are mods (`gamename`) in the example, but gamemode is a filter too. Should
  gamemode become multi-select as well? Recommendation: no — gamemode is only known for baseq2
  servers; mods only.~~ answered → Decisions (Sprint)
- ~~**Q2** — Map filter multi-select too? Not asked for; recommendation: no.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Gamemode filter: stays single-select, mods only.
- **(User)** Map filter: becomes multi-select too. Note: extends this story's scope/AC accordingly; refine will plan it.
- **Map scope** — AC1–AC6 apply to the map filter exactly as to the mod filter (closed label reads "N maps"); every test below runs for both controls — the binding user decision above extends the story, it needs no new criteria wording.
- **Matching** — OR within one field, AND across fields (mods ∪, then maps ∪, then gamemode/toggles/search as today); case-insensitive as today — that is what "any of them" means without changing how the other filters combine.
- **Data shape** — `ServerListFilter.mod`/`.map` (and `QuickFilterCriteria`) become `string[]`, empty = "Any"; the keys keep their names — the persisted key stays stable, only the value widens, so legacy compatibility is a value-level preprocess.
- **Legacy quick filters** — the shared `quickFilterCriteriaSchema` accepts a legacy `string` (→ `[s]`) or `null` (→ `[]`) for `mod`/`map` via `z.preprocess`; nothing rewrites `state.json` eagerly — the next save writes the new shape, and accepting it in the one schema covers both the persisted parse and the IPC save path.
- **Set equality** — `sameCriteria` compares mod/map as case-insensitive sets (order and duplicates ignored) — AC5 says "when the sets are equal".
- **Closed label** — none → "Any"; one → its name; two or more → the names joined ", " in option order if ≤ 24 characters, else "N mods"/"N maps" (CSS truncate as safety) — "when they do not fit" needs a deterministic, testable rule; measuring rendered width is not.
- **Control shape** — a new UI-kit primitive `MultiSelect` (`src/renderer/src/components/ui/MultiSelect.tsx`) expanding **in flow** below its trigger, not a portalled popover — the filter rail is vertical and scrolls, an in-flow panel cannot be clipped and needs no third copy of Menu/Popover's anchor-placement logic; two consumers (mod + map) justify a primitive, not module-local code.
- **ARIA pattern** — trigger `button` with `aria-haspopup="listbox"`/`aria-expanded`; panel `role="listbox"` `aria-multiselectable="true"` with `role="option"` + `aria-selected`, active option via `aria-activedescendant`; a polite live region (`role="status"`) reads "N selected" — the WAI-ARIA multi-select listbox pattern is what AC6's open/move/toggle/close/announce describes.
- **Keyboard** — trigger: Enter/Space/ArrowDown opens; listbox: ArrowUp/Down, Home/End move, Space (and Enter) toggles without closing, Escape and Tab close, Escape returns focus to the trigger; focus leaving the component closes it — matches AC6 and the native-select muscle memory the control replaces.
- **Missing selected values** — a selected value with no case-insensitive match among the current options is appended (checked) after them, as today's `nullableOptions` does for the single select — AC4, and it keeps the one existing precedent.
- **Gamemode** stays the native single `Select` (User decision); the replays filter bar's own selects are out of scope.

## Plan

Sprint order: 247 (max ping) and 250 (scan follows filter) are built before this story — keep any
field they add to `ServerListFilter`/`QuickFilterCriteria` untouched; 250's scoping keeps working
because it filters through `filterServers`.

1. **D1** — UI-kit `MultiSelect` primitive with its own component tests (keyboard, ARIA, label rule).
2. **D2** — shared model: `mod`/`map` become `string[]`, engine OR-matches, quick-filter
   criteria compare as sets, schema accepts the legacy scalar; the filter bar gets a 2-line bridge
   so the tree stays green.
3. **D3** — filter bar swaps the two `Select`s for `MultiSelect`; renderer tests; locale keys.
4. **D4** — real-surface proof: flow helper, new flow `servers-multi-filter`, the two existing
   server-filter flows migrated off `selectOption`; systems doc + changelog.

Affected: `src/renderer/src/components/ui/MultiSelect.tsx` (new), `src/shared/servers/list-filter.ts`,
`src/shared/servers/quick-filters.ts`, `src/shared/modules/servers.ts`,
`src/renderer/src/modules/servers/ServerListFilterBar.tsx`, servers locale, `scripts/lib/servers-flow.mjs`,
`scripts/flows/servers-*.mjs`, `docs/systems/servers-module.md`, `CHANGELOG.md`.

## Deliverables

- [x] **D1 — `MultiSelect` UI-kit primitive.** New `src/renderer/src/components/ui/MultiSelect.tsx`
      plus `MultiSelect.test.tsx`. Props: `label` (accessible name, the field label), `options:
      string[]`, `value: string[]`, `onChange(next: string[])`, `summaryCount: (n) => string` (caller's
      "N mods"), `data-testid` (on the trigger; options get `${testid}-option`). Behaviour:
      options rendered = `options` plus every `value` entry with no case-insensitive match in
      `options`, appended in `value` order; an option is checked when `value` contains it
      case-insensitively; toggling off removes every case-insensitive match, toggling on appends.
      Closed trigger text: `[]` → `t('common.label.any')`; one → that value; ≥2 → selected values
      in rendered-option order joined `", "` if that string is ≤ 24 chars, else `summaryCount(n)`;
      `truncate` class as safety. Panel expands **in flow** directly below the trigger (no portal,
      no overlay registration). ARIA: trigger `button` `aria-haspopup="listbox"` `aria-expanded`,
      `aria-controls`; panel `role="listbox"` `aria-multiselectable="true"` `aria-label={label}`,
      `tabIndex=0`, focused on open, `aria-activedescendant` → active `role="option"` with
      `aria-selected` and a visible check (not colour-only); a visually hidden `role="status"`
      `aria-live="polite"` reads `t('common.label.selectedCount', { count })`. Keyboard: trigger
      Enter/Space/ArrowDown opens (active = first checked or first option); listbox ArrowUp/Down
      (clamped), Home/End move, Space/Enter toggle and stay open, Escape closes and refocuses the
      trigger, Tab closes; `focusout` to outside the component closes; mouse click on an option
      toggles. Styling: mirror `Select`'s `FIELD_BASE` look and `ChevronDown` from
      `controls.tsx` (export `FIELD_BASE` if it is not exported), focus-visible ring, option rows
      ≥ 28px (CLAUDE.md dense floor), semantic tokens only. Add `common.label.selectedCount`
      (`"{{count}} selected"`) to `src/renderer/src/i18n/locales/en.shell.json` and refresh the
      `src/renderer/src/i18n/__snapshots__/en.bundle.json` snapshot. Tests in `MultiSelect.test.tsx`
      named in Acceptance Tests (label rule incl. the 24-char boundary, missing-value append,
      case-insensitive check/uncheck, each key, live-region text).

- [x] **D2 — mod/map become sets in the shared model.** Files: `src/shared/servers/list-filter.ts`
      (+ `list-filter.test.ts`), `src/shared/servers/quick-filters.ts` (+ `quick-filters.test.ts`),
      `src/shared/modules/servers.ts`, `src/main/modules/servers/persisted.test.ts`, and the
      mechanical fixture updates in `src/main/modules/servers/quick-filter-entries.test.ts` /
      `src/main/modules/servers/index.test.ts` (scalar `mod: 'ctf'` → `['ctf']`). Change
      `ServerListFilter.mod`/`.map` to `string[]` (`EMPTY_SERVER_LIST_FILTER` → `[]`); keep every
      other field, including any added earlier in the sprint (story 247), untouched.
      `isFilterActive`/`hasCriteria`: a set is active when non-empty. `matchesFilter`: when `mod` is
      non-empty the row passes if `equalsIgnoreCase(row.mod, m)` for any `m`; same for `map`; fields
      still AND together. `sameCriteria`: mod/map equal as lower-cased sets (order, duplicates
      ignored). `criteriaOf`/`applyCriteria` copy arrays. In `quickFilterCriteriaSchema` replace
      `mod`/`map` with `z.preprocess(v => typeof v === 'string' ? [v] : v === null ? [] : v,
      z.array(z.string()))` and a one-line comment naming the legacy scalar (story 248); the
      `.strict()` object and `.refine(hasCriteria)` stay, so a legacy `{ mod: null, … all false }`
      row is still dropped as before. Bridge in `src/renderer/src/modules/servers/ServerListFilterBar.tsx`
      only so typecheck stays green: the two `Select`s read `filter.mod[0] ?? ''` and write `[]`/
      `[v]` (D3 replaces them); `nullableOptions` takes `current[0] ?? null`. Tests (names in
      Acceptance Tests): OR within a field, AND across fields, empty set = no restriction,
      set equality ignores order/case/duplicates, legacy scalar and `null` parse to `[]`/`[s]`
      through `parseServersState`, a legacy single-mod row applies as a set of one.

- [x] **D3 — the filter bar uses `MultiSelect` for mod and map.** Files:
      `src/renderer/src/modules/servers/ServerListFilterBar.tsx` (+ `ServerListFilterBar.test.tsx`),
      `src/renderer/src/modules/servers/ServersView.test.tsx`,
      `src/renderer/src/modules/servers/locale/en.json`, the `en.bundle.json` snapshot. Replace the
      mod and map `Select`s with `<MultiSelect>` from `../../components/ui/MultiSelect` inside the
      same `Field`s, keeping test ids `servers-filter-mod` / `servers-filter-map` on the triggers;
      `options` = `options.mods` / `options.maps`, `value` = `filter.mod` / `filter.map`,
      `onChange` writes the array, `summaryCount` = `t('servers.filter.modsCount', { count })` /
      `t('servers.filter.mapsCount', { count })` (new keys with `_one`/`_other`: "{{count}} mod(s)"
      / "{{count}} map(s)"). Delete `nullableOptions` if no caller remains (gamemode builds its own
      list). Gamemode stays a native `Select`. "Clear filters" and quick-filter chips work unchanged
      through the shared helpers. Update `ServersView.test.tsx`'s two `fireEvent.change` on
      `servers-filter-mod` to open the control and click options. Tests (names in Acceptance
      Tests): checking two mods narrows to servers of either; unchecking all shows "Any" and every
      row; a chip saved with `['ctf','opentdm']` is pressed for `['OpenTDM','ctf']`; a legacy
      scalar chip criteria (via the parsed schema) applies as a set of one.

- [x] **D4 — real-surface proof, flows migrated, docs.** Files: `scripts/lib/servers-flow.mjs`
      (add `setMultiFilter(page, testId, values)` — opens the trigger, sets exactly `values` by
      clicking `${testId}-option` entries by text, closes with Escape — and `readMultiFilter(page,
      testId)` — opens, returns the `aria-selected="true"` option texts, closes),
      `scripts/flows/servers-filter-search.mjs` and `scripts/flows/servers-quick-filters.mjs`
      (replace every `selectOption`/`inputValue` on `servers-filter-mod`/`servers-filter-map` with
      the helpers; assertions on persisted `criteria.mod` become arrays; the seeded legacy
      `mod: 'nosuchmod'` / `mod: null` rows stay scalar on purpose), any other flow under
      `scripts/flows/` that grep finds using those test ids, and a new
      `scripts/flows/servers-multi-filter.mjs` (variant `servers-multi-filter`; copy the
      four-responder setup of `servers-filter-search.mjs` with mods `opentdm`/`baseq2`/`baseq2`/`ctf`,
      using `makeResponderBinder` from `scripts/lib/servers-stub.mjs`; seed one legacy quick filter
      `{ mod: 'ctf', map: null, … }` and a selected-then-vanished mod via a quick filter whose mod no
      responder serves). Then `docs/systems/servers-module.md`: the filter description and the
      `quickFilters` state line say mod and map are sets (any-of) and legacy scalars load as a set
      of one. `CHANGELOG.md` under `## Unreleased` › `### Changed`: one line, e.g. "**Servers** —
      Filter by several mods or maps at once."

## Model Hints

No `deliverable-hard`: D1 is a standard listbox pattern fully pinned by component tests, D2 is a
pure-function change with unit tests on every branch.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-multi-filter.mjs` › "AC1: checking opentdm and ctf shows both names on the closed control"; unit `src/renderer/src/components/ui/MultiSelect.test.tsx` › "the closed label lists names up to 24 characters, then the count"
- AC2 → unit `src/shared/servers/list-filter.test.ts` › "a server passes when its mod is any of the selected mods"; e2e `scripts/flows/servers-multi-filter.mjs` › "AC2: opentdm + ctf lists servers A and D only, and adding a map narrows across fields"
- AC3 → unit `src/shared/servers/list-filter.test.ts` › "an empty mod or map set does not restrict the list"; e2e `scripts/flows/servers-multi-filter.mjs` › "AC3: unchecking every mod shows Any and all servers"
- AC4 → unit `src/renderer/src/components/ui/MultiSelect.test.tsx` › "a selected value missing from the options is appended and stays checked"; e2e `scripts/flows/servers-multi-filter.mjs` › "AC4: a selected mod no server reports stays checked and named in the control"
- AC5 → unit `src/shared/servers/quick-filters.test.ts` › "sameCriteria compares mod and map as case-insensitive sets"; unit `src/main/modules/servers/persisted.test.ts` › "a legacy single-mod quick filter loads as a set of one"; unit `src/renderer/src/modules/servers/ServerListFilterBar.test.tsx` › "a chip is pressed when its mod set equals the filter's"; e2e `scripts/flows/servers-multi-filter.mjs` › "AC5: a two-mod quick filter persists as an array, and the legacy chip applies as a set of one"
- AC6 → unit `src/renderer/src/components/ui/MultiSelect.test.tsx` › "keyboard opens, moves, toggles with Space and closes with Escape" and › "the live region announces the selected count"; e2e `scripts/flows/servers-multi-filter.mjs` › "AC6: the mod filter is operated by keyboard alone and announces the count"
- Map (User decision) → the AC1–AC4 e2e steps above repeat for `servers-filter-map` in the same flow (step names prefixed "map:"); unit `src/shared/servers/list-filter.test.ts` › "a server passes when its map is any of the selected maps"
- Regression → existing flows `servers-filter-search` and `servers-quick-filters` pass after migration (D4).

## Done

Mod and map filters are now multi-select (new `MultiSelect` UI-kit primitive, in-flow listbox); the shared model holds
`string[]` sets (any-of within a field, AND across fields), quick filters compare as sets and legacy scalar/null rows load
as a set of one. New flow `servers-multi-filter`; two existing flows migrated; systems doc and changelog updated.

Commit message: `248: filter servers by several mods/maps — MultiSelect primitive, mod/map as sets, legacy quick filters load as set of one, servers-multi-filter flow`

Verification (narrow gate): build, typecheck, lint green; `npx vitest run --changed HEAD` green (183 files); comments + architecture tests green.
`npm run ui:flows -- --affected` exceeded the 10-minute call and was stopped (INCONCLUSIVE), so the story's own flow plus all 26 `servers-*`
flows were run by name in 3 batches: all passed; after review fixes `servers-multi-filter`, `servers-filter-search`, `servers-quick-filters` re-ran green.
Non-servers flows that `--affected` selects were not run (left to the sprint gate). AC to test: AC1-AC6 and the map extension are covered by the
named MultiSelect/list-filter/quick-filters/persisted/ServerListFilterBar unit tests and the `servers-multi-filter` steps (all ran and passed); the chip test
name was aligned to "a chip is pressed when its mod set equals the filter's". No manual residue.
Review 1 (default): FAIL on a broken UTF-8 dash in CHANGELOG plus a11y details (trigger name hid the selection, dangling activedescendant, no scroll-into-view,
duplicate keys, thin keyboard tests) — all fixed and re-verified. Not fixed: the AC6 flow covers the mod control only (map is covered by the unit tests); minor
local case-insensitive helper copies.

Decisions:
- `servers-multi-filter` is not registered in `scripts/flows/areas.json`: both servers rows already hold 12 flows (cap); it runs via `ui:flows` all and by name.
- Trigger Enter opens the listbox in addition to Space/ArrowDown (native-select muscle memory).
- Trigger `aria-label` is "{label}: {summary}" so the closed selection is exposed.
- Legacy `mod: null` + all-else-false rows are still dropped; `mod: null` with another criterion loads as `[]`.

tiers: D 4 / hard 0 · review default · cycles 1 · agents 7
