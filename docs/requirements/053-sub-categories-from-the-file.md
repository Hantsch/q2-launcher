---
id: 053
title: Sub-categories come from the file, and Controls shows them
status: draft
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

- [ ] A category can contain sub-categories (one level below a category); an entry belongs to a
      category and optionally to one of its sub-categories.
- [ ] Controls shows a category's sub-categories as group headers with their rows beneath, in the
      profile's order; entries directly under the category appear first as an ungrouped run.
- [ ] Sub-categories can be created, renamed, reordered and deleted from the grid; an entry can be
      moved into and out of a sub-category (row menu or the action editor here; drag and drop
      comes with story 054).
- [ ] Story 052's standard template seeds Use weapon / Cycling and Weapons / Ammunition / Misc as
      real sub-categories, replacing the catalogue-derived group headers.
- [ ] The file writes a sub-category as a second-level section header under its category's header
      and reads it back as the same sub-category; the header follows the profile's section header
      style; story 042's round-trip property holds.
- [ ] Importing a foreign file with a main+sub header pair produces a category with a
      sub-category, not a flat `Main / Sub` category; an existing profile whose category name already
      contains ` / ` from an earlier import is left alone - no guessing.
- [ ] Deleting a sub-category keeps its entries in the parent category.
- [ ] Overview, Aliases and Care keep working unchanged (none of them needs to show the
      sub-category); the "n rows - m bound" footer and the filter count across sub-categories.
- [ ] `npm run ui:verify` shows a category with sub-categories; a `ui:flow` creates one and moves
      an entry into it through the real UI.

## Open Questions

1. **Depth:** exactly two levels (category -> sub-category), or arbitrary nesting? Recommendation:
   two - it matches every reference config we have and keeps the grid readable.
2. **Mixing:** can a category hold ungrouped entries *and* sub-categories? Recommendation: yes,
   ungrouped first - otherwise every template category would need a "General" sub-category.
3. **Foreign second-level markers:** `dm.cfg` marks blocks with `##### 1st row #####` comment lines
   inside a section, not with a banner pair. Should the importer read such a decorated comment-only
   line as a sub-category header (heuristic: repeated decoration characters around a short title),
   or leave it as a preserved line? Recommendation: recognise it - it is exactly the structure I
   want to see - keeping story 042's rule that a wrong split (not a wrong merge) is the safe failure.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
