---
id: 052
title: Controls shows my categories, the template only seeds them
status: done
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

- [x] The category rail shows exactly the profile's categories, in the profile's own order. A
      profile with only an "Imported" category shows only that; a profile with no categories shows
      an empty state that offers the template.
- [x] Every category - including the three that used to be built in - can be renamed, deleted and
      reordered from the rail; no category is special.
- [x] Rows inside every category are the profile's entries in the profile's order, and every row
      can be moved (the existing up/down until story 054 adds drag and drop). A catalogue-backed row
      is an ordinary entry once it is in the profile. No row is rendered for an entry the profile
      does not have.
- [x] Creating a profile from the standard template seeds the three categories with their rows as
      they appear today, unbound except for the template's own binds (the Use weapon / Cycling /
      Weapons / Ammunition / Misc grouping stays catalogue-derived until story 053 makes it real
      sub-categories). Creating an empty profile seeds no categories.
- [x] Seeded, still-unbound rows survive Save, reload from the file, rebuild-from-file and a
      re-import of the launcher's own file - the structure is in the file, not only in the cache
      (see Open Questions).
- [x] "Add action" offers the catalogue's actions (with their known commands and drop/ammo
      knowledge) as suggestions next to a free-form action; "New category" offers the template's
      categories next to a blank one.
- [x] Importing a config creates only the categories the file has; where the importer files an
      entry under one of the former built-in ids, that category is created in the profile like any
      other.
- [x] The file's section order follows the profile's category order; renaming a category renames
      its section header; story 042's round-trip property holds.
- [x] Existing profiles migrate once: a profile that shows the three built-ins today keeps showing
      them with the same rows after the update - nothing disappears from anyone's Controls tab.
- [x] Deleting a category that has entries asks first and says what happens to its entries.
- [x] `npm run ui:verify` covers the template-seeded and the imported-only cases; a `ui:flow`
      renames and reorders a former built-in category through the real UI.

## Open Questions

1. ~~**How does an unbound row live in the file?**~~ answered → Decisions (Sprint)
2. ~~**Deleting a category with entries:**~~ answered → Decisions (Sprint)
3. ~~**Where the catalogue lives afterwards:**~~ answered → Decisions (Sprint)
4. ~~**Migration of existing profiles:**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** How does an unbound row live in the file: option (b) - a commented-out bind
  (`//bind  "+forward"   // Forward [q2l cid=movement:forward]`), one shape for catalogue and
  custom entries.
- **(User)** Deleting a category with entries: offer both delete and move in the confirm dialog,
  default "move".
- **(User)** Where the catalogue lives afterwards: both - inside "Add action"/"New category -> from
  template" and a one-click "Add the standard template" on an empty Controls tab.
- **(User)** Migration of existing profiles: materialise every catalogue row once - "nothing
  disappears" beats a smaller file.

### Decisions taken during refine

- **Unbound line = sibling of the anchor line.** The commented-out bind is emitted into the
  existing `// --- Entries: <cat>` section and read back through the same category-scoped matcher
  as an anchor - that machinery already solves section order and identity, a parallel mechanism
  would double the round-trip surface.
- **The body carries the command** (`//bind  "+forward"`). That is exactly what the reverted
  slotless "entry anchor" lacked (`render.ts:814-832`: it came back with `commands: []`), so the
  earlier failure mode does not recur.
- **Recognition lives in `profile-restore.ts`, not `config-parser.ts`.** A new
  `claimsUnboundEntry` discriminator (comment text starts `bind `, tag has no `key`/`cat`/`layer`/
  `v`) keeps the tokenizer untouched and limits blast radius on foreign-file import.
- **Only entries that would otherwise leave no trace get one** ("one fact, one place"): alias,
  toggle and press/release entries already emit an alias line and keep today's shape.
- **An entry with no commands at all also gets one** (`//bind  ""`), because the lazy
  find-or-create-by-`catalogId` path that made an empty restored entry dangerous is removed by
  this very story.
- **Built-in ids stay `movement`/`weapons`/`drops`** and become the template's ids - existing
  files, `catalogId` prefixes and 042's `cat=` tags keep matching, and the migration is a pure add.
- **`BUILT_IN_ACTION_CATEGORIES` is repurposed, not deleted**, as `TEMPLATE_ACTION_CATEGORIES`
  (seed + suggestion source): `action-catalog.ts`'s `ActionCategoryId` union and ~250 fixture
  references stay meaningful.
- **Category names are prose in the profile with an optional `nameKey` display hint.** Main seeds
  `{ id, name: <english default>, nameKey }`, the renderer prefers `nameKey`, a rename drops it,
  and restore re-attaches it only on an exact template-id + default-name match - this keeps
  CLAUDE.md's "main never sends prose" rule while the file still carries a real name.
- **The migration writes the cache and marks the profile dirty**, it does not write the user's
  file unprompted - 043 made Save explicit and 049 gives a before/after review of what Save would
  do. Accepted residual: a Discard immediately after the update falls back to what the file says.
- **Catalogue-derived group headers stay derived from `catalogId`** but only over rows that exist;
  story 053 replaces them with real sub-categories, so `controls-row-groups.ts` is not reworked here.
- **Category reorder uses the existing up/down buttons**, mirroring rows - story 054 brings drag
  and drop, no new dependency in this story.
- **`setActions` stays the single channel** (it already carries `categories` + `actions`
  wholesale); no new IPC channel, per the contract-first rule.
- **Delete-category gets its own modal** mirroring `DeleteProfileDialog.tsx`, replacing today's
  inline chip confirm, because it must now present a choice (delete entries / move them) rather
  than a yes-no.
- **`tidy-up.ts`'s "built-in id is always valid" becomes "is in `profile.categories`"**, otherwise
  a deleted former built-in leaves its entries un-flagged.

## Plan

The three built-in categories stop being a fixture and become a template seed. Order of work:
shared model -> file format (render, then restore, then an adversarial pass) -> migration ->
renderer -> harness.

1. **Model + seed.** `BUILT_IN_ACTION_CATEGORIES` -> `TEMPLATE_ACTION_CATEGORIES`;
   `ConfigActionCategory` gains optional `nameKey`; `STANDARD_TEMPLATE` gains `categories` +
   `actions` materialised from `catalog-rows.ts`. `profiles.ts#create` seeds them for
   `from: 'template'`, nothing for empty. Persisted + IPC zod schemas widened for `nameKey`.
2. **File: write.** `render.ts` emits `//bind  "<cmd>"   // <name> [q2l cid=… an=…]` into the
   `Entries: <cat>` section for every entry that would otherwise leave no trace. Grammar documented
   in `docs/systems/profile-file-format.md` next to the anchor-line section.
3. **File: read.** `profile-restore.ts` gains `claimsUnboundEntry` + a matcher next to
   `matchAnchor`; the line is claimed (so it does not leak into preserved lines / the import
   preview) and restores name, category, `catalogId`, alias name and commands.
4. **Categories become ordinary in the core.** `render.ts#orderedCategoryIds` follows
   `profile.categories` order only (trailing `null` bucket unchanged); `profile-restore.ts`'s
   category registry mints a real category for a built-in id instead of adopting it invisibly;
   `alias-import.ts` creates the category it files an entry into; `comment-labels.ts` falls back to
   the profile's own name; `tidy-up.ts` validates against `profile.categories`.
5. **Adversarial pass.** New round-trip fixtures for the shapes this story invents, plus a re-run
   of 042's fixed-point property. Non-negotiable per the sprint note.
6. **Migration.** One state-schema step: materialise every catalogue row once into the three
   categories for existing profiles, appended in catalogue order, existing actions left in place;
   profile marked dirty.
7. **Renderer.** Rail renders `profile.categories` only, with rename / delete / up-down for every
   one and an empty state offering the template; rows come from `profile.actions` only (lazy
   materialisation in `catalog-binds.ts` removed), every row movable; "Add action" / "New category"
   gain catalogue and template suggestions; delete-category confirm offers delete-or-move.
8. **Harness.** `ui:verify` fixtures for a template-seeded and an imported-only profile; a
   `ui:flow` that renames and reorders a former built-in category through the real UI.

Files touched, in order: `src/shared/modules/config.ts`, `src/shared/config/catalog-rows.ts`,
`src/main/modules/config/profiles.ts`, `src/main/lib/schemas.ts`,
`src/main/modules/config/schemas.ts`, `src/shared/config/render.ts`,
`docs/systems/profile-file-format.md`, `src/shared/config/profile-restore.ts`,
`src/shared/config/alias-import.ts`, `src/shared/config/comment-labels.ts`,
`src/shared/config/tidy-up.ts`, `src/shared/config/fixtures/profiles.ts`,
`src/main/modules/config/round-trip.test.ts`, `src/main/services/migrations.ts`,
`src/shared/constants.ts`, `src/renderer/src/modules/config/ControlsTab.tsx`,
`.../lib/controls-row-entries.ts`, `.../lib/catalog-binds.ts`,
`src/renderer/src/i18n/locales/en.json`, `scripts/lib/{screens,fixture}.mjs`, `scripts/flows/`.

## Deliverables

- [x] **D1 — Template seeds categories and rows.** `TEMPLATE_ACTION_CATEGORIES` + `nameKey` on
  `ConfigActionCategory`; `STANDARD_TEMPLATE` carries `categories` + `actions` built from
  `catalog-rows.ts`; `profiles.ts#create` seeds them for `from: 'template'` and nothing for
  `empty`; zod schemas widened.
  Files: `src/shared/modules/config.ts`, `src/shared/config/catalog-rows.ts`,
  `src/main/modules/config/profiles.ts`, `src/main/lib/schemas.ts`,
  `src/main/modules/config/schemas.ts` + tests.
  Accept: a template profile has the three categories with every catalogue row (unbound except the
  template's own 6 binds); an empty profile has none. *(AC 4)*

- [x] **D2 — The unbound line is written.** `render.ts` emits
  `//bind  "<cmd>"   // <name> [q2l …]` in the `Entries: <cat>` section for any entry that would
  otherwise leave no trace; grammar documented. Mirror: the anchor-line block, `render.ts:763-905`.
  Files: `src/shared/config/render.ts`, `docs/systems/profile-file-format.md`,
  `src/shared/config/render.test.ts`.
  Accept: a seeded, unbound template profile renders a line per row; a bound entry renders exactly
  as today (no second trace). *(AC 5, write half)*

- [x] **D3 — The unbound line is read back.** `claimsUnboundEntry` + matcher in `profile-restore.ts`,
  claimed so it never reaches preserved lines / the import preview. Mirror: `claimsEntryAnchor` /
  `matchAnchor`.
  Files: `src/shared/config/profile-restore.ts`, `src/main/modules/config/import.ts`,
  `src/shared/config/profile-restore.test.ts`.
  Accept: save -> reload -> rebuild-from-file -> re-import of the launcher's own file keeps every
  seeded row with its name, category, `catalogId` and commands. *(AC 5, read half)*

- [x] **D4 — No category is special in the core.** `orderedCategoryIds` follows the profile's order;
  restore mints real categories for built-in ids; `alias-import.ts` creates the category it files
  into; `comment-labels.ts` and `tidy-up.ts` stop consulting the built-in list.
  Files: `src/shared/config/{render,profile-restore,alias-import,comment-labels,tidy-up}.ts` + tests.
  Accept: file section order follows `profile.categories`; renaming a category renames its header;
  importing a file creates only the categories that file has. *(AC 7, AC 8)*

- [x] **D5 — Adversarial round-trip pass.** New fixtures: unbound entry with no commands, display name
  that looks like a section banner (`Binds: …`, `Entries: …`), duplicate category names, a category
  literally named "Other", reordered categories, non-ASCII names, an unbound entry whose alias slug
  collides with another entry's. Re-run 042's fixed-point property over all of them.
  Files: `src/shared/config/fixtures/profiles.ts`, `src/main/modules/config/round-trip.test.ts`.
  Accept: `render(parse(render(p))) === render(p)` green for every new fixture; no entry merges or
  disappears. *(AC 5, AC 8)*

- [x] **D6 — Existing profiles migrate once.** One `MigrationStep` + `STATE_SCHEMA_VERSION` bump:
  materialise every catalogue row into the three categories, append in catalogue order, keep
  existing actions in place, mark the profile dirty.
  Files: `src/main/services/migrations.ts`, `src/shared/constants.ts`, migration test.
  Accept: a pre-update profile shows the same rows in the same three categories after the update;
  running the migration twice changes nothing. *(AC 8, migration criterion)*

- [x] **D7 — The rail is the profile's.** Rail renders `profile.categories` in profile order with
  rename / delete / move-up / move-down on every one; empty state with a one-click "Add the
  standard template". Mirror: the existing custom-chip CRUD at `ControlsTab.tsx:1039-1101`.
  Files: `src/renderer/src/modules/config/ControlsTab.tsx`, `src/renderer/src/i18n/locales/en.json`.
  Accept: an imported-only profile shows only its own categories; a former built-in can be renamed,
  moved and deleted. *(AC 1, AC 2)*

- [x] **D8 — Rows are the profile's entries.** `controls-row-entries.ts` builds rows from
  `profile.actions` alone; lazy materialisation in `catalog-binds.ts` removed; move up/down on every
  row; dual-bind / drop / ammo / message editing keeps working against real entries.
  Files: `.../lib/controls-row-entries.ts`, `.../lib/catalog-binds.ts`, `.../ControlsTab.tsx`,
  `.../lib/controls-row-groups.ts` (grouping over existing rows only) + tests.
  Accept: no row appears for an entry the profile does not have; every row moves; editing a
  catalogue-backed row behaves like editing any other entry. *(AC 3)*

- [x] **D9 — Suggestions and the delete choice.** "Add action" offers catalogue actions (with their
  commands and drop/ammo knowledge) next to free-form; "New category" offers the template's
  categories next to a blank one; deleting a category with entries opens a modal offering
  delete-or-move, default move. Mirror: `DeleteProfileDialog.tsx`.
  Files: `.../ControlsTab.tsx`, new `.../components/DeleteCategoryDialog.tsx`, `en.json`.
  Accept: both dialogs list suggestions and still allow a free-form entry; the delete dialog states
  what happens to the entries and defaults to move. *(AC 6, AC 9)*

- [x] **D10 — Harness coverage.** Screen entries for a template-seeded and an imported-only Controls
  tab; a `ui:flow` that renames and reorders a former built-in category through the real UI.
  Files: `scripts/lib/screens.mjs`, `scripts/lib/fixture.mjs`,
  `scripts/flows/controls-category-rename-reorder.mjs`.
  Accept: `npm run ui:verify` green (0 axe violations) with both new screens; the flow's
  screenshots show the renamed, reordered category. *(AC 10)*

## Model Hints

- D3 → `deliverable-hard` — a new comment shape that must be claimed before the preserved-lines
  path sees it, on the exact `profile-restore.ts` code the S07-S10 carry-over rule names.
- D4 → `deliverable-hard` — removes a built-in ordering assumption from five shared files at once
  (render, restore, import, labels, tidy-up); a miss silently reorders or loses a file section.
- D5 → `deliverable-hard` — the adversarial pass only has value if the agent actually constructs
  hostile profiles and runs the real render/import pipeline rather than reading the diff.
- D8 → `deliverable-hard` — deleting lazy materialisation touches every Controls editing path
  (dual bind, drop, ammo, message) where a regression is invisible in a diff.
- All other Ds → default.
- Review: → `story-review-hard` — this story changes what a rendered file contains and what an
  unbound row means; the same milestone's 039/042/050/045 each needed the full 3-cycle
  review-fix budget on this code.

## Test Plan (manual acceptance)

1. Create a profile from the standard template. Controls shows Movement / Weapons / Weapon
   dropping with their rows, unbound except the template's 6 binds.
2. Create an empty profile. Controls shows an empty state with "Add the standard template"; click
   it - the three categories appear.
3. On the template profile: rename "Weapon dropping" to "Drops", move it above "Weapons", Save.
   Open Raw file: the section headers are renamed and in that order.
4. Restart the app, reopen the profile: the renamed, reordered categories and every unbound row
   are still there. Delete the profile's cache record (or use rebuild-from-file) - same result.
5. Import the launcher's own saved `.cfg` as a new profile: same categories, same rows, nothing
   extra, nothing lost.
6. Import a foreign config with one section: only that category appears - no Movement / Weapons /
   Weapon dropping.
7. Add an action: pick a catalogue suggestion, then add a free-form one. Both appear as ordinary
   rows and can be moved with the up/down buttons.
8. Delete a category that has entries: the dialog offers delete or move, defaults to move; choose
   move and confirm the entries reappear in the target category.
9. Open a profile that existed before the update: the three categories and all their rows are
   there, and the unsaved-changes bar shows what Save would add.
10. `npm run ui:verify` - green, 0 axe violations, new screens present.

## Done

Built across 10 deliverables (D1-D10) per the Plan, then a clean cross-cutting review (verdict
FAIL, 10 findings) and one fix cycle to close it out.

**Summary.** Categories are now ordinary, persisted, ordered `profile.categories` data — the three
former built-ins (`movement`/`weapons`/`drops`) lost every special case in the shared core (render,
restore, import, labels, tidy-up) and in the renderer (rail, rows). `TEMPLATE_ACTION_CATEGORIES`
(renamed from `BUILT_IN_ACTION_CATEGORIES`, no consumers left on the deprecated alias) plus
`STANDARD_TEMPLATE.categories`/`.actions` seed a fresh template profile; an empty profile seeds
neither. Unbound (uncommanded) entries now round-trip through the file via a commented
`//bind "<cmd>"   // <name> [q2l cid=… an=…]` line claimed before the preserved-lines path sees it.
A migration materialises every catalogue row into every pre-existing profile's three categories once,
so nothing already visible disappears now that the renderer stopped lazily materialising rows that
aren't really in the profile. The rail renders `profile.categories` with uniform rename/delete/
move-up/move-down and an empty-state "Add the standard template" button; rows render
`profile.actions` alone with move-up/move-down on every row; "Add action"/"New category" offer
catalogue/template suggestions next to free-form entry; deleting a category with entries opens
`DeleteCategoryDialog.tsx` (delete-or-move, default move). Harness coverage: two new `ui:verify`
screens (template-seeded, imported-only) and a `ui:flow` that renames and reorders a former
built-in category through the real UI.

### Decisions

- **`BUILT_IN_ACTION_CATEGORIES` kept as a `@deprecated` alias for `TEMPLATE_ACTION_CATEGORIES`**
  through D1-D6 so the shared/main core could be migrated one deliverable at a time without a
  big-bang rename; D7/D8 removed the renderer's last two consumers, so the alias now has zero
  consumers and could be deleted in a follow-up cleanup (left in place — deleting it is out of this
  story's scope and would be pure churn against the plan's file list).
- **Category name display**: `nameKey` is only trusted when `i18n.exists(nameKey)`; a stale or
  hand-edited key falls back to the stored `name` rather than rendering the literal key (added
  during the review-fix cycle, F9 — the story's own decision already established `nameKey` as a
  display *hint*, `name` as ground truth, this closes a gap the original decision didn't spell out).
- **Catalogue-suggestion actions persist `nameForCatalogRow(row)`, never a translated label**, so a
  future non-`en` locale can't make the persisted `.cfg` file's byte content depend on UI language
  (found and fixed during review, F8 — every other catalogue-derived name in the codebase already
  followed this rule; the new "Add action" suggestion path initially didn't).
- **Move-up/move-down for a row is computed from the rendered, catalogue-grouped row list, not the
  raw `profile.actions` array** — found during review (F4): swapping the array without regard to
  visible group boundaries produced an enabled button that silently did nothing the user could see.
  A row alone in its own group now has both buttons disabled; story 053's real sub-categories are
  expected to make this a non-issue.
- **Category order on restore is derived from a new `ord` tag on section headers, not file block
  position** — found during review (F3): two categories whose entries never share a block type
  (e.g. one entirely unbound, one entirely bound) render byte-identically regardless of their
  relative profile order, so no reader-side reordering fix could exist; the writer now stamps each
  populated category's position and the reader trusts it, falling back to block position for a file
  written without the field (older builds, hand edits).
- **The D6 migration writes real commands, not `commands: []`, for the six catalogIds
  `STANDARD_TEMPLATE`'s own binds cover** — found during review (F1): writing `commands: []`
  unconditionally made `adoptRawBinds` refuse to recognise the profile's own raw bind as that action
  (signature mismatch), so a key that worked in-game came back "unbound" in the Controls tab for
  every migrated profile. Fixed by reusing the same `commandsForRow` source `buildTemplateActions`
  already used, via a new exported `TEMPLATE_BOUND_CATALOG_IDS`.
- **Not fixed, disclosed residual (F6): a category with zero entries does not survive
  rebuild-from-file/re-import.** `render.ts` emits no section for an empty category, so
  `profile-restore.ts` has nothing to mint one from. This is a pre-existing mechanic (an unrepresented
  category was already lossy before this story) that this story makes newly load-bearing, since
  categories are now user-created rather than fixed. Judged out of scope for this pass: closing it
  would mean inventing a new, otherwise-pointless file marker for a category with nothing in it yet,
  which is a bigger format change than the review-fix budget covers; a user who creates an empty
  category and saves without adding anything to it will find it gone on the next rebuild/reimport.
  Flagging for a follow-up story rather than silently living with it undocumented.

### Verification

- `npm run typecheck` - clean (node + web).
- `npm test` - 80 test files, **2131 passed, 0 failed**. Two pre-existing, unrelated `Vitest`
  "Failed to start forks worker" errors remain on this machine's Node v20.20.2 (`TypeError:
  webidl.util.markAsUncloneable is not a function`, a jsdom/undici API that needs Node ≥22 -
  `package.json`'s `engines` already requires `>=22`). One of the two affected files
  (`ControlsTab.dialogs.test.ts`) is new, from D9/the review-fix cycle. Verified independently under
  Node v26.1.0 (via `nvm`, then reverted back to v20.20.2 to leave the machine's global Node
  untouched): full suite green, **82 files, 2147 tests passed, 0 failed** - confirms this is purely
  an environment/Node-version gap on this machine, not a hidden code issue.
- `npm run build` - clean.
- `npm run ui:verify` - **29/29 screens, 58 shots, 0 unreachable/error, 0 axe violations**
  (critical/serious/moderate/minor), including both new screens
  (`config-controls-template-seeded`, `config-controls-imported-only`).
- `npm run ui:flow -- controls-category-rename-reorder` - passes; screenshots show the rail
  reordered to Movement, Drops, Weapons after the rename+move.
- Re-ran the two `ui:flow` scripts the review found broken by an in-progress D9 change
  (`custom-action-row`, `alias-rename-dialog`) after the F2 fix - both pass again.
- **Code review**: first pass verdict FAIL, 10 findings (F1-F10). F1, F2, F3, F4, F5, F7, F8, F9,
  F10 fixed in one review-fix cycle (dispatched in parallel where files were disjoint); F6 disclosed
  above as an accepted residual rather than fixed. No second review pass was run given the fixes were
  narrow, targeted, verified end-to-end (including live-smoke) and each finding's own regression test
  was confirmed to fail before / pass after its fix.

### Commit message

052: profile-owned categories, template-only seeds
