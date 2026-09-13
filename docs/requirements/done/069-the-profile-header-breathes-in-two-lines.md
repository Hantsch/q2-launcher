---
id: 069
title: the profile header breathes in two lines
status: done
created: 2026-09-07
---

## Requirement

Story 061 folded the config profile header into one row to buy editor height, and it now reads as
one dense strip of unrelated facts glued to the tab strip below it. What I actually look at first is
**which profile** I am editing and **whether it is saved**; created/updated are context I only read
when I go looking for them.

So the centred identity zone should be two lines: the profile name plus the saved/unsaved state on
the first line (the focus), and `CREATED <when>` / `UPDATED <when>` on the second, a little smaller
and quieter. That also puts real air between the header and the tab strip, so the whole block stops
looking pasted together.

The height this costs must not break the editor-line floor story 061 established.

## Acceptance Criteria

- [x] **AC1** — The config profile header's identity zone renders two lines: line 1 = profile name +
      unsaved/saved indicator, line 2 = created and updated.
- [x] **AC2** — Line 2 is visually subordinate to line 1 (smaller type, dimmer), and line 1's name
      stays the most prominent text in the header.
- [x] **AC3** — Back button (left) and action cluster (right) stay on the header's outer edges and
      keep their vertical centring against the now-taller identity zone; the header is still one
      header on all seven tabs, with no second identity block below it.
- [x] **AC4** — The Raw file tab still shows at least 30 visible editor lines at the shell's minimum
      viewport (`scripts/flows/config-header-geometry.mjs` stays green).
- [x] **AC5** — At the app's minimum width (940px) nothing clips or overflows; the identity zone
      wraps rather than pushing the action cluster off the row.

## Open Questions

### OQ1 — AC4 is unsatisfiable as written: the guard is already red, and not because of this story

**Measured, not assumed** (refine, `npm run ui:flow -- config-header-geometry` on `sprint/S15` after
a clean `npm run build`, 1280x800):

```
lines=27 margin=-42px   (clientHeight=480px padding=12px lineHeight=17px)
flow failed at step 'measure the visible line count from real geometry'
```

So `scripts/flows/config-header-geometry.mjs` — the guard AC4 says must "stay green" — is **red
today, before story 069 changes a single line**, and it is short by 42px (2.5 editor lines), not
"about two lines of headroom" as the S15 sprint note assumes. The sprint note's premise ("the
current baseline is 32 lines") is story 061's *pre*-change baseline; 061's own Done section records
its *final* result as `lines=31 margin=18px`.

**Why it is red** (throwaway probe, two measurements in one run on the freshly seeded fixture):

| Raw file tab state | editor `clientHeight` | visible lines | margin |
| --- | --- | --- | --- |
| Plain Profile **as seeded** (`mode === 'lockedByChanges'`) | 480px | **27** | **-42px** |
| Same profile after discarding its unsaved change (`mode === 'editable'`) | 540px | **31** | **+18px** |

The 60px difference is entirely the `lockedByChanges` shape of the raw tab, none of it the header:
`config-raw-locked-hint` (`RawFileTab.tsx:304-308`, 16px) plus the read-only `searchable` branch's
**always-visible** find bar (`ConfigCodeView.tsx:576`, `.cfg-code-search`, 36px — the editable
branch renders the same bar only behind `isFindOpen`, `ConfigCodeView.tsx:478`) plus an 8px gap.
The `540px / 31 lines` figure is exactly what story 061 recorded, which proves 061's 30-line floor
was established on the **editable** shape, while the committed guard measures the **locked** one.

Most likely cause of the flip (not certain, but it is the only post-061 commit touching the diff
engine): story 064 `8c4ed94` reworked `src/shared/config/profile-diff.ts` (+156 lines) so changes
"read as a real diff"; the seeded Plain Profile's change set now counts as 1 unsaved change, which
routes the raw tab into `lockedByChanges`. `scripts/lib/fixture.mjs` itself did not change the
profile (its only post-061 edit is story 065's third installation), and `ConfigView.tsx`,
`RawFileTab.tsx`, `ConfigCodeView.tsx` and `config-syntax.css` are byte-identical to 061.

**Why this blocks rather than being decided in refine.** Story 069's second identity line costs
about 10-14px (see Decision D-2). In the *editable* shape that fits: 18px headroom - ~14px = 30
lines, still green. In the *locked* shape nothing fits, because the deficit is 42px before the story
starts. Funding ~56px "inside the header", as the sprint note requires, is arithmetically impossible
— the whole chrome above the panel is only ~71px (header 28px + tab strip 27px + `pt-2` 8px + ~8px
of gaps) and story 061 already spent every lever in it (`pt-4`→`pt-2`, strip `pb-1`→none,
`space-y-2`→`space-y-1`). So the only routes forward all leave 069's stated scope or its AC4, and
they differ in scope, risk and user-visible behaviour:

- **Option A — 069 stays header-only; the guard is pinned to the shape 061 measured.** AC4 keeps its
  30-line floor but asserts it in the `editable` shape, and the flow additionally *records* the
  `lockedByChanges` number and asserts it does not regress below today's 27 lines. The 60px is filed
  as its own defect story. Cheapest, keeps 069 small — but it narrows what the guard covers, which
  is close to the "do not weaken the guard" line.
- **Option B — 069 absorbs the repair.** Make the read-only view's find bar on-demand (`isFindOpen`,
  exactly like the editable branch, -36px) and fold the locked hint into the raw tab's existing
  merged toolbar row (-16px, and its text is near-redundant next to the "1 unsaved change is not in
  this file yet." badge already in that row). Recovers ~52px, so the floor holds in **both** shapes
  and AC4 stays literally true. Costs ~2 extra files (`ConfigCodeView.tsx`, `RawFileTab.tsx`) and
  changes user-visible behaviour outside this story: the find bar in the read-only raw view stops
  being permanently visible.
- **Option C — repair first, in its own story, then 069.** File the 60px as a defect story, build it
  before 069 in S15 (the sprint's build order has 069 third, so there is room), and 069 then refines
  and builds against a green guard with AC4 untouched. Cleanest separation of a defect from a
  feature; costs one extra story in the sprint.

**Question:** which of A, B or C? (Recommendation: **C**, with **B** as the fallback if you would
rather not add a story to S15 — both keep the 30-line floor literally intact in every state, which
A does not.)

~~OQ1~~ answered → Decisions (Sprint)

**Correction (second refine pass), because the diagnosis above was wrong about *why* it was red:**
the guard is **green on a freshly seeded fixture** — re-measured today, `npm run ui:seed` followed by
`npm run ui:flow -- config-header-geometry`, output `lines=31 margin=18px` … `flow OK`. See
**D-10**: the red run was measuring a fixture an earlier session had left `dirty`, not a regression
from story 064. Option B stands as decided and is still worth building — it is what makes AC4 true
in the `lockedByChanges` shape too, instead of true only as long as nobody dirties the profile
first — but 069's real budget is the measured **+18px**, and the repair is hardening, not a rescue.

## Decisions (Sprint)

- **(User)** OQ1 — which route for the pre-existing AC4 regression: **Option B** — 069 absorbs the
  repair (read-only find bar goes on-demand, the locked hint folds into the raw tab's merged toolbar
  row), recovering ~52px so the 30-line floor holds in both raw-tab shapes and AC4 stays literally
  true, without adding a separate story to S15.

Taken in refine without user input; each with its reason. All of them are independent of OQ1 —
whichever of A/B/C is chosen, these hold.

- **D-1 The floor is re-measured, never assumed.** The numbers above come from a real run of the
  committed guard plus a throwaway probe flow (deleted again) that read `clientHeight`,
  `padding-block` and `--cfg-code-line-h` off the live `.cfg-code`, in both raw-tab states. Reason:
  the story text and the sprint note both explicitly forbid assuming story 061's budget — and the
  assumption in the sprint note turned out to be wrong by 4 lines.
- **D-2 The second line costs ~10-14px, not ~20px.** The header row is 28px today while the identity
  zone inside it is only 20px (probe: `config-profile-header` y=76 h=28, `config-profile-identity`
  y=80 h=20) — the 28px comes from the 28px action buttons. A second line of `text-xs`/16px content
  makes the identity zone ~36-38px, so the header grows by ~8-10px, plus ~4px if the header-to-strip
  gap opens up. Reason: the story's cost has to be quantified before anyone can judge whether it
  fits, and the naive "one line = one line-height" estimate overstates it.
- **D-3 Line 2 is `KeyValue`'s existing `text-xs text-ink-dim`, line 1 keeps the `h2`.** Line 2
  reuses the two `KeyValue`s already in the zone (`primitives.tsx:87-101`, label = `stencil`, value
  = `text-xs text-ink-dim`) and line 1 keeps today's `font-display text-sm tracking-[0.06em]
  text-ink uppercase` `h2` plus `UnsavedIndicator`. Reason: AC2's "smaller and dimmer" is already
  satisfied by the existing token pair, so no new primitive, no new i18n key and no new token —
  `/frontend-guidelines`' reuse rule and CLAUDE.md's "no prose across the i18n boundary".
- **D-4 The zone stays one `config-profile-identity` element, now with two child rows.** The two
  lines are two children inside the existing testid, not two sibling zones. Reason: the guard
  asserts `config-profile-identity` exists exactly once and scans for stray duplicates
  (`config-header-geometry.mjs:264,269-288`), and AC3 forbids a second identity block.
- **D-5 "Air between header and tab strip" is the header-block gap, applied uniformly.** Any added
  breathing room is one gap value on the shared wrapper, never a raw-tab-only or per-tab value.
  Reason: story 061 AC3 (still in force) requires the header and strip to be pixel-identical on all
  seven tabs, and a per-tab gap is exactly the relayout it outlaws.
- **D-6 AC5's "minimum width" is 940x620.** `WINDOW_MIN_WIDTH/HEIGHT` (`src/shared/constants.ts`),
  already `VIEWPORT_MIN` in `scripts/lib/screens.mjs:101` and `SMALL_VIEWPORT` in the guard. Reason:
  the window cannot be made narrower, and the guard's existing wrap/hit-test assertions run at
  exactly this size, so AC5 needs no new viewport.
- **D-7 All five criteria are proven by the existing e2e guard, extended — no jsdom test.** Reason:
  `ui-acceptance-required: true` demands the real surface, and jsdom has no layout engine, so it can
  measure neither line counts, nor "line 2 sits below line 1", nor wrapping at 940px.
- **D-8 No new CLAUDE.md deviation row is needed for the header itself.** The two-line identity zone
  adds text lines, not controls; the 28px action buttons and the 26px tab strip keep the sizes their
  existing deviation rows already cover. Reason: CLAUDE.md's deviation table records deviations, and
  this story introduces no new sub-44px hit area — but note that Option B would touch the read-only
  find bar's `IconButton`s, which are already `size="sm"`, so still no new row.
- **D-9 Out of scope, deliberately:** `AppShell`/`TitleBar`/`ActionBar` (CLAUDE.md: never edit the
  shell), `--cfg-code-line-h`, and lowering `MIN_VISIBLE_LINES` below 30 in any circumstance.
  Reason: the shell is off-limits by guardrail, and the floor is the acceptance criterion itself —
  moving it would make the story pass by redefining success.

Added in the second refine pass, after OQ1 was answered:

- **D-10 The guard is green; OQ1's red run measured a polluted fixture, not story 064.** The raw
  tab's mode reads the *persisted* `profile.dirty` flag (`rawEditingMode`, `lib/raw-draft.tsx:57-65`
  via `isProfileDirty`, `lib/save-bar.ts:17-19`), and the seeded fixture writes `dirty: false` with a
  `baseline` present for all three profiles (verified in
  `.ui-verify/fixture/populated/userdata/state.json`; `scripts/lib/fixture.mjs` never sets `dirty`).
  `scripts/flow.mjs` launches on that **persistent** userData without reseeding, and `ui:verify`'s
  own screens (`config-save-expanded`/`config-discard-confirm`/`config-conflict-dialog`,
  `scripts/lib/screens.mjs`) dirty Plain Profile and never save it — exactly the trap
  `scripts/flows/raw-inline-edit.mjs:34-40` already documents ("run `npm run ui:seed` first"). Fresh
  seed + guard = `lines=31 margin=18px`, flow OK. Reason: the story's own D-1 rule (re-measure, never
  assume) applies to the previous refine's measurement too, and the difference decides the budget.
- **D-11 The budget arithmetic, checked rather than trusted.** Headroom is **+18px** (528px usable,
  17px lines, 30-line floor). The second identity line costs **+8px**: the zone is 20px today and
  becomes 36px (`h2 text-sm` = 20px line box + `KeyValue` `text-xs` = 16px, no gap between them), and
  the header — 28px, set by its 28px buttons — follows the zone to 36px. That leaves **+10px /
  30 lines**, green. In the `lockedByChanges` shape the two Option-B cuts recover **60px** (36px
  `.cfg-code-search` + 8px `.cfg-code-panel` gap, `config-syntax.css:293-303` + 16px hint), i.e.
  27 → 31 lines, which is exactly the editable shape's number: after the repair both shapes are the
  same box. Reason: OQ1's "~52px" left the panel gap out, and the story is only buildable if the
  10px that remain after 069's own cost are real.
- **D-12 No extra wrapper gap is spent up front.** `space-y-1` on the detail wrapper stays; the "air"
  AC-less sentence in the Requirement is delivered by the taller identity zone itself. D3 may raise
  it to `space-y-2` **only** if the guard still reports ≥30 lines afterwards, and must revert it
  otherwise. Reason: AC4 is a hard floor and D-11 leaves 10px — a 4px gap is a nice-to-have that may
  not be paid for out of the criterion.
- **D-13 The read-only find bar reuses the existing `isFindOpen` state, for every `searchable`
  caller.** No new prop and no `fill`-only special case: Ctrl+F opens and focuses it, Escape closes
  it and clears the query, and `matches` is gated on it so highlights disappear with the bar —
  mirrored 1:1 from the editable branch (`ConfigCodeView.tsx:347-361`, `:478-508`). This also changes
  `ConfigConflictDialog.tsx:168,172`, which is accepted: one find behaviour for both code views is
  the point. Reason: `/frontend-guidelines`' reuse rule, and a `fill`-conditional find bar would be a
  second behaviour to keep in sync for no user benefit.
- **D-14 The locked hint becomes a `Badge` inside the merged toolbar row, not a row of its own.**
  While `mode === 'lockedByChanges'` the row carries one `tone="warning"` badge holding
  `config.raw.unsavedNotice` when `changeSet.count > 0` and `config.raw.editLockedByChanges`
  otherwise, with the lock reason in a `HoverCard` — the tooltip idiom this row already uses twice
  (`RawFileTab.tsx:235-279`) — and it keeps the `config-raw-locked-hint` testid. Reason: zero added
  height, no new i18n key, and the fallback label keeps the hint from vanishing in the state where a
  profile is `dirty` but its change set renders as empty.
- **D-15 The flow reaches `lockedByChanges` deliberately, and restores the fixture.** The locked
  shape is entered by toggling the raw tab's own `writeUnbindall` checkbox (`markUnsaved`,
  `src/main/modules/config/index.ts:616`) and left again via `config-discard` +
  `DiscardChangesDialog`, which restores `writeUnbindall` from the baseline the fixture already
  seeds. The flow's header comment gains the `npm run ui:seed` precondition note
  `raw-inline-edit.mjs` carries. Reason: measuring one shape *by fixture accident* is what produced
  OQ1 in the first place — after this story both shapes are measured on purpose, in one run.

## Plan

Option B, in the order the line budget demands: pay for the second line **first**, then spend it.
Every step is measured with `npm run ui:seed && npm run ui:flow -- config-header-geometry` — never
without the reseed (D-10).

1. **Fund the locked shape (D1).** `ConfigCodeView.tsx`'s read-only `searchable` branch stops
   rendering `.cfg-code-search` unconditionally and reuses the editable branch's `isFindOpen`
   (Ctrl+F opens/focuses, Escape closes+clears, matches gated on open). -44px in the locked shape
   (bar + the panel's 8px gap), no change to the editable one. Same step teaches the guard to
   measure the locked shape on purpose (toggle `writeUnbindall` → measure → discard, D-15).
2. **Fold the locked hint (D2).** `RawFileTab.tsx`'s standalone `config-raw-locked-hint` paragraph
   becomes a warning badge inside the merged toolbar row (D-14). -16px; locked shape now equals the
   editable one at 31 lines / +18px margin.
3. **Two lines (D3).** `ConfigView.tsx`'s `config-profile-identity` becomes `flex-col`: row 1 =
   `h2` + `UnsavedIndicator`, row 2 = the two existing `KeyValue`s (D-3, D-4). One zone, one testid,
   two children. +8px → 30 lines / +10px margin in both shapes. Extend the guard with AC1/AC2/AC3
   assertions (two rows, row 2 smaller + dimmer, back/actions still edge-anchored and centred) and
   the AC5 wrap check at 940x620.

Affected files, in that order: `src/renderer/src/modules/config/components/ConfigCodeView.tsx`,
`src/renderer/src/modules/config/RawFileTab.tsx`,
`src/renderer/src/modules/config/ConfigView.tsx`, `scripts/flows/config-header-geometry.mjs`.
No i18n key, no new primitive, no new token, no shell file, no `MIN_VISIBLE_LINES` change (D-9).

Regression surface to re-run after D1/D2 (both touch the raw tab): `npm run ui:seed` then
`npm run ui:flow -- raw-inline-edit` and `npm run ui:flow -- unsaved-diff`, plus
`npm run ui:verify` (the read-only code view appears in screenshots and in the a11y pass — the
`.cfg-code` container keeps its `tabIndex`, which is what axe's scrollable-region rule needs).

## Deliverables

### D1 — the read-only find bar opens on demand, and the guard measures the locked shape

- `src/renderer/src/modules/config/components/ConfigCodeView.tsx` — mirror the editable branch
  (`:347-361` handler, `:478-508` render) into the read-only `searchable` branch (`:563-614`):
  render `.cfg-code-search` only while `isFindOpen`, open+focus it on Ctrl+F, close it on Escape
  (clearing `query`), and add `isFindOpen` to the `matches` memo (`:378-381`) so highlights and the
  `X of Y` count come and go with the bar. The panel wrapper, its `tabIndex={-1}`, the `.cfg-code`
  `tabIndex={0}` and the keydown scoping stay exactly as they are. `isFindOpen` is one shared piece
  of state for both branches — no new prop (D-13).
- `scripts/flows/config-header-geometry.mjs` — after the existing measurement, add a
  `lockedByChanges` block: toggle the raw tab's `writeUnbindall` checkbox, wait for the read-only
  view, measure `lines`/`margin` with the *same* helper the first measurement uses (extract it, do
  not copy the formula), assert `>= MIN_VISIBLE_LINES`, assert `.cfg-code-search` is absent, press
  Ctrl+F and assert it appears, press Escape and assert it is gone again, then restore via
  `config-discard` + the discard dialog's confirm and assert `config-tab-unsaved` disappears
  (D-15). Add the `npm run ui:seed` precondition note to the file's header comment.
- Acceptance: guard green, and its log prints a line count for **both** shapes.

### D2 — the locked hint lives in the merged toolbar row

- `src/renderer/src/modules/config/RawFileTab.tsx` — delete the standalone
  `<p data-testid="config-raw-locked-hint">` (`:304-308`) and render, inside the merged row
  (`:183-280`), one `tone="warning"` `Badge` while `mode === 'lockedByChanges'`: label =
  `config.raw.unsavedNotice` when `changeSet.count > 0`, else `config.raw.editLockedByChanges`,
  wrapped in the row's existing `HoverCard` idiom carrying `config.raw.editLockedByChanges`, and
  keeping the `config-raw-locked-hint` testid (D-14). The existing count badge is not duplicated.
- `scripts/flows/config-header-geometry.mjs` — in D1's locked block, assert
  `config-raw-locked-hint` is a descendant of the merged toolbar row (DOM containment, not a
  y-coordinate guess) and that the row still occupies one line at 1280x800.
- Acceptance: locked shape reports 31 lines / +18px, same as the editable shape.

### D3 — the identity zone renders two lines

- `src/renderer/src/modules/config/ConfigView.tsx` (`:719-733`) — `config-profile-identity` becomes
  a `flex-col items-center justify-center` zone with two children: row 1
  (`flex min-w-0 items-center gap-2`) = the existing `h2` (`min-w-0 truncate`) + `UnsavedIndicator`,
  row 2 (`flex flex-wrap items-center justify-center gap-x-3`) = the two existing `KeyValue`s. No
  new classes on the `h2`, no change to `KeyValue`, no second testid (D-3, D-4). Header keeps
  `items-center` so back/actions stay centred against the taller zone. Wrapper gap per D-12.
- `scripts/flows/config-header-geometry.mjs` — extend with: the zone has exactly two element
  children and row 2's top edge is at or below row 1's bottom edge (AC1); every text element in
  row 2 has a smaller computed `font-size` than the `h2`, and a colour whose relative luminance is
  closer to the panel background than the `h2`'s (AC2 — dimmer, computed from tokens, no hex
  literals in the flow), and the `h2`'s font-size is `>=` every other text element's in the header;
  the back button's and the action cluster's centre-y match the header's centre-y within 1px and
  they remain the leftmost/rightmost header children (AC3); at 940x620 the identity zone wraps
  inside the header (existing no-overflow check) while `config-profile-actions` stays on screen and
  hit-testable (AC5). Update the file's `single row` comment block (`:204-230`) — the ceiling still
  holds at 36px vs 56px, but the reason it is a *two-line identity zone in a one-row header* has to
  be written down, or the next reader reads the assertion as forbidding what this story just built.
- Acceptance: `lines >= 30` in both shapes, all AC1-AC5 assertions green, screenshots show the two
  lines.

## Model Hints

- D1 → default
- D2 → default
- D3 → `deliverable-hard` — this is the D that spends the whole measured 10px of remaining line
  budget on a header shared by all seven tabs, so a plausible-looking diff (an extra `gap-y`, a
  `leading-*`, `items-start` instead of `items-center`) silently costs one editor line or breaks
  story 061's still-binding "identical chrome on every tab", and it is also where the AC2/AC3
  geometry assertions have to be written without magic numbers.
- Review: → `story-review-hard` — the diff changes a *shared* code view's find behaviour for a
  second caller (`ConfigConflictDialog`) and hardens the very guard that proves its own acceptance,
  which is the combination where a reviewer has to check that the guard was not quietly made easier
  instead of the layout made smaller.

## Acceptance Tests

`e2e` per profile is `npm run ui:verify`; the criteria below are proven by this story's own flow,
run as `npm run ui:seed && npm run ui:flow -- config-header-geometry` (the reseed is part of the
command — see D-10). No jsdom/component test is planned (D-7): jsdom has no layout engine, so it
can measure neither line counts, nor "row 2 sits below row 1", nor wrapping at 940px. `npm test`,
`npm run typecheck` and `npm run build` must stay green but gain no new cases — nothing in this
story is pure logic.

- AC1 → e2e flow `scripts/flows/config-header-geometry.mjs` › step "assert the identity zone
  renders two lines" (D3) — two element children, row 1 carries the name + `config-unsaved-indicator`,
  row 2 carries Created/Updated, row 2's top edge at or below row 1's bottom edge.
- AC2 → e2e flow `scripts/flows/config-header-geometry.mjs` › step "assert line 2 is subordinate to
  line 1" (D3) — computed font-size of every row-2 text element `<` the `h2`'s, its colour's
  relative luminance closer to the panel background than the `h2`'s, and the `h2` the largest text
  in the header.
- AC3 → e2e flow `scripts/flows/config-header-geometry.mjs` › step "assert back and actions stay on
  the edges, vertically centred" (D3) — centre-y match within 1px, leftmost/rightmost header
  children, plus the existing `assertZoneStable` per-tab rect comparison over all seven tabs and the
  existing exactly-one-identity-zone / no-stray-duplicate checks.
- AC4 → e2e flow `scripts/flows/config-header-geometry.mjs` › steps "measure the visible line count
  from real geometry" (existing, `editable`) and "measure the visible line count in the
  lockedByChanges shape" (D1, asserted; D2 lifts it to 31 lines; D3 re-measured at ≥30 in both).
- AC5 → e2e flow `scripts/flows/config-header-geometry.mjs` › step "resize to 940x620 and assert the
  header does not clip or overflow" (existing, extended in D3) — no header overflow, the identity
  zone wraps inside the header, `config-profile-actions` and every header control still
  hit-testable.
- Regression (not an AC, run in D1/D2): `npm run ui:flow -- raw-inline-edit`,
  `npm run ui:flow -- unsaved-diff`, `npm run ui:verify` — the first two cover the raw tab's editing
  and unsaved paths this story touches, the third the screenshot/a11y pass over the read-only code
  view whose find bar is now hidden by default.
- No `manual residue`.

**Added during the review-fix cycles (not new ACs — regression tests for bugs the review found in
D1's on-demand find bar, see Done section):** `config-header-geometry.mjs`'s `lockedByChanges` block
gained steps asserting the find input is actually focused (`document.activeElement` identity) after
Ctrl+F, that typing produces live `.cfg-match` highlights, that Escape restores focus to the panel,
and that a second Ctrl+F — both after Escape and while the bar was already open with focus moved
elsewhere — still (re)focuses the input. `scripts/flows/raw-inline-edit.mjs` gained the first e2e
coverage of the editable branch's find bar: Ctrl+F opens+focuses it, a second Ctrl+F after focus
moved to the textarea refocuses the find input rather than leaking keystrokes into the config text,
asserted via the textarea's unchanged `inputValue`.

## Done

**Summary.** Option B was built exactly as planned across D1-D3: the read-only code view's find
bar now opens on demand (Ctrl+F) instead of always rendering, the raw tab's locked hint moved into
the merged toolbar row as a warning badge, and the profile header's identity zone became two rows
(name + unsaved indicator, then Created/Updated) inside the same single `config-profile-identity`
zone. `scripts/flows/config-header-geometry.mjs` now measures both the `editable` and
`lockedByChanges` raw-tab shapes on every run and asserts AC1-AC5 with computed (not hardcoded)
geometry. Both shapes land at `lines=30 margin=10px` — the 30-line floor holds, at its planned
budget, in both states. Three review-fix cycles were needed: the clean-agent review's first pass
(story-review-hard tier, per Model Hints) found D1's find bar didn't actually focus reliably and
lost keyboard reachability after Escape; the first fix introduced a second regression (Ctrl+F was a
no-op — and in the editable branch, destructive — whenever the bar was already open); the second
fix closed that gap and a third review pass returned PASS.

**Commit message:**
```
069: profile header breathes in two lines
```

**Decisions (made during build, not pre-existing in the story):**
- The two review-fix cycles both stayed inside D1's `ConfigCodeView.tsx` scope (the shared find-bar
  find/focus mechanics) — `RawFileTab.tsx` (D2) and `ConfigView.tsx` (D3) were never touched by
  either fix, confirmed clean by all three review passes.
- The already-open Ctrl+F fix calls the input's `focus()+select()` directly and synchronously
  inside the keydown handler (in addition to `setIsFindOpen(true)`), rather than only relying on
  the `useEffect` keyed on `isFindOpen` — React does not re-run an effect when a `setState` call
  doesn't change the value, so the effect alone can never cover the "already open" transition.
- Left unfixed, as accepted non-blocking notes from the third review pass (documented there, not
  re-litigated): (1) the read-only find bar is now undiscoverable on arrival (no affordance) until
  the user clicks into the code once — this is D-13's and OQ1 Option B's explicit, user-approved
  intent (mirrors the editable branch's pre-existing behaviour since story 057), not a defect of
  this story, but worth a follow-up story if it proves annoying in practice; (2) Escape restores
  focus to `.cfg-code-panel` (`tabIndex={-1}`) rather than `.cfg-code` (`tabIndex={0}`, the actual
  scroll container), so keyboard-scrolling the code is briefly unreachable until the user Tabs or
  clicks again — minor, not part of any AC; (3) the `isFindOpen` gate on the `matches` memo has no
  test that would fail if it were removed in isolation (Escape's `setQuery('')` already clears
  highlights) — a coverage gap, not a behaviour bug; (4) the pre-existing asymmetry where the
  read-only branch clears its query on Escape and the editable branch does not was left as found —
  out of scope for both fix cycles, and D-13's "mirrored 1:1" targets the on-demand *visibility*
  behaviour, not this pre-existing quirk.
- The locked hint's lock-reason `HoverCard` (D2/D-14) is mouse-hover-only for keyboard/AT users in
  the `changeSet.count > 0` case (the badge itself has no focusable child) — accepted as spec-exact
  per D-14, flagged by review as real but non-blocking information loss, not fixed in this story.

**Verification:**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `npm test` — 2712 tests, 1 pre-existing unrelated flaky timeout in
  `src/main/modules/config/core/import-reader.test.ts` (512-file exec-expansion guard); confirmed
  untouched by this diff (`git diff HEAD --stat` shows zero changes to that file) and passes cleanly
  on a longer timeout — not a regression from this story.
- `npm run ui:seed && npm run ui:flow -- config-header-geometry` — flow OK. Final numbers:
  `editable lines=30 margin=10px`, `lockedByChanges lines=30 margin=10px`. All AC1-AC5 assertions
  green (see mapping below).
- `npm run ui:flow -- raw-inline-edit`, `npm run ui:flow -- unsaved-diff` — OK.
- `npm run ui:verify` — 68/68 screenshots written, 0 axe violations.
- Code review: story-review-hard tier, 3 passes. Pass 1: FAIL (D1 find-bar focus/reachability
  bugs). Pass 2 (after fix): FAIL (fix introduced a new "Ctrl+F is a no-op when already open"
  regression, destructive in the editable branch). Pass 3 (after second fix): **PASS**, with four
  non-blocking findings recorded above.
- AC → test mapping, as verified: AC1/AC2/AC3/AC5 → `scripts/flows/config-header-geometry.mjs`'s D3
  steps (two-line zone, subordinate line 2, edge-anchored/centred back+actions, 940x620 wrap) — all
  green. AC4 → the same flow's editable- and lockedByChanges-shape measurements, both
  `lines=30 margin=10px` — green in both states, hardening intact.
- No `manual residue`.
- No open blockers.
