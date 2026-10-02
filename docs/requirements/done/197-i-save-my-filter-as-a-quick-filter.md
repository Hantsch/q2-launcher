---
id: 197
title: I save my filter as a quick filter
status: done # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player who looks for the same kind of server again and again, I can save the filter I have
just set up as a named quick filter of my own, and apply it again with one click later. A user
asked for custom filters; the simplest form is to keep the current selection - mod, gamemode, map,
empty, bots, waiting-for-opponent - under a name next to the built-in quick toggles.

Concept: [game-browser.md](../concepts/game-browser.md) §8, GB-L5, GB-P1.

## Acceptance Criteria

- [x] **AC1** — While at least one filter criterion is active, the filter bar offers _Save as quick
      filter_, which asks for a name. With no criterion active the action is disabled and says why
      as visible text.
- [x] **AC2** — A saved quick filter appears as a chip in the filter bar. Clicking it replaces the
      current filter with exactly the saved criteria.
- [x] **AC3** — A chip shows pressed (flame edge plus check mark, never colour alone) whenever the
      current filter equals its criteria, and clicking it then clears the filter.
- [x] **AC4** — A quick filter can be renamed and deleted from its chip; deleting it never
      changes the current filter.
- [x] **AC5** — Saving under a name that is already taken, or an empty name, is refused with a
      reason; the user may overwrite the existing one explicitly.
- [x] **AC6** — Quick filters survive a restart and are global to the launcher, not per
      installation, stored in the servers module's own state.
- [x] **AC7** — A saved filter that names a mod or map no longer in the list still applies and
      shows the existing no-match state; it never breaks the bar and is never dropped silently.
- [x] **AC8** — A damaged or unknown entry in the stored quick filters is skipped without losing
      the others and without an error toast.
- [x] **AC9** — The built-in quick toggles (empty, waiting for opponent, bots) keep working
      unchanged next to the custom chips.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — — Does a quick filter include the free-text search, or only the structured criteria?
  With story 195 a quoted search could be a useful saved term (`"duel"`), but a search is usually
  a one-off. Recommendation: structured criteria only, search stays out.
- ~~**Q2**~~ answered → Decisions (Sprint) — — Does a quick filter also capture the sort? Not in the request; recommendation: no.
- ~~**Q3**~~ answered → Decisions (Sprint) — — Is there an upper bound on the number of quick filters (chip row width)? A cap of
  ~8 with a visible reason avoids a bar that wraps over the list.
- ~~**Q4**~~ answered → Decisions (Sprint) — Chip order: creation order, or user-sortable? Recommendation: creation order, nothing
  to manage.
- ~~**Q5**~~ answered → Decisions (Sprint) — Do quick filters apply in both Online and LAN mode (story 196)? They are plain criteria
  over rows, so yes unless the refine finds a reason against.

## Decisions (Sprint)

- **(User)** Search in quick filter: structured criteria only, search stays out
- **(User)** Sort in quick filter: no, sort is not captured
- **(User)** Cap: cap of 8 with a visible reason
- **Q4 chip order:** creation order; an overwrite keeps the chip's place — nothing to manage, and the cap of 8 keeps the row short.
- **Q5 Online/LAN:** quick filters apply in both modes and need no mode-specific code — they are plain criteria over `ServerListRow`s, and story 196 does not change the filter type.
- **Criteria shape:** a quick filter stores `ServerListFilter` minus `search` (`mod, gamemode, map, empty, hideBotsOnly, waitingForOpponent`) — the binding "search stays out" decision, as its own type so a saved search can never sneak in.
- **Search is left alone:** applying a chip, and clearing via a pressed chip, replace/clear only the structured criteria and keep the current search text — search is not part of a quick filter, so a chip must not touch it.
- **"Active criterion" (AC1) and "equals" (AC3) mean structured criteria only:** a search-only filter does not enable _Save_, and the pressed check ignores the search — consistent with the decision above.
- **Cap behaviour:** at 8 saved filters _Save as quick filter_ is disabled with visible text ("You can keep 8 quick filters — delete one first"), and main refuses a 9th as a value — one rule, visible before the user types a name.
- **Names:** trimmed, 1–32 characters, unique case-insensitively; 32 keeps a chip on one line in the rail.
- **Overwrite (AC5):** a taken name in the save dialog shows the reason plus an explicit _Overwrite_ button; rename to a taken name is refused without an overwrite offer — overwriting on rename would silently delete another filter.
- **Rename/delete trigger (AC4):** a kebab `Menu` on each custom chip (mirrors `ControlsCategoryMenu`), `size="sm"` — recorded as a CLAUDE.md deviation row by the implementing D, like every other dense kebab.
- **Persistence:** `ServersState.quickFilters` with per-row `safeParse` in `parseServersState` (envelope `.catch([])`); unknown gamemode, bad name, no active criterion, duplicate name or rows beyond the 8th are skipped silently — AC8 and the cap hold even for a hand-edited file.
- **IPC:** new `quickFilters.*` handlers inside the existing `servers` module namespace (`SERVERS_HANDLERS` + `SERVERS_HANDLER_SCHEMAS`), no new `ipc.ts` channel — the module bus already carries servers traffic.
- **Restart proof (AC6):** e2e uses the `servers-sort-order.mjs` precedent — state.json read off disk plus `page.reload()` — and the boot path is proven by the `parseServersState` unit test.

## Plan

1. **Shared (D1):** `src/shared/servers/quick-filters.ts` — `QuickFilterCriteria` type, `QuickFilter`
   (`id, name, criteria`), `QUICK_FILTER_MAX = 8`, `QUICK_FILTER_NAME_MAX = 32`, pure helpers
   `criteriaOf(filter)`, `hasCriteria(c)`, `sameCriteria(a, b)`, `applyCriteria(filter, c)` (keeps
   `search`), `clearCriteria(filter)` (keeps `search`), `validateQuickFilterName(name, list, exceptId?)`.
   Zod schema `quickFilterSchema` in `src/shared/modules/servers.ts`; `ServersState.quickFilters`;
   defensive per-row parse in `src/main/lib/schemas.ts`.
2. **Main (D2):** pure list ops `src/main/modules/servers/quick-filter-entries.ts` (`save` with
   `overwrite`, `rename`, `remove`; `{ok:true,list}|{ok:false,reasonKey}`), four handlers
   `quickFilters.list/save/rename/remove` + payload schemas, persisted via `setServersState`.
3. **Renderer save + apply (D3):** client methods, `useQuickFilters` hook, _Save as quick filter_
   button + name dialog with overwrite, custom chips under the built-ins with apply/pressed/clear,
   cap and no-criteria reasons as visible text, new flow `servers-quick-filters`.
4. **Renderer rename/delete + resilience (D4):** chip kebab menu (rename dialog, delete), CLAUDE.md
   deviation row, flow steps for AC4/AC6/AC7/AC8, CHANGELOG entry.

Order: D1 → D2 → D3 → D4. Nothing in the shell changes; all work lives in the servers module.

## Deliverables

- **D1 — Quick-filter model, schema and defensive parse.** Create `src/shared/servers/quick-filters.ts`
  (pure, no node/DOM — mirror the style of `src/shared/servers/list-filter.ts`):
  `type QuickFilterCriteria = Omit<ServerListFilter, 'search'>`; `interface QuickFilter { id: string; name: string; criteria: QuickFilterCriteria }`;
  `QUICK_FILTER_MAX = 8`; `QUICK_FILTER_NAME_MAX = 32`; `criteriaOf(f: ServerListFilter)`;
  `hasCriteria(c)` (any select non-null or toggle true); `sameCriteria(a, b)` (field-wise, mod/map
  case-insensitive like `matchesText`); `applyCriteria(f, c)` → `{ ...c, search: f.search }`;
  `clearCriteria(f)` → `{ ...EMPTY_SERVER_LIST_FILTER, search: f.search }`;
  `validateQuickFilterName(name, list, exceptId?)` → `null | 'empty' | 'tooLong' | 'taken'` (trimmed,
  case-insensitive uniqueness, `exceptId` skips the entry being renamed). In
  `src/shared/modules/servers.ts`: `quickFilterCriteriaSchema` + `quickFilterSchema` (strict; name
  trimmed 1–32; gamemode via the existing `ServerGamemode` enum; refine `hasCriteria`), add
  `quickFilters: QuickFilter[]` to `ServersState`, `serversStateSchema` and `DEFAULT_SERVERS_STATE`
  (`[]`). In `src/main/lib/schemas.ts` `parseServersState` (~l.1359): envelope
  `z.array(z.unknown()).catch([])`, per-row `safeParse` → `null` filtered out (mirror
  `parseWatchlistEntryRow`), then drop case-insensitive duplicate names (first wins) and keep the
  first `QUICK_FILTER_MAX`. Tests: `src/shared/servers/quick-filters.test.ts` (helpers), and in
  `src/main/lib/schemas.test.ts` › "parseServersState skips a damaged quick filter and keeps the
  others" (unknown gamemode, missing name, empty criteria, non-object, duplicate name, 9th row;
  missing key → `[]`; never throws). Fix any `ServersState` literal in existing tests that the new
  required field breaks.

- **D2 — Main quick-filter handlers.** Create `src/main/modules/servers/quick-filter-entries.ts`
  (pure, mirror `watchlist-entries.ts` incl. injectable `mintId`): `saveQuickFilter(list, {name,
criteria, overwrite}, mintId)` — refuses `servers.quickFilter.error.noCriteria` (via `hasCriteria`),
  `.empty`, `.tooLong`, `.taken` (only when `overwrite` is false; with `overwrite: true` replaces the
  criteria of the same-named entry **in place**, keeping its id and position), `.cap` when adding a
  new one at `QUICK_FILTER_MAX`; stores the trimmed name; appends new entries (creation order).
  `renameQuickFilter(list, {id, name})` — `.notFound`, `.empty`, `.tooLong`, `.taken` (excluding
  itself; no overwrite on rename). `removeQuickFilter(list, {id})` — idempotent. Results are
  `{ok:true, list} | {ok:false, reasonKey}`. In `src/shared/modules/servers.ts` add to
  `SERVERS_HANDLERS`: `quickFiltersList: 'quickFilters.list'`, `quickFiltersSave:
'quickFilters.save'`, `quickFiltersRename: 'quickFilters.rename'`, `quickFiltersRemove:
'quickFilters.remove'`, their strict zod payload schemas (`z.void()`, `{name, criteria:
quickFilterCriteriaSchema, overwrite: boolean}`, `{id, name}`, `{id}`) in
  `SERVERS_HANDLER_SCHEMAS` (~l.911), and a `QuickFiltersResult` type. In
  `src/main/modules/servers/index.ts` register the handlers (always, not behind the watchlist
  unlock gate) with the read/replace/persist pattern of `listSetSort` (~l.319-335) over
  `serversState().quickFilters` / `setServersState`. Add the reason keys to
  `src/renderer/src/i18n/locales/en` (servers namespace). Tests:
  `src/main/modules/servers/quick-filter-entries.test.ts` (every refusal, overwrite keeps id+place,
  cap, trim, idempotent remove) and `src/main/modules/servers/index.test.ts` › "quick filter
  handlers persist to servers state".

- **D3 — Save a filter and apply it from a chip.** Files: `src/renderer/src/modules/servers/client.ts`
  (four methods for `quickFilters.*`); new `src/renderer/src/modules/servers/useQuickFilters.ts`
  (loads the list on mount, exposes `save/rename/remove` returning the result; a failed load leaves
  `[]` and never toasts — mirror `watchlist/useWatchlist.ts`); new
  `src/renderer/src/modules/servers/QuickFilterNameDialog.tsx` (mirror
  `src/renderer/src/modules/replays/RenameDemoDialog.tsx`: `Modal`/`Field`/`Input`/`Button`, live
  `validateQuickFilterName` error in the field's error slot; on `taken` shows the reason plus an
  _Overwrite_ button that re-submits with `overwrite: true`; a main refusal shows its `reasonKey` in
  the same slot; props allow a rename mode without the overwrite button for D4);
  `src/renderer/src/modules/servers/ServerListFilterBar.tsx` (new props `quickFilters`, `onSaveQuickFilter`,
  plus whatever D4 needs; in the existing "quick" section, after the three built-in `FilterChip`s
  which stay **unchanged**, one chip per saved filter in list order, `data-testid="servers-quickfilter-chip"`,
  label = name, `active = sameCriteria(criteriaOf(filter), qf.criteria)` rendered with the same
  flame edge + `Check` + `aria-pressed` as `FilterChip`; click → `onChange(active ? clearCriteria(filter) :
applyCriteria(filter, qf.criteria))`; below the chips a _Save as quick filter_ `Button`
  `data-testid="servers-quickfilter-save"`, disabled with a visible reason line
  `servers-quickfilter-save-reason` when `!hasCriteria(criteriaOf(filter))` ("Set a mod, gamemode,
  map or quick toggle first") or at `QUICK_FILTER_MAX` ("You can keep 8 quick filters — delete one
  first")); `src/renderer/src/modules/servers/ServersView.tsx` (~l.544: wire the hook and dialog);
  en locale keys. Tests: `ServerListFilterBar.test.tsx` (pressed state, apply keeps search, clear,
  disabled reasons, built-ins unchanged) and new flow `scripts/flows/servers-quick-filters.mjs`
  (mirror `servers-filter-search.mjs` + `servers-sort-order.mjs` for fixture/stub and state.json
  reads) covering AC1, AC2, AC3, AC5, AC9.

- **D4 — Rename/delete from the chip, persistence and resilience.** Files: new
  `src/renderer/src/modules/servers/QuickFilterChipMenu.tsx` (mirror
  `src/renderer/src/modules/config/components/ControlsCategoryMenu.tsx`: `Menu`/`MenuItem` +
  `size="sm"` `IconButton` with `MoreVertical`, `data-testid="servers-quickfilter-menu"`, items
  _Rename_ → `QuickFilterNameDialog` in rename mode, _Delete_ → `remove(id)` only — never calls
  `onChange`, so the current filter is untouched); `ServerListFilterBar.tsx` (place the kebab beside
  each custom chip); `ServersView.tsx` (wire rename/remove); en locale keys; add a `/design-tokens`
  deviation row to `CLAUDE.md` for the 28px kebab (reason: desktop mouse-and-keyboard app, this
  story); one `### Added` line in `CHANGELOG.md` under `## Unreleased` ("Save your server filter as a
  named quick filter and reapply it with one click."). Tests: extend
  `scripts/flows/servers-quick-filters.mjs` with steps for AC4 (rename, delete while pressed leaves
  the filter and the no-match/count state as it was), AC6 (state.json holds `servers.quickFilters`,
  chips survive `page.reload()`), AC7 (fixture seeds a quick filter with a mod no row carries → applies,
  mod select shows the value, `servers-filter-no-match` shows, bar intact), AC8 (fixture seeds one
  damaged entry beside two good ones → two chips, no toast); plus `ServerListFilterBar.test.tsx` ›
  "deleting a quick filter never calls onChange".

## Model Hints

- All Ds on the default tier — the logic is small and pure, each pattern (watchlist list ops,
  `listSort` persistence, `ControlsCategoryMenu`, `RenameDemoDialog`) already exists to mirror.

Review: → default — every AC is observable in the flow or a unit test; no rigged number or invisible structural claim.

## Acceptance Tests

Flow run target: `npm run ui:flow -- servers-quick-filters`.

- AC1 → e2e `scripts/flows/servers-quick-filters.mjs` › "servers-quick-filters" (step: save disabled with visible reason on an empty filter, enabled after picking a mod, dialog asks for a name) + unit `src/renderer/src/modules/servers/ServerListFilterBar.test.tsx` › "save as quick filter is disabled with a reason without criteria or at the cap" (D3)
- AC2 → e2e `scripts/flows/servers-quick-filters.mjs` › "servers-quick-filters" (step: saved chip appears; after changing the filter, clicking it restores exactly the saved criteria) + unit `src/shared/servers/quick-filters.test.ts` › "applyCriteria replaces the criteria and keeps the search" (D1/D3)
- AC3 → e2e `scripts/flows/servers-quick-filters.mjs` › "servers-quick-filters" (step: chip `aria-pressed` + check icon while equal, click clears) + unit `ServerListFilterBar.test.tsx` › "a quick filter chip shows pressed with a check mark when the filter equals it" (D3)
- AC4 → e2e `scripts/flows/servers-quick-filters.mjs` › "servers-quick-filters" (step: rename via kebab; delete leaves the current filter unchanged) + unit `ServerListFilterBar.test.tsx` › "deleting a quick filter never calls onChange" (D4)
- AC5 → unit `src/main/modules/servers/quick-filter-entries.test.ts` › "save refuses an empty or taken name and overwrites only when asked" (D2) + e2e `scripts/flows/servers-quick-filters.mjs` › "servers-quick-filters" (step: taken name shows reason + Overwrite, overwrite keeps one chip) (D3)
- AC6 → e2e `scripts/flows/servers-quick-filters.mjs` › "servers-quick-filters" (step: `servers.quickFilters` in state.json, chips after reload) (D4) + unit `src/main/modules/servers/index.test.ts` › "quick filter handlers persist to servers state" (D2)
- AC7 → e2e `scripts/flows/servers-quick-filters.mjs` › "servers-quick-filters" (step: seeded filter with an absent mod applies and shows `servers-filter-no-match`) (D4)
- AC8 → unit `src/main/lib/schemas.test.ts` › "parseServersState skips a damaged quick filter and keeps the others" (D1) + e2e `scripts/flows/servers-quick-filters.mjs` › "servers-quick-filters" (step: seeded damaged entry, two good chips, no toast) (D4)
- AC9 → e2e `scripts/flows/servers-quick-filters.mjs` › "servers-quick-filters" (step: waiting/empty/hide-bots toggles still toggle with custom chips present) + regression `npm run ui:flow -- servers-filter-search` (D3)

Coverage gate: AC1 D3 · AC2 D1+D3 · AC3 D3 · AC4 D4 · AC5 D2+D3 · AC6 D2+D4 · AC7 D4 · AC8 D1+D4 · AC9 D3 — every criterion has a D and a test.

## Done

Quick filters are saved, applied, renamed and deleted from the servers filter bar: shared model + defensive
persisted parse (D1), main list ops and `quickFilters.*` handlers (D2), Save button/name dialog/chips (D3),
chip kebab menu, CLAUDE.md deviation row, CHANGELOG line and persistence/resilience flow steps (D4).

Commit message: `197: save a filter as a quick filter — shared model + defensive parse, quickFilters.* handlers, save dialog, chips, rename/delete menu, flow`

Verification (narrow gate): `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (2098 tests) green; `npm run ui:flow -- servers-quick-filters` green (AC1-AC9 steps all ran). Regression flow `servers-filter-search` red only at the known pre-existing step "AC1: mod=baseq2 shows B and C" (not touched). AC -> test as verified: AC1-AC9 per `## Acceptance Tests`, all named tests exist and passed; no manual residue. Review (default stage): PASS, no blocking findings.

Decisions: the repo had no zod enum for `ServerGamemode`, so `servers.ts` defines a local `serverGamemodeSchema`. A transport failure on a mutation returns the new key `servers.quickFilter.error.failed`. Overwrite at the cap is allowed in the pure function (adds nothing) but unreachable from the UI. Deliberately unfixed review notes: the flow's AC8 "no error toast" check only looks at filter-worded toasts (an unrelated installations toast is always present in the fixture; the dropped damaged entry is proven by the chip count); "deleting a quick filter never calls onChange" is a thin unit test, the real wiring is proven by the flow's delete-while-pressed step.

tiers: D 4 / hard 0 · review default · cycles 1 · agents 6
