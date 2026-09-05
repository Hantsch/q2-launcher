---
id: 052
title: Controls shows my categories, the template only seeds them
status: draft
created: 2026-09-05
---

## Requirement

Today the Controls tab is not an editor of my config; it is a catalogue with my config laid over
it. The three categories Movement / Weapons / Weapon dropping are constants
(`BUILT_IN_ACTION_CATEGORIES`, `src/shared/modules/config.ts:132-143`), never persisted, always
shown (`ControlsTab.tsx:1012`), and cannot be renamed, deleted or reordered (`:1012-1037`, versus
the custom chips at `:1039-1101` that can). Every catalogue row renders whether or not my profile
has it (`lib/controls-row-entries.ts:64-92`, "lazy materialisation" `lib/catalog-binds.ts:8-14`).
Rows in those three categories come in the catalogue's order, not mine
(`controls-row-entries.ts:48-55`); only free-form rows have move buttons (`ControlsTab.tsx:934-949`).
A new profile seeds no categories and no actions at all (`main/modules/config/profiles.ts:61-75`;
the "standard template" is 6 cvars and 6 binds, `config.ts:398-415`). The writer hardwires the
three built-ins first in the file (`render.ts`: movement -> weapons -> drops -> custom -> other).

For an imported config with its own structure this is wrong twice: it shows three categories with
dozens of "Empty" rows my file does not have, and it hides my own structure behind them. It does
not feel like an editor for *my* config; it feels like a form I am supposed to fill in.

What I want: the categories are a **template**, not a fixture. A new profile starts with the
structure as it is today - Movement, Weapons, Weapon dropping with their rows - as a suggestion.
From then on it is mine: rename, reorder, delete any of them, add my own, and the file follows. A
profile shows exactly the categories and rows it has; nothing is overlaid. The catalogue stays
available as a source of suggestions when I add things, not as the shape of the screen.

## Acceptance Criteria

- [ ] The category rail shows exactly the profile's categories, in the profile's own order. A
      profile with only an "Imported" category shows only that; a profile with no categories shows
      an empty state that offers the template.
- [ ] Every category - including the three that used to be built in - can be renamed, deleted and
      reordered from the rail; no category is special.
- [ ] Rows inside every category are the profile's entries in the profile's order, and every row
      can be moved (the existing up/down until story 054 adds drag and drop). A catalogue-backed row
      is an ordinary entry once it is in the profile. No row is rendered for an entry the profile
      does not have.
- [ ] Creating a profile from the standard template seeds the three categories with their rows as
      they appear today, unbound except for the template's own binds (the Use weapon / Cycling /
      Weapons / Ammunition / Misc grouping stays catalogue-derived until story 053 makes it real
      sub-categories). Creating an empty profile seeds no categories.
- [ ] Seeded, still-unbound rows survive Save, reload from the file, rebuild-from-file and a
      re-import of the launcher's own file - the structure is in the file, not only in the cache
      (see Open Questions).
- [ ] "Add action" offers the catalogue's actions (with their known commands and drop/ammo
      knowledge) as suggestions next to a free-form action; "New category" offers the template's
      categories next to a blank one.
- [ ] Importing a config creates only the categories the file has; where the importer files an
      entry under one of the former built-in ids, that category is created in the profile like any
      other.
- [ ] The file's section order follows the profile's category order; renaming a category renames
      its section header; story 042's round-trip property holds.
- [ ] Existing profiles migrate once: a profile that shows the three built-ins today keeps showing
      them with the same rows after the update - nothing disappears from anyone's Controls tab.
- [ ] Deleting a category that has entries asks first and says what happens to its entries.
- [ ] `npm run ui:verify` covers the template-seeded and the imported-only cases; a `ui:flow`
      renames and reorders a former built-in category through the real UI.

## Open Questions

1. **How does an unbound row live in the file?** Today an entry with no key whose commands are the
   catalogue default has no line at all (`docs/systems/config-module.md`, "Named limitation") -
   harmless while the catalogue overlay showed the row anyway, fatal once rows come from the
   profile: every template row would vanish on the first reload, because the file is the source of
   truth (story 043). Options: (a) a comment-only placeholder line per unbound entry
   (`// Forward [q2l cid=movement:forward]`); (b) a commented-out bind
   (`//bind  "+forward"   // Forward [q2l cid=movement:forward]`) - a shape hand-written configs
   already use for parked binds, and it also carries the command for a non-catalogue entry; (c)
   unbound rows live only in `state.json` and are accepted to vanish on reload. Recommendation:
   (b) - readable, carries the command, one shape for catalogue and custom entries.
2. **Deleting a category with entries:** delete them too (today, `ControlsTab.tsx:356`), or move
   them to the previous category? Recommendation: offer both in the confirm dialog, default "move".
3. **Where the catalogue lives afterwards:** only inside "Add action" (a searchable picker grouped
   as today) plus "New category -> from template", or additionally a one-click "Add the standard
   template" on an empty Controls tab. Recommendation: both.
4. **Migration of existing profiles:** materialise only rows that are bound or edited, or every
   catalogue row so the tab looks identical? Recommendation: every row, once - "nothing disappears"
   beats a smaller file.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
