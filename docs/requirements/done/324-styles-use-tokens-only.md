---
id: 324
title: Styles use tokens only, and UI kit controls keep their own rules
status: done # draft -> ready -> in-progress -> done
created: 2026-10-30
---

## Requirement

Overdue rows TD-004, TD-006, TD-021, TD-026 and TD-032 are renderer style and UI-kit debt: rgb
literals instead of tokens, 51 arbitrary micro font sizes, a radio row below the size floor without
a deviation, a dialog confirm that ignores `canSubmit`, a dangling `aria-labelledby`, and a grid that
re-renders every row.

## Acceptance Criteria

- [x] **AC1** — `controls-grid.css` and `surfaces.css` contain no rgb/hex colour literal; a check
      fails when one is added under `src/renderer/src/styles/` (TD-004).
- [x] **AC2** — Font sizes come from a typography token scale; no arbitrary `text-[Npx]` class
      remains in the renderer, enforced by a check (TD-006).
- [x] **AC3** — The mods remove dialog's changed-files radios are at least 24px high (TD-021).
- [x] **AC4** — DeleteCategoryDialog's confirm is disabled while `canSubmit` is false; no TabPanel
      has an `aria-labelledby` pointing at a missing element, verified by the axe report (TD-026).
- [x] **AC5** — Re-rendering `ControlsGrid` with unchanged props does not re-render unchanged
      `ControlsEntryRow`s; row tests cover compactAdd, extra-key rows and drop toggles (TD-032).
- [x] **AC6** — Rows TD-004, TD-006, TD-021, TD-026 and TD-032 are removed from `docs/TECH-DEBT.md`.

## Open Questions

~~Typography scale: how many steps (proposal: four micro steps, 11/12/13/14px), and may a size move~~ answered → Decisions (Sprint)
by 1px to land on a step?

~~Q1 — sizes below the 11–14px micro scale (18 sites at 7–9.5px): A all → 11px, B a separate legend tier, or C stencil/hex → 11px and keycap legends → one 8px token?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** sizes below the 11–14px scale (Q1): option C — stencil and hex labels move to 11px; keycap legends get one 8px `--text-keycap` token
- **(User)** typography scale steps: four micro steps 11/12/13/14px; a size may move by 1px to land on a step
- Micro token names are `text-2xs` (11px, new), `text-xs` (12px, Tailwind default), `text-compact` (13px, new), `text-sm` (14px, Tailwind default) — reusing the two defaults that already equal a step avoids two tokens with the same value.
- Display sizes (≥15px) are outside the user's micro decision, so they keep their exact size: Tailwind's default step where it matches (18, 20), otherwise an exact named token (22, 26, 56px) — no visible change where nobody decided one.
- The 11.5px CvarRow flag text rounds to 12px and 10/10.5px to 11px — each is within the user's 1px allowance and lands on the nearest step.
- AC2's check also covers `font-size:` in `styles/*.css`, not only `text-[Npx]` classes — otherwise the debt just moves into the style sheets and "font sizes come from a token scale" stays false.
- The colour check scans all of `styles/`, exempting only `index.css`'s `@theme` block — AC1 says "under `src/renderer/src/styles/`", and the token definitions are the one place literals belong.
- Alpha tints become `color-mix(in srgb, var(--color-X) N%, transparent)` — the form `controls-grid.css` already uses, so no new token per opacity.
- TD-021 is fixed in the shared `Radio` primitive (24px label floor), not in the mods dialog — the 24px floor in CLAUDE.md applies to every in-row control, and one fix covers all radios.
- DeleteCategoryDialog's `canSubmit` also requires the move target to still exist in `otherCategories` — with today's code `canSubmit` can never be false, so wiring it alone is unobservable; a target removed by a re-render is the real state it must guard.
- The servers body is a plain container while the watchlist strip is hidden — with no tab there is nothing to label it, and a `tabpanel` role without a tab is itself wrong.
- AC4's labelling half is proven by the existing `ui:verify` axe report on the `servers-list-*` screens (`aria-valid-attr-value` is a critical rule, so it exits 2) — no new flow needed.
- AC3 is a step in the existing `mods-remove` flow, not a new flow — that flow already opens the changed-files radios.
- Module docs are touched only for config and servers, where behaviour changes; the pure class swaps in downloads, home and replays change no system behaviour, so a sprint-review "module doc not touched" note for them is expected and answered here.
- The two 8px tile corner tags (`surfaces.css` `.tile-demo-tag`, `.tile-failed-tag`) and the 9.5px `.ctrl-cap` count as stencil labels and move to 11px — option C reserves the keycap token for the keyboard-panel legends only, and these are read text, not key geometry.
- If an 11px tile tag crowds the tile in the `ui:verify` screenshot, padding/letter-spacing shrink, never the size — the size is the user's decision, the spacing is not.
- The typography check also fails when `text-keycap` appears outside `OverviewKeyboardPanel.tsx` — otherwise the 8px token becomes a back door for every label someone finds too big at 11px.
- D8 is the one `deliverable-hard`; review stays default — the colour/size sweeps are checked by their own scanning tests and a default reviewer can read the token mapping in the diff.

## Plan

Five independent fixes, one D each, plus the typography sweep cut by directory (26 files carry
`text-[Npx]`) and a closing doc D. Order: D1 → D2 → D3 → D4 → D5 (D5 adds the typography check,
so it lands after the sweep), then D6–D8 in any order, D9 last.

1. **Colours (TD-004)** — `controls-grid.css`, `surfaces.css` and `config-syntax.css` express every
   colour through `var(--color-*)` / `color-mix(... var(--color-*) N%, transparent)`; a node test
   scans `styles/*.css` (excluding only `index.css`'s `@theme` block) for rgb/rgba/hsl/hex.
2. **Typography (TD-006)** — `@theme` gets the micro scale (11/12/13/14px, user decision) plus
   exact display tokens; CSS `font-size:` in `styles/` and every `text-[Npx]` class move onto it;
   a node test fails on any arbitrary size. Sub-11px: stencil/hex labels and tile tags → 11px, keycap
   legends (7/8px, keyboard panel only) → one 8px `--text-keycap` token (user decision).
3. **Radio (TD-021)** — the shared `Radio` label in `components/ui/RadioGroup.tsx` gets a 24px
   floor, fixing the mods remove dialog and every other radio at once.
4. **UI kit (TD-026)** — DeleteCategoryDialog passes `confirmDisabled={!canSubmit}` and its
   `canSubmit` requires the target to still be in `otherCategories`; ServersView renders a plain
   container instead of a `TabPanel` while the tab strip is hidden.
5. **ControlsGrid (TD-032)** — rows receive a stable grip so `memo` skips unchanged rows; row tests
   for compactAdd, extra-key rows and drop toggles.
6. **Docs** — TECH-DEBT rows removed, ARCHITECTURE.md token paragraph, config/servers system docs.

## Deliverables

- [x] **D1 — Colour literals become tokens (TD-004).** Files: `src/renderer/src/styles/controls-grid.css`,
      `surfaces.css`, `config-syntax.css`, `index.css` (only if a needed token is missing), new
      `src/renderer/src/styles/colour-literals.test.ts`. Replace every `rgb()/rgba()/hsl()/#hex`
      with a token: an alpha tint of an existing token is `color-mix(in srgb, var(--color-X) N%,
transparent)` (the pattern already at `controls-grid.css:78`); pure black/white shades and the
      two `surfaces.css:24` gradient stops get named tokens in `index.css`'s `@theme` block if none
      matches. Visible colours stay the same (pick the token whose value equals the literal's rgb).
      The test (`// @vitest-environment node`, read files like `side-tokens.test.ts`) reads every
      `styles/*.css`, strips `index.css`'s `@theme { ... }` block, and fails naming file:line for any
      colour literal. Test › "style sheets name colours through tokens only".
- [x] **D2 — Typography token scale and CSS sizes (TD-006).** Files: `src/renderer/src/styles/index.css`
      (`@theme`), `controls-grid.css`, `surfaces.css`, `config-syntax.css`, `home-hero.css`,
      `dashboard.css`, `docs/ARCHITECTURE.md` (the token paragraph near line 504: name the scale and
      both checks). Micro scale: `--text-2xs: 0.6875rem` (11px) and `--text-compact: 0.8125rem`
      (13px) are new; 12px is Tailwind's `text-xs`, 14px `text-sm`. Display sizes (≥15px) use
      Tailwind's default step when one equals the size (18 = `text-lg`, 20 = `text-xl`), otherwise an
      exact named token (`--text-display-sm` 22px, `--text-display` 26px, plus whatever CSS needs,
      e.g. 56px for `surfaces.css:227`). Also add `--text-keycap: 0.5rem` (8px) — reserved for the
      keyboard-panel keycap legends (D5), used nowhere else. Every `font-size:` in `styles/` becomes
      `var(--text-*)`; a micro size moves at most 1px to its nearest step (10/10.5 → 11, 11.5 → 12).
      Sub-11px CSS sizes move up to 11px (`var(--text-2xs)`): `surfaces.css` `.tile-demo-tag` and
      `.tile-failed-tag` (8px) and `controls-grid.css` `.ctrl-cap` (0.594rem). If an 11px tile tag
      crowds the tile in the `ui:verify` screenshot, reduce its padding/letter-spacing — never the size.
- [x] **D3 — Size class sweep, shell and UI kit.** Files: `src/renderer/src/components/about/AboutPanel.tsx`,
      `components/shell/{ActionBar,BootSplash,InstallationRail,TitleBar,UpdateAction}.tsx`,
      `components/ui/{ErrorBoundary,primitives}.tsx`. Replace each `text-[Npx]` with the token class
      per the D2 mapping (11 → `text-2xs`, 12 → `text-xs`, 13 → `text-compact`, 14 → `text-sm`,
      10 → `text-2xs`, 11.5 → `text-xs`, 18/20 → `text-lg`/`text-xl`, 22/26 → `text-display-sm`/
      `text-display`; 9px stencil labels → `text-2xs`). Tailwind's `text-xs`/`text-sm` also set a
      line-height the arbitrary class did not; where that shifts layout in the `ui:verify`
      screenshot, add an explicit `leading-*` class to restore it.
      `ErrorBoundary.tsx`'s inline `fontSize: '0.875rem'` stays (render-failure fallback must not
      depend on the stylesheet).
- [x] **D4 — Size class sweep, installations, views and small modules.** Files:
      `src/renderer/src/components/installations/{DetectDialog,EngineSection,RunnerSection}.tsx`,
      `views/{LibraryView,PlannedModuleView}.tsx`, `modules/downloads/components/{FailureLogEntry,JobRow}.tsx`,
      `modules/home/dashboard/PlaytimeTile.tsx`. Same mapping and rules as D3 (11 → `text-2xs`,
      12 → `text-xs`, 13 → `text-compact`, 14 → `text-sm`, 10 → `text-2xs`; 9px stencil/section
      labels → `text-2xs`).
- [x] **D5 — Size class sweep, config/replays/servers, and the check.** Files:
      `src/renderer/src/modules/config/{CareItemRow,ImportProfileDialog,LayersPanel,OverviewKeyboardPanel,SettingsTab}.tsx`,
      `modules/config/components/{CvarRow,SymbolPicker}.tsx`, `modules/replays/components/DemoRow.tsx`,
      `modules/servers/{ServerRow,watchlist/WatchlistMatchRow}.tsx`, new
      `src/renderer/src/styles/typography-tokens.test.ts`. Same mapping as D3 (11.5 → `text-xs`;
      `SymbolPicker.tsx`'s 9px hex label → `text-2xs`). Keycap legends in
      `OverviewKeyboardPanel.tsx` (`text-[8px]` ×2, `text-[7px]` ×1) all become `text-keycap` (8px,
      token from D2) — they must keep fitting the keycap. The test (node env) walks
      `src/renderer/src/**/*.{ts,tsx}` (excluding `*.test.*`) for `text-\[\d`, fails when
      `text-keycap` appears in any file other than `modules/config/OverviewKeyboardPanel.tsx`, and
      checks `styles/*.css` for a `font-size:` whose value is not `var(--text-…)` or `inherit`,
      failing with file:line. Test › "font sizes come from the typography scale".
- [x] **D6 — Radio rows meet the 24px floor (TD-021).** Files: `src/renderer/src/components/ui/RadioGroup.tsx`
      (the `Radio` label gets `min-h-6`), `scripts/flows/mods-remove.mjs` (new step before checking
      `mods-remove-changed-delete`: the labels of `mods-remove-changed-keep` and `-delete` each have
      a bounding box ≥ 24px high, pushing to `failures` like the flow's other checks). Step ›
      "the changed-files radios are at least 24px high".
- [x] **D7 — Dialog confirm and tab-panel labelling (TD-026).** Files:
      `src/renderer/src/modules/config/components/DeleteCategoryDialog.tsx`, new
      `DeleteCategoryDialog.test.tsx` beside it, `src/renderer/src/modules/servers/ServersView.tsx`,
      new `src/renderer/src/modules/servers/ServersView.test.tsx` only if ServersView renders in jsdom
      with the existing test-support fakes (`src/test-support/`), else the axe line alone proves it.
      DeleteCategoryDialog: `canSubmit` = 'delete', or 'move' with `targetId` present in the current
      `otherCategories`; pass `confirmDisabled={!canSubmit}` to `ConfirmDialog`
      (`components/ui/ConfirmDialog.tsx` already has the prop). ServersView: render `TabPanel` only
      when `useFeatureUnlocked('watchlist')` is true (same condition as `ServersTabStrip`), else a
      plain `div` with the same className. Tests › "the confirm stays disabled once the chosen move
      target is gone" (rerender with the target removed from `otherCategories`); "with the watchlist
      locked the servers body carries no tab-panel labelling".
- [x] **D8 — Unchanged Controls rows skip re-render (TD-032).** Files:
      `src/renderer/src/modules/config/components/ControlsGrid.tsx`, `ControlsEntryRow.tsx`,
      `modules/config/ControlsTab.tsx` (the `renderRow` caller), `ControlsEntryRow.test.tsx`,
      `ControlsGrid.dnd.test.tsx` only if its expectations reference the grip element. Make the grip
      stable per row (e.g. pass grip inputs — entry id, disabled state, reason — as primitive props
      and build the element inside the memoised row, or memoise per id); every prop and `ctx` field a
      row reads must be referentially stable across a parent re-render with unchanged data. Tests in
      `ControlsEntryRow.test.tsx`: "re-rendering the grid with unchanged props re-renders no row"
      (count row renders via React `Profiler` `onRender` or a render counter in a test wrapper — never
      by mocking `memo`), "a compact add row assigns its key", "an extra-key row writes its own
      slot", "toggling drop on a row changes only that row". Run `controls-drag-reorder` and
      `controls-extra-keys` flows.
- [x] **D9 — Docs close the debt.** Files: `docs/TECH-DEBT.md` (delete rows TD-004, TD-006, TD-021,
      TD-026, TD-032), `docs/systems/config-module.md` (one line: rows are memoised, grip stable),
      `docs/systems/servers-module.md` (one line: the body is a tab panel only while the strip shows).
      `CHANGELOG.md`: one `### Fixed` line under `## Unreleased` only for the user-visible part
      ("Radio options and small labels are easier to hit and read" style, ≤15 words).

## Model Hints

- D8 → deliverable-hard: once `memo` can actually skip rows, any row callback or drag listener that
  is not referentially stable becomes a stale closure, so a drop or key assign silently acts on an
  old entry list — a cross-file regression across ControlsGrid, ControlsEntryRow and ControlsTab
  that the current row tests do not catch.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/renderer/src/styles/colour-literals.test.ts` › "style sheets name colours through tokens only" (D1)
- AC2 → unit `src/renderer/src/styles/typography-tokens.test.ts` › "font sizes come from the typography scale" (D2–D5)
- AC3 → e2e `scripts/flows/mods-remove.mjs` › step "the changed-files radios are at least 24px high" (D6)
- AC4 → unit `src/renderer/src/modules/config/components/DeleteCategoryDialog.test.tsx` › "the confirm stays disabled once the chosen move target is gone"; e2e `npm run ui:verify` › axe report for the `servers-list-*` screens has no `aria-valid-attr-value` violation (exit code not 2); unit `src/renderer/src/modules/servers/ServersView.test.tsx` › "with the watchlist locked the servers body carries no tab-panel labelling" if D7 can render it (D7)
- AC5 → unit `src/renderer/src/modules/config/components/ControlsEntryRow.test.tsx` › "re-rendering the grid with unchanged props re-renders no row", "a compact add row assigns its key", "an extra-key row writes its own slot", "toggling drop on a row changes only that row" (D8)
- AC6 → `node scripts/check-docs.mjs` stays green and `grep -E "TD-0(04|06|21|26|32)" docs/TECH-DEBT.md` is empty — checked in D9's review (doc-only criterion, no runtime behaviour)

## Done

Styles name colours through tokens and sizes through a typography scale (11/12/13/14px micro steps, display tokens, one 8px keycap token), each guarded by a node test. The shared `Radio` has a 24px floor, DeleteCategoryDialog's confirm honours `canSubmit`, ServersView drops its dangling tab-panel labelling, and Controls rows are memoised with a grip built inside the row.

**Commit message:** `324: colour literals + arbitrary font sizes replaced by tokens with scanning checks, Radio 24px floor, DeleteCategoryDialog canSubmit, ServersView no dangling tabpanel, memoised Controls rows, TD-004/006/021/026/032 closed`

**Verification (narrow gate):** build, typecheck, lint green; `npx vitest run --changed HEAD` green (82 files, 593 tests); `ui:verify` exit 0 (no critical/serious axe, no aria-valid-attr-value). Flows run by name with fresh seeds (`npm run ui:flows -- mods-remove controls-extra-keys controls-drag-reorder controls-subcategory controls-category-rename-reorder grenade-rows-take-a-key --parallel=4`): 6/6 passed. The `--affected` e2e-story selection was not usable: the CSS/class sweep selects most of the suite and shard 1/2 exceeded the 10-minute ceiling (stopped, not observed), so the story's own flow plus the config flows D8/D3 touch were run by name instead. `ui:flow -- <name>` does not reseed: running controls-drag-reorder then controls-extra-keys in one session fails the second (Attack moved to Weapons) - not a product defect. Review 1 (default tier): PASS. AC1 colour-literals.test.ts passed; AC2 typography-tokens.test.ts passed; AC3 mods-remove step passed; AC4 DeleteCategoryDialog + ServersView tests passed, ui:verify exit 0; AC5 four ControlsEntryRow tests passed; AC6 rows gone, `check-docs` exit 0. No manual residue.

**Decisions:**

- Both new scanning tests are node-only: excluded from `tsconfig.web.json`, included in `tsconfig.node.json`, like `side-tokens.test.ts`.
- New colour tokens (shade, glint, night, void-deep, backdrop-top/-bottom, danger-hi/-lo/-edge/-ink) hold the exact old literals; alpha tints use `color-mix`.
- ServersView.test.tsx already existed; the locked-watchlist test was appended.
- D8: grip passed as inputs (`ControlsRowGrip`) and built by `ControlsGripHandle` inside the row; per-row edited/revealed/expanded state became boolean props instead of Sets in ctx.
- Open visual points (not re-opened, size is the user's decision): 11px tile tags/`.ctrl-cap` and TitleBar `leading-normal` were not eyeballed in screenshots. Docs for downloads/home/replays modules not touched (class swaps only), as decided.

Regression gate: `architecture` per-file purity checks and tsconfig excludes failed at the sprint gate (two style tests excluded); fixed in 19c57151.

tiers: D 9 / hard 1 · review default · cycles 0 · agents 11
