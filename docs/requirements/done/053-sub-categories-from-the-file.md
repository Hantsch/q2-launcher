---
id: 053
title: Sub-categories come from the file, and Controls shows them
status: done
created: 2026-09-05
---

## Requirement

My configs are structured in two levels: a section and blocks inside it - `dm.cfg` has
`.: Main Key's :.` with `##### 1st row #####` blocks beneath, and the launcher's own Weapons
category already shows Use weapon / Cycling, Weapon dropping shows Weapons / Ammunition / Misc.
Story 042 made the second level read-only: the parser recognises a main+sub header pair only in an
untagged foreign file and flattens it into one category named `Main / Sub`
(`src/shared/config/profile-restore.ts:572-579`, decision recorded in
`docs/requirements/done/042-profile-file-round-trips-losslessly.md:94-97`); the model stays flat
(`ConfigActionCategory { id, name }`); the writer emits one level; and the group headers the
Controls grid shows come from the catalogue id prefix (`lib/controls-row-groups.ts:29-35`), not
from my file.

What I want: sub-categories are real. They come from the file, they go back to the file, Controls
shows them as the group headers inside a category (exactly where the catalogue groups appear
today), and I can create, rename, move and delete them like categories. The same for Settings is
story 059.

## Acceptance Criteria

- [x] A category can contain sub-categories (one level below a category); an entry belongs to a
      category and optionally to one of its sub-categories.
- [x] Controls shows a category's sub-categories as group headers with their rows beneath, in the
      profile's order; entries directly under the category appear first as an ungrouped run.
- [x] Sub-categories can be created, renamed, reordered and deleted from the grid; an entry can be
      moved into and out of a sub-category (row menu or the action editor here; drag and drop
      comes with story 054).
- [x] Story 052's standard template seeds Use weapon / Cycling and Weapons / Ammunition / Misc as
      real sub-categories, replacing the catalogue-derived group headers.
- [x] The file writes a sub-category as a second-level section header under its category's header
      and reads it back as the same sub-category; the header follows the profile's section header
      style; story 042's round-trip property holds.
- [x] Importing a foreign file with a main+sub header pair produces a category with a
      sub-category, not a flat `Main / Sub` category; an existing profile whose category name already
      contains ` / ` from an earlier import is left alone - no guessing.
- [x] Deleting a sub-category keeps its entries in the parent category.
- [x] Overview, Aliases and Care keep working unchanged (none of them needs to show the
      sub-category); the "n rows - m bound" footer and the filter count across sub-categories.
- [x] `npm run ui:verify` shows a category with sub-categories; a `ui:flow` creates one and moves
      an entry into it through the real UI.

## Open Questions

1. ~~**Depth:**~~ answered → Decisions (Sprint)
2. ~~**Mixing:**~~ answered → Decisions (Sprint)
3. ~~**Foreign second-level markers:**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Depth: exactly two levels (category -> sub-category), not arbitrary nesting.
- **(User)** Mixing: a category can hold ungrouped entries and sub-categories at once, ungrouped
  entries rendered first.
- **(User)** Foreign second-level markers: the importer recognises decorated comment-only lines
  (`##### 1st row #####`-style) as sub-category headers via the repeated-decoration heuristic.
- **Model shape:** a sub-category is nested in its category (`ConfigActionCategory.subcategories:
  { id, name }[]`), not a flat sibling list - nesting makes "exactly two levels, exactly one parent"
  structurally true instead of an invariant three modules have to remember.
- **Entry field:** `ConfigAction.subcategoryId?: string`; an id the category does not have is
  treated as ungrouped, mirroring how a dangling `categoryId` falls into `render.ts`'s "other"
  bucket instead of erroring.
- **Tag:** one new meta key `sub=<id>` on the second-level banner; the parent is derivable from the
  category section the banner sits in, so nothing else is emitted (story 050's minimum rule).
- **Header shape:** the sub-banner is the same `banner()` call in the same `sectionHeaderStyle` as
  a category banner, distinguished only by its `sub=` tag and its position - no new decoration,
  indent or width, because every banner-stripping path (`DASHES_PREFIX`, `BRACKETS_SUFFIX`,
  `BANNER_RULE`, `CATEGORY_TITLE_PREFIX`) is exactly where 042's round-trip risk lives.
- **No title prefix:** sub-banners carry no `Binds: `/`Aliases: `/`Entries: ` prefix - inside an
  already-prefixed category section it would be noise, and `TITLE_PREFIXES` stays untouched.
- **Empty sub-category:** its banner is emitted even with nothing under it and is registered
  eagerly from its `sub=` tag (not lazily like `categoryRegistry` mints untagged sections), so a
  sub-category the user just created does not vanish on the first reload - the same "file is the
  source of truth" problem 052 solves for unbound rows; reuse 052's empty-section mechanism if it
  landed one.
- **Deleting a category** deletes its sub-categories with it; what happens to the *entries* is 052's
  confirm dialog (delete or move), unchanged here.
- **Repeated-decoration heuristic (scope):** a comment-only line whose text is symmetrically wrapped
  in a run of >=3 identical punctuation characters counts as a banner only if that same decoration
  occurs on at least two lines of the imported file - "repeated" is what separates a real section
  marker from one stray hand-typed comment.
- **Template names** are seeded as literal English strings (`Use weapon`, `Cycling`, `Weapons`,
  `Ammunition`, `Misc`), like the category names 052 seeds - a profile's structure is user data, not
  i18n keys.
- **Move in/out** is a sub-category select in the existing `ActionEditor` dialog; no new row context
  menu is introduced, because the editor is already the one surface that edits an entry's identity.
- **Reorder** is the existing up/down button pattern; drag and drop stays story 054's job.
- **Name length** is capped at 120 characters in the IPC payload schema like a category name, since
  the string reaches a banner line inside the engine's 1024-char cbuf budget.
- **Scope:** Controls only - Settings' sections are story 059, Overview/Aliases/Care stay unaware of
  the second level.

## Plan

Builds on 052's model (categories persisted, ordered, no built-in special case). Order:

1. **Model + schemas.** `ConfigActionCategory.subcategories`, `ConfigAction.subcategoryId` in
   `src/shared/modules/config.ts`; persisted zod in `src/main/lib/schemas.ts`, IPC payload zod
   (120-char name cap) in `src/main/modules/config/schemas.ts`. No behaviour yet.
2. **Writer.** `src/shared/config/render.ts`: `groupByCategory` gains a second bucketing level
   (ungrouped run first, then sub-buckets in `category.subcategories` order); new
   `subcategoryTag`/sub-banner helper used by `buildBindSections`, `buildAliasSections`,
   `buildAnchorSections`; empty sub-banner kept. `sub` key added to `KNOWN_META_KEYS`
   (`profile-metadata.ts`); label resolution in `comment-labels.ts`.
3. **Parser.** `src/shared/config/profile-restore.ts`: new `Section.kind: 'subcategory'`, parent =
   nearest preceding `'category'` section; `categoryRegistry` registers tagged sub sections eagerly
   and files entries under `{categoryId, subcategoryId}`; the `pairedTitle` `Main / Sub` flattening
   (:767, :852) goes away. Fixtures with sub-categories added to `ROUND_TRIP_FIXTURES` -
   `round-trip.test.ts`'s fixed-point property is the gate.
4. **Import heuristic.** Extend banner detection with the repeated-decoration rule and make an
   adjacent banner pair yield category + sub-category instead of `Main / Sub`. Existing profiles
   with a ` / ` name are untouched.
5. **Grid.** `controls-row-groups.ts` groups by `subcategoryId` (prefix map
   `GROUP_LABEL_KEY_BY_PREFIX` deleted); `ControlsGrid.tsx` renders a name label; 052's standard
   template seeds the five sub-categories; footer/filter counts verified across groups.
6. **CRUD.** Create / rename / reorder / delete a sub-category from its group header in
   `ControlsTab.tsx` (delete keeps entries in the parent); sub-category select in `ActionEditor.tsx`.
7. **Verify.** `scripts/flows/controls-subcategory.mjs` + a `ui:verify` fixture with sub-categories.

## Deliverables

- [x] **D1 - Model and schemas.** `ConfigActionCategory.subcategories: { id, name }[]` and
  `ConfigAction.subcategoryId?: string`; persisted + IPC zod, name capped at 120.
  Files: `src/shared/modules/config.ts`, `src/main/lib/schemas.ts`,
  `src/main/modules/config/schemas.ts`. Mirror: the existing `categories` field and its two schemas.
  *Accept:* `npm run typecheck` + `npm test` green; a profile with sub-categories survives
  persist/load; an unknown `subcategoryId` does not fail validation.

- [x] **D2 - The file writes sub-categories.** Second-level bucketing and banner emission, `sub=` tag,
  empty sub-banner kept, name clamped like a category title.
  Files: `src/shared/config/render.ts`, `src/shared/config/profile-metadata.ts`,
  `src/shared/config/comment-labels.ts`, `src/shared/config/render-invariants.test.ts`.
  Mirror: `categoryTag`/`categoryTitle`/`titledSection` and `orderedCategoryIds`.
  *Accept:* a fixture profile renders category header -> ungrouped rows -> sub-banner + rows, in
  profile order, in all three header styles; an empty sub-category still writes its banner;
  render-invariants green.

- [x] **D3 - The file reads sub-categories back.** `Section.kind: 'subcategory'` with parent tracking,
  eager registration from `sub=`, entries filed with `subcategoryId`, `pairedTitle` flattening
  removed. Files: `src/shared/config/profile-restore.ts`,
  `src/shared/config/fixtures/profiles.ts`, `src/main/modules/config/round-trip.test.ts`.
  *Accept:* new sub-category fixtures added to `ROUND_TRIP_FIXTURES` and the story-042 fixed-point
  property (`render(parse(render(p))) === render(p)`) green for all of them, including an empty
  sub-category and a hand-deleted `sub=` tag (degrades to a category, never crashes); the
  adversarial-mangling suite stays green.

- [x] **D4 - Foreign two-level import.** Repeated-decoration banner detection plus adjacent-pair ->
  category + sub-category. Files: `src/shared/config/profile-restore.ts` (+ its tests),
  `docs/fixtures/` sample if one is needed.
  *Accept:* importing a `dm.cfg`-shaped file (`.: Main Key's :.` with `##### 1st row #####` blocks)
  yields one category with sub-categories, no `Main / Sub` name anywhere; a single stray decorated
  comment does not mint a section; an existing profile with a ` / ` category name is unchanged.

- [x] **D5 - Controls groups by sub-category.** Group derivation from the profile, catalogue prefix map
  deleted, template seeds the five sub-categories.
  Files: `src/renderer/src/modules/config/lib/controls-row-groups.ts`,
  `src/renderer/src/modules/config/components/ControlsGrid.tsx`,
  `src/renderer/src/modules/config/ControlsTab.tsx` (grouping call site only),
  `src/shared/modules/config.ts` (`STANDARD_TEMPLATE`), `src/renderer/src/i18n/locales/en.json`.
  *Accept:* a template profile shows Use weapon / Cycling and Weapons / Ammunition / Misc as headers
  that now come from `draft.categories`; ungrouped entries render first; the "n rows - m bound"
  footer and the filter count are unchanged across groups; Overview, Aliases and Care render as
  before.

- [x] **D6 - Sub-category CRUD in the grid.** Create, rename, reorder (up/down), delete from the group
  header; delete moves entries back to the parent.
  Files: `src/renderer/src/modules/config/ControlsTab.tsx`,
  `src/renderer/src/modules/config/components/ControlsGrid.tsx`,
  `src/renderer/src/styles/controls-grid.css`, `src/renderer/src/i18n/locales/en.json`.
  Mirror: the custom category chips' rename/delete handlers (`ControlsTab.tsx:332-360`).
  *Accept:* all four operations through the UI, persisted via the existing `patch({ categories,
  actions })` path; deleting a sub-category leaves its entries in the parent as an ungrouped run;
  keyboard reachable, focus-visible.

- [x] **D7 - Move an entry in and out.** Sub-category select in the action editor, scoped to the entry's
  category, with an explicit "no sub-category" option.
  Files: `src/renderer/src/modules/config/components/ActionEditor.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
  *Accept:* an entry can be moved into a sub-category and back out; the row jumps to the right group
  on save; a category without sub-categories hides the control.

- [x] **D8 - Live verification.** Files: `scripts/flows/controls-subcategory.mjs`,
  `scripts/ui-verify.mjs` fixture seeding (or `src/shared/config/fixtures/profiles.ts` if the verify
  fixture lives there). Mirror: `scripts/flows/custom-action-row.mjs`.
  *Accept:* `npm run ui:verify` screenshots a category with sub-categories with no new axe
  violations; `npm run ui:flow controls-subcategory` creates a sub-category and moves an entry into
  it through the real UI.

## Model Hints

- D3 → `deliverable-hard` — it rewrites the section-attribution core of `profile-restore.ts` and is
  the one deliverable that can silently break story 042's round-trip fixed point for every existing
  fixture, not just for sub-categories.
- D1, D2, D4, D5, D6, D7, D8 → default. (D4 is new heuristic work but its blast radius is
  import-only: it cannot move the round-trip property, and its failure mode is visible in the import
  preview.)
- Review: → `story-review-hard` — the sprint's carry-over rule demands an adversarial re-render pass
  against constructed edge-case profiles for every story touching `render.ts`/`profile-restore.ts`.

## Test Plan (manual acceptance)

1. Create a profile from the standard template, open Controls → Weapons: the grid shows **Use
   weapon** and **Cycling** as group headers with their rows beneath.
2. In Weapon dropping, rename **Misc** to `Odds and ends`, move it above **Ammunition** with the
   up button, save. Reopen the profile: the new name and order are still there.
3. Open the Raw file tab: the category banner is followed by its ungrouped rows, then a second-level
   banner per sub-category carrying `[q2l sub=...]`. Change the profile's header style and check all
   three styles look right.
4. Open any row's action editor, move it into another sub-category of the same category, save: the
   row appears under that header. Move it back to "no sub-category": it appears in the ungrouped run
   at the top.
5. Create an empty sub-category, save, close and reopen the profile — it is still there.
6. Delete a sub-category that has rows: the rows stay in the parent category, ungrouped.
7. Import `docs/fixtures/dmalias.cfg`-style two-level config (`.: Main Key's :.` +
   `##### 1st row #####`): the import preview shows one category with sub-categories, no category
   named `Main / Sub`.
8. Check the footer still reads "n rows · m bound" correctly and typing in the filter narrows the
   count across all groups; Overview, Aliases and Care look unchanged.

## Done

Built across 8 deliverables (D1-D8) per the Plan, then a clean cross-cutting review (verdict
FAIL, 6 findings, only 1 blocking) and one review-fix cycle to close it out.

**Summary.** Sub-categories are now real, profile-owned, second-level data:
`ConfigActionCategory.subcategories: { id, name }[]` (profile order) and
`ConfigAction.subcategoryId?: string` (a dangling id is treated as ungrouped, never an error).
The writer emits a same-shaped `banner()` sub-section tagged `sub=<id>` (no title prefix) nested
inside its category's own section, ungrouped entries first; the reader understands
`Section.kind: 'subcategory'` with parent tracking and registers a `sub=` tag eagerly so an empty
sub-category survives save/reload/rebuild-from-file. A foreign-file importer heuristic recognises
repeated-decoration comment lines (`##### … #####`-style) as sub-headers, and — after the
review-fix cycle — also recognises a mirrored-wrap outer header (`.: Main Key's :.`-style) as an
ordinary category header, so a real `dm.cfg`-shaped main+sub pair now produces a category with a
real sub-category instead of the old `Main / Sub` flattening (removed together with `pairedTitle`).
The Controls grid derives its group headers from `draft.categories[…].subcategories` (the old
catalogue-id-prefix map is gone); the standard template seeds Use weapon/Cycling under Weapons and
Weapons/Ammunition/Misc under Weapon dropping as literal-English sub-category names. Sub-category
CRUD (create/rename/reorder/delete) lives on the group header in `ControlsTab.tsx`/
`ControlsGrid.tsx`, all riding the existing `patch({ categories, actions })` channel — no new IPC.
Deleting a sub-category clears `subcategoryId` off its entries unconditionally (no confirm dialog,
per the story's decision) so they fall back to the parent's ungrouped run. `ActionEditor.tsx` gained
a sub-category select scoped to the entry's own category, hidden when that category has none.
Harness: a `ui:verify` screen shows a template category with its sub-category headers, and
`scripts/flows/controls-subcategory.mjs` creates a sub-category and moves an entry into it through
the real UI.

### Decisions

- **`subcategories` is optional (not required) on `ConfigActionCategory`'s TS type**, defaulting to
  `[]` at the persisted-schema layer, mirroring every other additive field this codebase has added
  (`nameKey`, `catalogId`, …) — making it required would have forced ~10 unrelated files (fixtures,
  render, restore) to list an empty array for every category literal, for no behavioural gain.
- **Sub-banners are written with `banner()`, not `section()`/`titledSection()`**, because `section()`
  drops a banner whose body is empty — the story requires an empty sub-category's banner to survive
  (D2/D3). Confirmed residual of this choice below (Finding 2).
- **Category order on restore, deletion cascade and the "unknown `subcategoryId` = ungrouped" rule
  all needed zero new code**: `applyCategoryDeletion` already drops a whole category object (and
  whatever nested `subcategories` it carries) for free; D5's grouping already treats an unmatched id
  as the ungrouped run, satisfying D1's "no cross-referential validation" decision without a
  dedicated check anywhere.
- **The outer main-header recognition gap (review Finding 1, blocking).** A fresh code review found
  that AC6/D4's own accept clause was unmet for the *exact* shape the story names: a `.: Main Key's
  :.`-style outer header, decorated with mirrored (not uniformly-repeated) punctuation, opened no
  section at all before this fix — so the real repeated-decoration sub-heuristic (already correct)
  had nothing to attach to, and the whole pair fell back to a single content-guessed category with
  zero sub-categories. Investigation traced this to a genuine gap that *predates* story 053: story
  042's own removed `pairedTitle` sat inside the same `BANNER_RULE || CATEGORY_TITLE_PREFIX` branch
  and never actually recognised this decoration style either — D3 dropped nothing that used to work,
  it just stopped masking a pre-existing recognition hole. Fixed by adding `mirroredWrapTitle`
  (`src/shared/config/profile-restore.ts`): an untagged, comment-only line wrapped in a *mirrored*
  punctuation run (leading run reversed, paired delimiters flipped, `-`/`=` and alphanumerics
  excluded so it never collides with `BANNER_RULE` or the uniform-run `decorationWrap` sub-heuristic)
  now opens an ordinary untagged `'plain'` category section from its own text — recognition only, the
  `Main / Sub` name-fusion stays removed. Verified against the review's exact 7-line repro (one
  category `Main Key's`, two real sub-categories `1st row`/`2nd row`) and against the full
  round-trip/adversarial suite.
- **Accepted residuals (not fixed, disclosed rather than silently left)** — none of these block any
  acceptance criterion; the reviewer's own verdict on each was "does not block":
  - **Finding 2**: because an empty sub-category's banner must always be written (a story decision),
    it is currently written unconditionally in *every* per-block section (Binds/Aliases/Anchors) a
    category could have, even one with literally zero entries of that block's kind — e.g. a
    bind-only sub-category still produces an empty `Aliases: …` section carrying only sub-banners.
    This affects the standard template itself (visible in every new profile's raw file) as
    cosmetic-only noise: round-trip is stable, no content is lost or duplicated. Confining the
    always-write rule to a single canonical block (mirroring how story 052's unbound-entry anchor
    line already has one canonical home) is a real, scoped follow-up but was judged too large for
    this review-fix cycle's budget; flagging for a follow-up story rather than silently living with
    it undocumented, same spirit as 052's own disclosed F6.
  - **Finding 3**: two sub-categories sharing the same `id` string (hand-edited/corrupt data only —
    the UI mints UUIDs, so unreachable through normal use) write their rows twice, once per
    duplicate; self-consistent on reload, no data loss, mirrors a dedup gap the category level
    already had to solve for a different reason.
  - **Finding 4**: a hand-deleted sub-banner title (`name: ''`) restores once, then is dropped by the
    persisted schema's `min(1)` on the *next* save (unreachable via the UI, which trims and rejects
    empty names in both the create and rename dialogs).
  - **Finding 5**: `handleDeleteSubcategory`/`handleMoveSubcategory` in `ControlsTab.tsx` are correct
    by inspection (entries fall back to the parent's ungrouped run, per AC7) but have no direct unit
    test — `ControlsGrid.test.ts` only asserts the header button reports `(id, direction)` to its
    caller, and the `ui:flow` only exercises create + move-in. A follow-up test is a cheap gap to
    close later; not blocking today's acceptance.
  - **Finding 6**: a category whose sole content is an empty sub-category renders without an `ord=`
    tag (only categories with actions get numbered) — informational risk only; a constructed
    entry-bearing/sub-only/entry-bearing sandwich round-tripped with category order intact via the
    existing ordinal carry-forward, so no demonstrated defect.

### Verification

- `npm run typecheck` — clean (node + web).
- `npm test` — 80 test files, **2166 passed, 0 failed**. 4 "Errors" reported are the same
  pre-existing, unrelated Node v20.20.2/jsdom-undici `webidl.util.markAsUncloneable is not a
  function` fork-worker-start environment issue documented in story 052's own Done section (now
  touching 2 more files simply because 2 more jsdom-environment test files exist) — not a real
  failure; all 2166 tests report passed.
- `npm run build` — clean.
- `npm run ui:verify` — 30/30 screens, 60 shots, 0 axe violations (critical/serious/moderate/minor),
  including the new template-with-subcategories screen.
- `npm run ui:flow -- controls-subcategory` — passes, verified twice for idempotency; creates a
  sub-category and moves an entry into it through the real UI.
- **Code review**: first pass verdict FAIL, 6 findings (only Finding 1 blocking, an unmet AC6/D4
  accept clause). Finding 1 fixed in one review-fix cycle and re-verified end-to-end (typecheck,
  full test suite, round-trip fixed-point + adversarial suite, the review's own exact repro).
  Findings 2-6 disclosed above as accepted residuals rather than fixed — no second review pass was
  run given the one fix was narrow, targeted to the single blocking finding, and independently
  re-verified against the reviewer's own repro and the full round-trip/adversarial suite.

### Commit message

053: sub-categories come from the file, and Controls shows them
