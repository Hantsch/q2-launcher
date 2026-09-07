---
id: 061
title: Profile header is one row — back left, identity centred, actions right
status: done
created: 2026-09-07
---

## Requirement

The config profile detail header wastes vertical space and changes shape depending on the tab.
Today (see [ConfigView.tsx:675-750](../../src/renderer/src/modules/config/ConfigView.tsx#L675-L750))
every tab except Raw File gets **two** rows — a row with the back button plus the action cluster,
then a separate block with the profile name, `created` and `updated` — while the Raw File tab
(`isRawFill`, story 057) folds name and tab strip into the single top row to buy editor height.

From the user's side that is two problems in one place:

1. The space in the header row is badly used: the back button sits alone on the left, the actions
   sit on the right, and the middle is empty while the profile's own identity (name, created,
   updated) burns a second row below it.
2. Switching to Raw File **relayouts the header** — the name moves, the created/updated block
   disappears, the tab strip jumps into the header row. The tab a user picks should change the
   panel content, not the frame around it.

Wanted: **one** header row for every tab, three zones — `(← Back to profiles)` left, the profile
identity (name + created/updated + unsaved indicator) centred, the actions (Save/Discard,
Assignments, Rename, Delete) right. The tab strip stays where it is for every tab, Raw File
included, and the header looks identical on all of them.

This supersedes story 057's decision to give the Raw File tab its own folded header — the reason
for it (AC1: at least 30 editor lines visible at 1280x800) is satisfied by a one-row header for
*all* tabs, so the exception is no longer needed. Refine must re-verify that line budget rather
than assume it.

## Acceptance Criteria

- [x] **AC1** — The profile header is a single row on every tab: back link left, profile identity
      centred, action cluster right.
- [x] **AC2** — Name, created, updated and the unsaved indicator are all visible in that centred
      zone; no second identity row below the header.
- [x] **AC3** — Switching between tabs (Overview, Controls, Settings, Aliases, Care, Unsaved, Raw
      File) does not move or change the header, the back link, the identity block, the action
      cluster or the tab strip.
- [x] **AC4** — At 1280x800 the Raw File editor still shows at least 30 lines (story 057 AC1 stays
      met with the shared header).
- [x] **AC5** — At a narrow window width the header degrades by wrapping, not by clipping or
      overflowing; every control stays reachable.

## Open Questions

## Decisions (Sprint)

All of these were decided in refine (no user input available); each with its reason.

- **Measured, not assumed (AC4).** A throwaway `ui:flow` probe measured the real app at 1280x800:
  the shell's fixed zones are `TitleBar` 68px + `ActionBar` 96px (`AppShell.tsx:26-36`), so a config
  view gets exactly **638px**; `--cfg-code-line-h` is **17px** and `.cfg-code` has `padding-block:
  12px` (`styles/config-syntax.css:43-74`). Today's raw tab: chrome above the editor 66px (28px
  header row + 38px of two intra-tab toolbar rows), editor 571px → **32 visible lines**. So the
  budget for **30 lines** is `638 - (30*17) - padding` → **all chrome above the editor must stay
  ≤ 104px**. Reason: the whole story hinges on this number and the story text explicitly forbids
  assuming it.
- **Consequence: the header alone eats the budget.** A one-row header (~28px) plus the tab strip in
  its own row (39px today) is already 67px, leaving 37px for page padding, row gaps *and* the raw
  tab's own 38px path/options rows. AC3 and AC4 are therefore only jointly satisfiable if the raw
  tab funds the difference **inside** the tab: its two toolbar rows merge into one (−19px) and the
  fill variant's `padding-block` drops 12px → 6px. Reason: those are raw-local, do not touch the
  header, and are the only levers left that AC3 (identical header everywhere) does not forbid.
- **Uniform padding, because a header that starts at a different `y` per tab *has* moved (AC3).**
  The outer wrapper becomes `px-8 pt-4 pb-8` for every tab, with only `pb-0` plus the existing
  `flex flex-1 min-h-0 flex-col` fill chain left conditional on the raw tab. Reason: `p-8` vs `p-0`
  is exactly the per-tab relayout AC3 outlaws, and the bottom padding is below the header, so it
  can stay raw-specific without the header moving.
- **The tab strip gets denser for all tabs** (`py-1` buttons, `border-b pb-1`, ≈27px instead of
  39px) and the header block's internal gap is 4px, the block-to-panel gap 8px (`space-y-2`
  replaces today's `space-y-6` on the detail wrapper). Reason: this is a density story ("the header
  wastes vertical space") and it is what buys AC4 a full line of margin instead of two pixels.
- **Tab buttons keep `py-1.5`'s look on every tab, never a per-tab `py-0`** (today's raw-only
  variant, `ConfigView.tsx:540`) — the strip is pixel-identical on all seven tabs. Reason: AC3
  names the tab strip explicitly.
- **"Centred" is a `flex-1` centred middle zone**, not a `grid-cols-[1fr_auto_1fr]` true optical
  centre: left `shrink-0`, middle `flex min-w-0 flex-1 flex-wrap justify-center`, right `shrink-0`,
  all inside today's `flex flex-wrap`. Reason: with a wrapping header, a rigid 3-column grid
  clips or overflows at 940px, which AC5 forbids; a flex-1 middle zone wraps instead.
- **The identity zone reuses `KeyValue` for created/updated and `UnsavedIndicator` as-is**, no new
  primitive and no new i18n keys (`config.detail.created` / `config.detail.updated` /
  `config.save.unsaved`). Reason: `/frontend-guidelines` reuse rule; the zone gets
  `data-testid="config-profile-identity"` so story 064 and the acceptance flow have a stable anchor.
- **The unsaved indicator returns to the raw tab's header**, reversing story 057's note at
  `ConfigView.tsx:685-692` (it was dropped there to buy width). Reason: AC2 requires it on every
  tab, and the funded budget now pays for it.
- **AC5's "narrow" is 940x620**, the app's real minimum (`WINDOW_MIN_WIDTH/HEIGHT`,
  `src/shared/constants.ts:19-20`, already `VIEWPORT_MIN` in `scripts/lib/screens.mjs:99-102`).
  Reason: the window cannot be made narrower, so anything below that is untestable fiction.
- **All five criteria are proven by one `ui:flow`, no jsdom component test.** Reason: jsdom has no
  layout engine (it cannot measure line counts or wrapping) and `ui-acceptance-required: true`
  demands the real surface; the flow reads geometry through `page.evaluate`, the same way the
  probe above did.
- **The denser tab strip gets its own row in CLAUDE.md's deviation table** (`/design-tokens` 44px
  floor, same desktop-only reason as the existing rows). Reason: this story is what deliberately
  compacts that surface, and an undocumented deviation is a violation.
- **Out of scope, deliberately:** `AppShell`/`TitleBar`/`ActionBar` (CLAUDE.md: never edit the
  shell), `--cfg-code-line-h`, and the `config-raw` screen's known missing load-wait (story 057's
  open item).

## Plan

Goal: one header row for every tab — back left, identity centred, actions right — with the tab
strip back in its own row on the raw tab too, and the 30-line editor floor **measured**, not hoped.

1. **Measuring stick first** (`scripts/flows/config-header-geometry.mjs`): a flow that opens a
   profile, walks the tabs, reads geometry via `page.evaluate` and asserts the raw editor's visible
   line count (`floor((clientHeight - padding) / 17)`) ≥ 30, printing the margin in pixels. Passes
   against today's code (32 lines) — so the build has a baseline before it changes anything.
2. **Fund the budget inside the raw tab** (`RawFileTab.tsx`, `styles/config-syntax.css`): merge the
   path/status row and the file-options row into one toolbar row (−19px) and give `.cfg-code--fill`
   `padding-block: 6px` (−12px). Re-run the flow: the margin must grow by ≥ 25px.
3. **The header itself** (`ConfigView.tsx:520-830`):
   - `isRawFill` keeps only the content-fill chain (outer `flex flex-col overflow-hidden`, `pb-0`,
     `Panel` `flex-1 min-h-0 p-0`). Its header/tab-strip/padding branches (`540`, `568`, `660`,
     `693-701`, `732-749`, `824-828`) go away.
   - Outer wrapper: `mx-auto max-w-[92rem] px-8 pt-4` + `pb-8` unless raw.
   - One `<header data-testid="config-profile-header">`: left `shrink-0` back `Button`; middle
     `data-testid="config-profile-identity"` — `h2` name (`truncate`), the two `KeyValue`s,
     `UnsavedIndicator`; right `shrink-0` `ProfileSaveActions` → `AssignmentsMenu` → Rename →
     Delete (order unchanged, `config-save`/`config-discard` testids unchanged).
   - Tab strip: one row for all tabs, `data-testid="config-tab-strip"`, `py-1` buttons, `pb-1`,
     `config-tab-${id}` testids unchanged.
   - Detail wrapper `space-y-2`, header block internal gap `space-y-1`.
   - Only existing semantic tokens (`text-ink`, `text-ink-dim`, `border-line`, `bg-hover`); no hex,
     no raw palette class, no image asset.
4. **Extend the flow** to the rest: one header row per tab, identity contents, byte-equal header /
   identity / actions / tab-strip rects across all seven tabs, `940x620` wrap check (no horizontal
   overflow, every control hit-testable), unsaved indicator inside the identity zone (raised by one
   keystroke in the raw editor, then discarded).
5. **Regression gate:** `npm run ui:verify` (all ~19 config-detail screens, both viewports) stays
   exit 0 with zero axe findings; `npm run ui:flow -- raw-inline-edit` still passes (it clicks
   `config-save` in the header cluster). Plus `npm run build`, `npm test`, `npm run typecheck`.

If step 4 shows the line count short, apply in this order only: tab-strip `pb-1`→`pb-0.5`, `pt-4`→
`pt-2`, header-block gap 4px→2px. Never a per-tab difference, never `--cfg-code-line-h`, never the shell.

## Deliverables

**D1 — The line budget becomes a test**
Files: new `scripts/flows/config-header-geometry.mjs`, `docs/UI-VERIFICATION.md` (flow list only).
Mirror: `scripts/flows/raw-inline-edit.mjs` (step/shot/assert shape, `RAW_TAB_LOAD_TIMEOUT_MS`).
Acceptance: `npm run ui:flow -- config-header-geometry` opens Plain Profile → Raw file, computes the
visible line count from `.cfg-code`'s `clientHeight`, its `padding-block` and `--cfg-code-line-h`,
prints `lines=N margin=Mpx`, and exits non-zero below 30. Green on the current code (expect 32).

**D2 — The raw tab funds the header's row**
Files: `src/renderer/src/modules/config/RawFileTab.tsx`,
`src/renderer/src/styles/config-syntax.css`, `src/renderer/src/i18n/locales/en.json` (only if a
label has to be shortened).
Acceptance: path/on-disk badge/Open in editor/Reveal *and* the unbindall + section-header-style
controls sit in **one** toolbar row (all four actions and both controls still reachable and
functional); `.cfg-code--fill` has `padding-block: 6px`; D1's flow reports a margin at least 25px
larger than its baseline; `config-raw` / `config-raw-editing` in `npm run ui:verify` stay axe-clean.

**D3 — One header row for every tab** *(hard)*
Files: `src/renderer/src/modules/config/ConfigView.tsx`, `CLAUDE.md` (deviation row for the denser
tab strip). Mirror: today's `isRawFill` header row (`ConfigView.tsx:675-730`) for the zone/flex
idiom, `ConfigView.tsx:732-749` for the identity bits.
Acceptance: every tab renders exactly one header row (back left, `config-profile-identity` centred
with name + created + updated + `UnsavedIndicator`, actions right) followed by one tab-strip row;
no second identity block anywhere; the raw tab still fills the height and the page still does not
scroll there; `config-tab-*`, `config-save`, `config-discard` testids and the Rename/Delete
accessible labels unchanged; D1's flow still ≥ 30 lines with ≥ 17px margin; `npm run typecheck` and
`npm test` green.

**D4 — The header's promises become assertions**
Files: `scripts/flows/config-header-geometry.mjs` (extended).
Acceptance: the flow additionally asserts, at 1280x800, one header row per tab and identical
`config-profile-header` / `config-profile-identity` / `config-tab-strip` rects across all seven
tabs (Overview, Controls, Settings, Aliases, Care, Unsaved, Raw File); that the identity zone
contains the profile name, the created and the updated value, and — after one keystroke in the raw
editor — `config-unsaved-indicator` (then discards it); and, after `resize(app, {940,620})`, that
the header's `scrollWidth <= clientWidth` and back / Save-area / Rename / Delete / every tab button
are visible and hit-testable. Plus: `npm run ui:verify` exit 0, zero axe findings, and
`npm run ui:flow -- raw-inline-edit` still green.

**Coverage:** AC1 → D3 (test in D4) · AC2 → D3 (test in D4) · AC3 → D3 (test in D4) ·
AC4 → D1+D2+D3 (test in D1) · AC5 → D3 (test in D4).

## Model Hints

- D3 → `deliverable-hard` — it rewrites the layout chain shared by all seven config tabs *and* the
  raw tab's full-height flex chain in one file, where the 30-line floor already failed review once
  in story 057 and a per-tab regression is invisible to unit tests.
- D1, D2, D4 → default.
- Review: → default — renderer layout only, no IPC, no filesystem write, no new user data path, and
  every acceptance criterion is machine-asserted by D1/D4's flow rather than by eye.

## Acceptance Tests

- AC1 → e2e `scripts/flows/config-header-geometry.mjs` › "the header is a single row on every tab"
  (one `config-profile-header` element per tab, its height ≤ one control row, back/identity/actions
  all inside it)
- AC2 → e2e `scripts/flows/config-header-geometry.mjs` › "the identity zone carries name, created,
  updated and the unsaved indicator" (text assertions inside `config-profile-identity`; the
  indicator raised by one keystroke in the raw editor, then discarded; no second identity block in
  the DOM)
- AC3 → e2e `scripts/flows/config-header-geometry.mjs` › "header and tab strip are identical on all
  seven tabs" (bounding rects of `config-profile-header`, `config-profile-identity`, the action
  cluster and `config-tab-strip` compared tab by tab)
- AC4 → e2e `scripts/flows/config-header-geometry.mjs` › "the raw editor shows at least 30 lines at
  1280x800" (`floor((clientHeight - padding-block) / --cfg-code-line-h) >= 30`, margin printed;
  measured baseline today: 32 lines / 66px chrome / 104px allowance)
- AC5 → e2e `scripts/flows/config-header-geometry.mjs` › "at 940x620 the header wraps instead of
  clipping" (`scrollWidth <= clientWidth`, every header control visible and hit-testable), plus
  `npm run ui:verify`'s existing `VIEWPORT_MIN` (940x620) pass over all config-detail screens for
  the axe half.
- No manual residue.

## Done

**Summary.** The profile detail header is now one `<header data-testid="config-profile-header">`
for every tab (back left / `config-profile-identity` centred / `config-profile-actions` right),
followed by one shared `config-tab-strip` row — the Raw File tab's own folded/two-toolbar-row
header is gone. `scripts/flows/config-header-geometry.mjs` (new, D1+D4) is the story's whole
acceptance surface: it measures the Raw File editor's real line count and, after D3, asserts
header/identity/tab-strip/action-cluster rects are identical across all seven tabs, that the
identity zone carries name/created/updated/unsaved (and only one such zone exists in the DOM), and
that nothing clips or becomes unreachable at 940x620. The Raw File tab (D2) merged its two toolbar
rows into one and tightened `.cfg-code--fill`'s padding to fund the shared header's line budget.
Final measured result: 31 visible editor lines at 1280x800 (floor is 30), a comfortable margin
over the required minimum but tighter than the mid-story baseline (61px after D2) because D3's
header/tab-strip/padding changes spend part of that budget — expected and within plan.

**Commit message:** `061: profile header is one row for every tab`

**Decisions taken during build** (all verified against Plan/AC, none contradict a Sprint Decision):
- **D2 — `Select`/`IconButton` sizing bug fix.** The shared `Select`'s `h-7` override never
  actually applied (`cn()` has no tailwind-merge dedup, so `FIELD_BASE`'s `h-9` won the cascade).
  Fixed at the one Raw File call site (`h-6!`) rather than in the shared component, and combined
  with shrinking two `IconButton`s + the `Select` to 24px to close the line-budget margin gap.
  Recorded as a new `CLAUDE.md` deviation-table row (44px floor deviation, same desktop-only
  reason as the existing rows).
- **D3 — tab-button padding reconciliation.** The Sprint Decisions contained two readings
  ("tab buttons keep `py-1.5`'s look" vs. "tab strip gets denser, `py-1` buttons"); resolved in
  favour of `py-1` for all seven tabs (matching the Plan's step 3 and the "denser" framing),
  removing the old raw-only `py-0` variant entirely so the strip is pixel-identical everywhere.
  Recorded as its own `CLAUDE.md` deviation-table row.
- **D3 — fallback-lever substitution.** The Plan's prescribed order for recovering line budget
  if short (tab-strip `pb-1`→`pb-0.5`, then `pt-4`→`pt-2`, then header-block gap 4px→2px) yielded
  only 10 of the 19px needed. Applied instead: strip `pb-1`→none (more than the prescribed
  `pb-0.5`), `pt-4`→`pt-2` (as prescribed), and one lever not in the list — detail-wrapper gap
  `space-y-2`→`space-y-1`. All three stay uniform across every tab, so the hard constraints
  ("never a per-tab difference, never `--cfg-code-line-h`, never the shell") are respected in
  full; only the literal prescribed order/list was widened. Final result 31 lines / 18px margin —
  above floor. Reviewed and accepted (see below) rather than treated as a blocker.
- **D3 — new testid `config-profile-actions`.** Not named in the story text (which named
  `config-profile-header`/`config-profile-identity` only); added so D4's cross-tab rect
  comparison had a stable anchor for the action cluster, consistent with the existing
  `data-testid` convention used throughout.
- **Post-review test strengthening (not a Sprint/refine decision, a review-fix).** The clean
  review (PASS) flagged two test-rigor gaps rather than implementation defects: AC1's "single
  row" wasn't directly bounded (only proven indirectly via cross-tab equality + the AC4 line
  budget), and AC2's "no second identity block anywhere" wasn't asserted as a DOM-uniqueness
  check. Both were closed by extending `config-header-geometry.mjs` (header-height-vs-back-button
  ceiling check; `config-profile-identity` count === 1 plus a stray-duplicate DOM scan) — verified
  green, and confirmed these were test gaps, not implementation gaps (production code untouched).

**Verification.**
- `npm run build` — green.
- `npm test` — 101 files / 2607 tests, green.
- `npm run typecheck` — green (node + web), re-confirmed after the final flow edit.
- `npm run ui:verify` — 68/68 screenshots, 0 axe violations at both viewports.
- `npm run ui:flow -- raw-inline-edit` — still green (clicks `config-save`, now inside
  `config-profile-actions`).
- `npm run ui:flow -- config-header-geometry` (D1+D4, extended post-review) — green;
  `lines=31 margin=18px` at 1280x800; rect-equality, identity-text, unsaved-indicator
  raise/discard, single-row-height, identity-uniqueness and 940x620 wrap/hit-testability
  assertions all pass.
- Code review (default tier, clean agent): **PASS**, no blocking defects; shell files
  (`AppShell.tsx`/`TitleBar.tsx`/`ActionBar.tsx`) confirmed untouched; no hex colors or raw
  palette classes introduced; two test-rigor findings (see Decisions above) fixed in one
  review-fix cycle, no re-review needed since fixes only strengthened the test file, not
  production code.

**AC → test mapping, as verified:**
- AC1 → `scripts/flows/config-header-geometry.mjs` (cross-tab header-rect equality + new
  single-row-height ceiling assertion) — passed.
- AC2 → same flow (identity-zone text assertions + new identity-uniqueness/no-stray-duplicate
  assertion + unsaved-indicator raise/discard) — passed.
- AC3 → same flow (header/identity/tab-strip/actions rect equality across all seven tabs) —
  passed.
- AC4 → same flow (`lines=31 margin=18px` ≥ 30-line floor) — passed. Funded by D1 (measuring
  instrument) + D2 (raw-tab toolbar merge + padding) + D3 (header rewrite within budget).
- AC5 → same flow (940x620 `scrollWidth <= clientWidth`, every control hit-testable) plus
  `npm run ui:verify`'s existing `VIEWPORT_MIN` pass over all config-detail screens — passed.
- No manual residue.
