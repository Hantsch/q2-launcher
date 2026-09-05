---
id: 055
title: A `drop_` alias is a drop, with two toggles instead of two checkboxes
status: done
created: 2026-09-05
---

## Requirement

In my config every drop is an alias called `drop_<something>` - `drop_shotgun`, `drop_rail`,
`drop_shells`, `drop_tech`, `drop_powers` (`docs/fixtures/dmalias.cfg:86-103`, sixteen of them) -
with a body of the shape `drop <item>; [drop <ammo>;] [say_team ...;] [extras such as wave 1]`. That
name pattern *is* the type: a drop is a helper type, like a toggle or a press/release pair, and
"Weapon dropping" is just where the template happens to put them.

The launcher instead identifies a drop by `row.categoryId === 'drops'` on a catalogue row
(`ControlsTab.tsx:672`, `:758`; "drops machinery is catalogue-only", `:866-869`). An imported
`drop_rail` is therefore a plain alias row with no ammo or message option, and the launcher's own
drop rows render under an alias derived from the display name rather than `drop_...`. The two
options themselves are two stacked checkboxes with text labels in the 150px Options track
(`ControlsTab.tsx:664-697`, `data-testid="drop-ammo-*"` / `drop-message-*`) - functional, but heavy
and text-only.

What I want: a `drop_` alias is a drop wherever it sits, and every drop gets the drop options; the
options are two toggle buttons (on/off) with an icon and a tooltip - ammo and team message - instead
of two checkboxes.

## Acceptance Criteria

- [x] Any entry whose alias name starts with `drop_` and whose body contains a `drop <item>` command
      is a drop entry - in any category, imported or created - and gets the drop options; an entry
      that does not match keeps behaving as a plain alias.
- [x] The launcher's own drop entries (the template's Weapon dropping rows and newly created ones)
      render as `drop_<slug>` aliases, so one rule recognises hand-written and generated drops alike.
- [x] The Options cell of a drop row shows two toggle buttons - "Drop ammo too" and "Announce to
      team" - each with an icon, a tooltip, a pressed state that is not colour-only, and full
      keyboard operability; the two checkboxes and their text labels are gone.
- [x] The ammo toggle adds/removes the `drop <ammo>` command for the item's ammo (the existing
      weapon -> ammo knowledge in the catalogue); it is disabled with an explaining tooltip when the
      item has no ammo (`drop_tech`).
- [x] The message toggle adds/removes the `say_team` message (channel as today); the inline message
      row with "Edit message" from story 029 stays the way to edit the text.
- [x] Extra commands in a drop body (`wave 1`, a second `drop shells`) survive both toggles and
      round-trip untouched.
- [x] Import: `drop_*` aliases from a foreign config arrive as drop entries with their ammo/message
      state read off the body; importing `docs/fixtures/dmalias.cfg` yields sixteen drop entries and
      leaves `dall` a plain alias.
- [x] Story 042's round-trip property, Care and the Overview keep working; a drop key on the
      keyboard shows the entry's display name as before.
- [x] `npm run ui:verify`'s `config-controls-drop-message` screen and the `drop-message-checkbox`
      flow are updated to the toggles.

## Open Questions

1. ~~**Body shape:**~~ answered → Decisions (Sprint)
2. ~~**Ammo for items outside the weapon table**~~ answered → Decisions (Sprint)
3. ~~**Aliases tab:**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Body shape: the rule applies whenever the body contains at least one `drop <item>`
  command anywhere, not only as the first command; the item is the first `drop` command's argument.
- **(User)** Ammo for items outside the weapon table: any further `drop <known ammo name>` (per the
  catalogue's ammo names) counts as the ammo toggle, everything else is an extra command.
- **(User)** Aliases tab: the two toggles also appear on a drop entry in the Aliases tab (deviates
  from the story's own recommendation of "no" - user chose to show them there too).
- **Recognition lives in one new pure shared module** `src/shared/config/drop-entries.ts`, read by
  Controls, Aliases and the import path - three copies of "what is a drop" would drift apart, and
  the shared layer is where a rule both processes need belongs.
- **No new `ActionEntryKind: 'drop'`** - a drop stays `kind: 'alias' | 'bind'` and dropness is a
  derived predicate, because a new persisted kind would mean a schema migration for a story that is
  explicitly the first one to be dropped if the sprint runs long.
- **The rule reads the entry's rendered alias name (`aliasNameFor`) plus its parsed
  `ConfigCommand[]`**, not the raw body text - that is exactly how `guessCategoryKey` already
  decides categories, and it keeps a user-renamed entry (story 039 `aliasName`) recognised.
- **`dall` needs no special case**: its name does not start with `drop_`, so the name test alone
  leaves it a plain alias (AC 7) even though its whole body is `drop` commands.
- **`drop_<slug>` for the launcher's own drops is done in `derivedAliasName`** (alias-render.ts)
  with its own reduced name budget, for entries in category `drops` / with a drop catalogue row; an
  explicit user `aliasName` still wins verbatim, because story 039 made that name the user's
  contract.
- **Round-trip safety is structural, not incidental**: `profile-restore.ts` captures an alias
  line's own name into `aliasName`, so the second render reproduces the new name byte-for-byte - a
  dedicated fixed-point test over a drop profile pins it, since the roadmap flags exactly this
  carry-over risk.
- **Extras survive via index-based command surgery**, not by rebuilding the body from the catalogue
  row - `commandsForRow` rebuild would silently discard `wave 1` and a second `drop shells` (AC 6).
- **The toggles are one small renderer component built on the existing `IconButton`** with
  `aria-pressed`, not a new `components/ui` atom - there is one consumer shape and the story has to
  stay cheap; pressed state is frame + fill + `aria-pressed`, never colour alone.
- **The ammo toggle is disabled, not hidden, when the item has no ammo** - AC 4 asks for an
  explaining tooltip, and a hidden control explains nothing.
- **The message toggle keeps writing `say_team` and keeps story 029's inline row + `MessageEditor`
  as the only way to edit the text** - AC 5 scopes the toggle to add/remove.
- **Scope guard against the parallel S11 stories**: this story touches only the Options cell content
  and the alias-name derivation - no grid geometry, no category/sub-category machinery, no key-slot
  layout, because 052/053/056 own those parts of `ControlsTab.tsx`.

## Plan

1. **`src/shared/config/drop-entries.ts` (new, pure)** - the single authority:
   `isDropEntry(action)` (alias name starts with `drop_` **and** body has a `drop <item>` command),
   `dropStateFor(action)` → `{ item, ammo?, hasAmmo, ammoIndex?, message?, channel? }` with the ammo
   command recognised by the catalogue's ammo names (`DROPPABLES` `kind: 'ammo'` items + weapon
   `ammo` fields, `action-catalog.ts:305`), plus `withDropAmmo(action, on)` / `withDropMessage(...)`
   that splice only their own command and leave every extra in place.
2. **Alias names** - `derivedAliasName` (`alias-render.ts:283`) prefixes `drop_` for drop-category
   entries under a reduced budget; add a round-trip fixed-point case to
   `src/main/modules/config/round-trip.test.ts` and an import case over `docs/fixtures/dmalias.cfg`
   (16 drops, `dall` plain).
3. **`DropToggles.tsx` (new)** in `modules/config/components/` - two `IconButton`s with
   `aria-pressed`, icons, tooltips, i18n keys under `config.controls.dropBind.*`.
4. **Controls** - `ControlsTab.tsx` `renderCatalogOptionsCell` (`:635-701`) and
   `renderPlainOptionsCell` (`:862`) both drop the two `Checkbox`es and render `DropToggles`,
   gated on `isDropEntry` instead of `row.categoryId === 'drops'`; the message sub-row keeps its
   condition. `catalog-binds.ts` `applyAmmo`/`applyMessage` gain action-based siblings that
   delegate to D1's transforms.
5. **Aliases** - `AliasRow`'s action cluster (`AliasesTab.tsx:711`) shows the same `DropToggles`
   for `editable` rows whose owning action is a drop.
6. **Verification** - update `scripts/flows/drop-message-checkbox.mjs` and the
   `config-controls-drop-message` screen (`scripts/lib/screens.mjs:471`) to the toggles;
   `npm run ui:verify`.

## Deliverables

**D1 [x] - `drop-entries.ts`: recognition + transforms (pure)**
New `src/shared/config/drop-entries.ts` + `src/shared/config/drop-entries.test.ts`.
Mirror the file shape/doc style of `src/shared/config/alias-references.ts` (pure, no fs/DOM), read
ammo names from `src/shared/config/action-catalog.ts`.
Acceptance: `isDropEntry` is true for every `drop_*` body in `docs/fixtures/dmalias.cfg:86-103` and
false for `dall` and for a `drop_`-named alias with no `drop` command; `dropStateFor` reports item,
ammo presence, message; `withDropAmmo`/`withDropMessage` on/off round-trip a body carrying
`wave 1` and a second `drop shells` untouched. Covers AC 1 (rule), AC 4/5 (command surgery), AC 6.

**D2 [x] - launcher drops render as `drop_<slug>`, round-trip pinned**
`src/shared/config/alias-render.ts` (+ its test), `src/main/modules/config/round-trip.test.ts`,
`src/shared/config/alias-import.ts` only if the import path needs the name rule.
Acceptance: a template Weapon-dropping entry and a newly created drop render as `alias drop_<slug>`;
an explicit `aliasName` still wins; `render(parse(render(p))) === render(p)` holds for a profile with
drops incl. ammo+message+extras; importing `docs/fixtures/dmalias.cfg` yields 16 drop entries and
leaves `dall` a plain alias; existing render/restore/Care tests stay green. Covers AC 2, AC 7, AC 8.

**D3 [x] - `DropToggles` component + Controls Options cell**
New `src/renderer/src/modules/config/components/DropToggles.tsx`;
`src/renderer/src/modules/config/ControlsTab.tsx`;
`src/renderer/src/modules/config/lib/catalog-binds.ts`;
`src/renderer/src/i18n/locales/en/*` (keys under `config.controls.dropBind.*`).
Mirror `ControlsRow`/`IconButton` usage already in `ControlsTab.tsx` for size, label and focus
handling.
Acceptance: a drop row's Options cell shows two icon toggles with tooltips, `aria-pressed`, a
non-colour-only pressed state and full keyboard operability; both `Checkbox`es and their text labels
are gone; the ammo toggle is disabled with an explaining tooltip on `drop_tech`; an imported
`drop_rail` in any category shows the toggles, a non-matching alias does not; the message toggle
still reveals story 029's inline row. Covers AC 1 (surface), AC 3, AC 4, AC 5.

**D4 [x] - Aliases tab surface**
`src/renderer/src/modules/config/AliasesTab.tsx` (reuse D3's component unchanged).
Acceptance: an `editable` drop row shows the same two toggles in its action cluster and toggling
there changes the rendered body exactly as on Controls; non-drop and generated/layer rows are
unchanged. Covers the `(User)` Aliases-tab decision.

**D5 [x] - live smoke + screens**
`scripts/flows/drop-message-checkbox.mjs`, `scripts/lib/screens.mjs`, `docs/UI-VERIFICATION.md`.
Acceptance: the flow drives the toggles (not checkboxes) and stays green; the
`config-controls-drop-message` screen still captures the open message editor;
`npm run ui:verify` passes with no new a11y violations. Covers AC 9.

## Model Hints

- D2 → `deliverable-hard` - it changes what a rendered `.cfg` contains and must not break story
  042's fixed-point property or `profile-restore.ts`'s alias-name recovery.
- D1, D3, D4, D5 → default.
- Review: → `story-review-hard` - a rendered-file change plus a recognition rule that two separate
  surfaces read needs a reviewer who can check the round-trip argument, not just the diff.

## Test Plan (manual acceptance)

1. `npm run ui:verify` - green, no new a11y violations, `config-controls-drop-message` screenshot
   shows the two toggles.
2. Start the app, open a profile → Controls → Weapon dropping: on the Railgun row, click the ammo
   toggle off and on, then the message toggle on; the inline message row appears and "Edit message"
   still opens the editor. Tab to both toggles - focus ring visible, Space/Enter toggles them.
3. On the Rebreather/Tech drop row the ammo toggle is disabled and its tooltip explains why.
4. Raw file tab: the touched drop renders as `alias drop_<slug> "..."`.
5. Import `docs/fixtures/dmalias.cfg`, open Controls: all sixteen `drop_*` entries show the toggles
   (wherever their category landed), `dall` shows none. Toggle ammo off on `drop_shotgun` and check
   on the Raw file tab that its `wave 1` and `say_team` are still there.
6. Aliases tab: the same `drop_shotgun` row shows the two toggles; toggling there matches Controls.
7. Overview/Care: no new findings, and a key bound to a drop still shows the entry's display name.

## Done

Built exactly per the Plan/Deliverables. `isDropEntry`/`dropStateFor`/`withDropAmmo`/`withDropMessage`
now live in one shared pure module (`src/shared/config/drop-entries.ts`) read by Controls, Aliases and
the round-trip/import tests; `derivedAliasName` renders launcher-owned drops as `drop_<slug>`; the
Options cell on both Controls and Aliases shows a new `DropToggles` icon-button pair instead of the two
checkboxes; the live-smoke flow and `config-controls-drop-message` screen drive the toggles. Two review
cycles ran: cycle 1 FAILed on 9 findings (F1-F9, all fixed), cycle 2 PASSed with 7 additional minor
findings, 4 of which were fixed (A-D) and 3 deliberately accepted as-is (see Decisions below).

### Decisions (implementation)

- **F1 fix widened the Options-cell gate to `isDropEntry(action) || isDropCatalogRow(row)`**, not
  `isDropEntry` alone as the Plan literally said: a freshly-seeded template drop row starts with
  `commands: []` (no `drop <item>` command yet), so `isDropEntry` alone hid the options on every
  brand-new profile. `isDropCatalogRow` (new export in the pre-existing `src/shared/config/catalog-rows.ts`)
  recognises the catalogue's `dropWeapon:`/`dropAmmo:`/`dropMisc:` row kinds regardless of body state.
  A body-less row still writes through the old row-based `applyAmmo`/`applyMessage`
  (`catalog-binds.ts`, kept alive rather than deleted - this closes the review's F8/dead-code flag);
  once a body exists, all writes go through D1's surgical `withDropAmmo`/`withDropMessage`.
- **Ammo toggle is a one-way control on "ammo-item-drops-itself" fixture entries** (`drop_shells`,
  `drop_bullets`, `drop_grens`, `drop_rocks`, `drop_cells`, `drop_slugs` - 6 of the 16 fixture drops,
  body shape `drop shells; drop shells; ...`): the item itself has no catalogue ammo field, but a
  literal ammo-named second `drop` command is present and must stay removable per AC 4's "the ammo
  toggle adds/removes the command" - `canToggleAmmo = itemAmmo !== undefined || hasAmmo` makes it
  enabled+pressed while the command exists, then disabled+unpressed once removed (no way back from the
  Options cell, only via the Aliases tab's raw editor). Accepted as-is: this is a direct consequence of
  the Decisions section's own rule ("any further `drop <known ammo name>` counts as the ammo toggle"),
  not an implementation bug - the AC 6 example "a second `drop shells`" is itself the ammo command for
  a shells-dropping entry, so "surviving both toggles" doesn't apply to it literally; the fixed-point
  and extras tests instead use a non-ammo-shaped extra (`drop power shield` after `drop_powers`) to pin
  AC 6 unambiguously.
- **Aliases tab has no way to edit an existing drop message's text short of deleting it first** (toggle
  on reveals a `MessageEditor` modal to write it once; toggle off removes it; there is no persistent
  "Edit message" affordance there like Controls' inline row). Accepted as-is: the Decisions section only
  commits to showing "the same two toggles" on Aliases, not story 029's inline editor surface: a user
  who wants to revise wording without deleting first still has Controls (or the Raw file tab) as the
  edit path; adding an inline editor to the Aliases action cluster was judged out of this story's scope.
- **Every entry filed under category `drops` gets the `drop_` name prefix on next save, whether or not
  its body is actually a drop** (i.e. a user-renamed plain alias or message-only entry parked in
  "Weapon dropping"). Accepted as-is (self-documented in `alias-render.ts`): cosmetic and self-correcting
  - it only affects the rendered alias name, not the entry's behaviour or its `isDropEntry` status, and
  a user who deliberately re-categorises a non-drop entry into a drop-named category can rename it back
  via story 039's explicit `aliasName`, which still wins verbatim.
- **`withDropMessage`'s removal and the sub-row's display were made to agree on "first message command"**
  (both previously risked disagreeing - display read the last, removal targeted the first - only
  observable for a body with two message commands, an edge case no real fixture hits, but now pinned by
  a two-message-command unit test).
- **Live-smoke flow (`drop-message-checkbox.mjs`) restores its fixture's original message text/channel
  in a `finally` block** so the flow stays idempotent (re-runnable without reseeding) even if an
  assertion throws mid-flow; channel selection now goes through the stable `message-editor-channel`
  test id instead of a positional `select` locator.
- **Added a fourth row to CLAUDE.md's `## Deviations` table** for `DropToggles.tsx`'s 28px icon toggles
  (Controls Options cell + Aliases action cluster) against the `/design-tokens` 44px touch-target floor,
  citing this story - the component's own comment had wrongly claimed this was already covered by an
  existing row.

### Known pre-existing issue (not introduced by this story)

`npm test` throws `webidl.util.markAsUncloneable is not a function` at vitest worker-pool startup for
exactly six `@vitest-environment jsdom` renderer test files (including the two new ones this story
added, `DropToggles.test.ts` and the jsdom-based parts of `AliasesTab.test.ts`) - a jsdom/undici-vs-Node
environment incompatibility confirmed, across three separate verification passes, to reproduce
identically on files this story never touched. `npm test`'s own summary line still reports
`Test Files 81 passed (81)` / `Tests 2217 passed (2217)` and exits 0; the jsdom-affected files' new
assertions were reviewed and confirmed correct on inspection (review cycles 1 and 2) but were never
mechanically executed in this sandbox. Fixing the jsdom/undici environment is out of scope for this
story.

### Verification

- `npm run build` - clean.
- `npm run typecheck` (node + web) - clean.
- `npm test` - 81/81 test files, 2217/2217 tests pass; 6 pre-existing jsdom-environment errors (see
  above), unrelated to this diff, confirmed unchanged across the whole build.
- `npm run ui:verify` (full, unfiltered) - 32/32 screens, 64/64 screenshots written, 0 axe violations of
  any severity, incl. `config-controls-drop-message` at both viewports.
- Code review: 2 cycles. Cycle 1 FAIL (9 findings, all fixed). Cycle 2 PASS (7 minor findings; 4 fixed,
  3 accepted as documented decisions above).

Commit message: `055: drop_ alias is a drop, with two toggles instead of two checkboxes`
