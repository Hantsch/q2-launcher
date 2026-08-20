---
id: 019
title: Controls — type the entry, not the category, and let me order entries
status: done # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

Today a category carries the type (`ConfigActionCategory.entryKind`), so a category is either
binds *or* messages *or* aliases. That is the wrong axis: a category is just a drawer I named,
and what is typed is the individual entry.

An entry is one of three kinds:

- **binding** — I give it a name and say what happens; what happens is either a **command** or a
  **message**. It is assignable to a key like every other entry.
- **message** — a named chat message (say / say_team); also assignable to a key.
- **alias** — defines a command or wraps several commands. An alias is **not** bindable; it exists
  to be referenced by bindings.

Because an alias has to be *defined before it is used*, I need to control the order of entries
inside a category, e.g.:

```
| + test  {command}
| - test  {command}
| Test binding (+test)   [ empty ]
```

This story is the data model and the mechanics; the visual redesign of the tab is story 020.

## Acceptance Criteria

- [x] `entryKind` is gone from categories (built-in and custom); creating/renaming a category no
      longer asks for a type.
- [x] Every entry carries its own kind (`bind` | `message` | `alias`) chosen when it is created,
      and shows it as a badge in the list.
- [x] A binding entry's payload is either a command or a message, editable in place; a message
      entry edits its channel + text; an alias entry edits one or more commands.
- [x] An alias entry has no key slot at all, and binding a key to an alias entry is impossible
      through the UI rather than merely discouraged.
- [x] A binding can reference an alias by name (e.g. `+test`), with the profile's own aliases
      offered while typing.
- [x] Entries inside a category can be reordered by hand, the order persists, and the rendered
      config emits them in that order — an alias always before the binding that uses it.
- [x] Existing profiles keep working: an entry's kind is derived from its old category's
      `entryKind` on load, no profile is dropped or reset, and no saved profile has to be
      re-created by hand.
- [x] A binding that references an undefined alias, and an alias never referenced by anything,
      are both reported (Care tab, story 025) rather than written out silently broken.

## Open Questions

- ~~**binding vs. message overlap:** a binding whose payload is a message and a keyed message
  entry are the same thing to the engine. Keep both kinds (message = a binding preset for chat)
  or collapse "message" into a binding's payload type and drop the third kind?~~ answered →
  Decisions (Sprint)
- ~~Persisted-schema change: derive the entry kind on read (forgiving, no version bump) or
  migrate once in `state.json` with a `STATE_SCHEMA_VERSION` bump?~~ answered → Decisions
  (Sprint)
- ~~Ordering: an explicit `order` number per entry, or array position as the order (and then the
  IPC contract must guarantee order preservation)?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Keep all three entry kinds (binding, message, alias) — a named chat message stays
  its own kind, distinct from a binding whose payload happens to be a message.
- **(User)** Derive entry kind on read from the old category's `entryKind`, no
  `STATE_SCHEMA_VERSION` bump — forgiving migration, matches the "no profile is dropped or
  reset" acceptance criterion.
- **(User)** Order = array position, not an explicit `order` field. The IPC contract must
  preserve array order round-trip.
- Alias entries emit `alias <own name>` (validated engine token, no `q2l_a_` prefix) — a binding
  can only reference an alias by name if that name is what lands in the file.
- Alias-name rules and duplicate detection reuse `slugAliasName`/`MAX_ALIAS_NAME` from
  `src/shared/config/alt-layers.ts` — engine limits stay central (S04 watch-out), never re-derived.
- Alias entries never contribute to `binds` nor to any layer's `overrides` — both are derived
  mirrors, so the exclusion belongs at the single derive site, not to a hidden key slot in the UI.
- `kind` is derived at *profile* level in the persisted schema (`src/main/lib/schemas.ts`), not
  per row — the derive needs the profile's `categories`, which a row-level schema cannot see.
- The persisted category schema keeps *accepting* and then dropping a legacy `entryKind` —
  reading an old `state.json` must not drop a category row over a field the type no longer has.
- The strict IPC schema requires `kind` on every action and rejects a missing/unknown value —
  renderer payloads are never trusted, and a default there would silently mistype an entry.
- No new IPC channel or handler: the contract change is the payload types in
  `src/shared/modules/config.ts`, carried by the existing `setActions` — contract-first, and
  order preservation is proven by a round-trip test on `setActions` → `list`.
- Order = relative position inside the one flat `actions` array; a reorder swaps with the nearest
  neighbour *of the same category* — keeps the persisted shape and the emission order
  `renderActionAliasLines` already follows.
- Reorder is up/down buttons mirroring `ActionEditor.moveCommand`, not drag & drop — keyboard
  accessible, and story 020 owns the visual rebuild anyway.
- Built-in categories lose `entryKind`; catalogue-materialised entries are created with
  `kind: 'bind'` — the catalogue only ever produced binds.
- `message` stays its own kind, but its payload reuses the existing `ConfigCommand`
  `{ kind: 'message', channel, text }` shape — one command union keeps the writer one code path.
- AC 8's findings go into the existing `Finding` / `ValidationPanel` pipeline (new
  `src/shared/config/validate-actions.ts`), not a new surface — story 025 renames that very
  surface to Care, so a second one would be built to be thrown away.

## Plan

Data model first, then the surface, then emission/validation. No new IPC channel — the payload
types on the existing `setActions` change.

1. **Contract** (`src/shared/modules/config.ts`): `ActionEntryKind = 'bind'|'message'|'alias'`,
   required `ConfigAction.kind`; `entryKind` removed from `ConfigActionCategory` and
   `BuiltInActionCategory`. Strict IPC schema (`src/main/modules/config/schemas.ts`) requires
   `kind`; persisted schema (`src/main/lib/schemas.ts`) derives a missing `kind` from the row's
   category (legacy `entryKind`, built-in → `bind`, fallback `bind`) in a profile-level
   transform. No `STATE_SCHEMA_VERSION` bump.
2. **Emission** (`src/shared/config/alias-render.ts`): a `kind: 'alias'` entry renders
   `alias <slugged own name> "<body>"` instead of a `q2l_a_*` name, so a binding can call it.
   Array order stays the emission order (already true) — nothing sorts.
3. **Mirrors** (`src/main/modules/config/profiles.ts`, `src/shared/config/modifier-layers.ts`):
   alias entries are skipped in the `binds` mirror and in `applyActionLayerMirror`. Row identity
   stays `action.id`; overrides remain a pure derivation.
4. **Order**: a pure `moveEntryWithinCategory` helper in
   `src/renderer/src/modules/config/lib/entry-order.ts`, plus round-trip order tests on
   `setActions`/`list` and on the persisted read.
5. **Surface** (`src/renderer/src/modules/config/AdvancedTab.tsx` + `components/`): category
   create/rename lose the type select; entry creation asks for the kind; every row shows a kind
   `Badge` and up/down reorder buttons; the edit dialog is dispatched by `action.kind` — binding
   (command *or* message payload), message (channel + text), alias (commands, **no key slot at
   all**). Alias-name suggestions come from the profile's own alias entries.
6. **Validation** (`src/shared/config/validate-actions.ts` → `lib/validation-scope.ts`):
   undefined alias reference, never-referenced alias, duplicate alias name → `Finding`s in the
   existing Validation panel (story 025 later renames it to Care).

Visual redesign of the tab is story 020 — this story keeps the current look.

## Deliverables

- [x] **D1 — `kind` moves onto the entry, `entryKind` leaves the category.**
      `src/shared/modules/config.ts` (add `ActionEntryKind`, `ConfigAction.kind`, drop
      `entryKind` from both category types), `src/main/modules/config/schemas.ts` (+ its test),
      `src/main/lib/schemas.ts` (+ its test: profile-level derive of a missing `kind` from the
      legacy category `entryKind`, legacy field accepted-then-dropped), plus the mechanical
      compile fixes at the entry construction sites only
      (`src/renderer/src/modules/config/AdvancedTab.tsx`,
      `src/renderer/src/modules/config/lib/catalog-binds.ts` → `kind: 'bind'`).
      *Acceptance:* `npm run typecheck` + `npm test` green; a fixture `state.json` whose
      categories carry `entryKind: 'message' | 'alias'` loads with every entry's `kind` derived,
      no row and no profile dropped; a `setActions` payload without `kind` is rejected.
      *No UI change yet.*

- [x] **D2 — Alias entries render as their own alias and are never bound.**
      `src/shared/config/alias-render.ts` (+ `alias-render.test.ts`): `kind: 'alias'` →
      `alias <slugAliasName(name)>`, no `q2l_a_` prefix, chunking/limits unchanged;
      `src/shared/config/modifier-layers.ts` (+ test) and
      `src/main/modules/config/profiles.ts` (+ `profiles.test.ts`): alias entries contribute
      neither a `binds` entry nor a layer override.
      *Acceptance:* rendering a profile with an alias entry `+test` and a binding whose command
      is `+test` emits `alias +test …` before the binding's alias line and no `bind` for the
      alias entry; a stale `q2l_a_*` bind for an entry turned into an alias is gone; hand-made
      binds/overrides untouched.

- [x] **D3 — Order is array position, provably.**
      New `src/renderer/src/modules/config/lib/entry-order.ts` (+ test):
      `moveEntryWithinCategory(actions, id, direction)` swapping with the nearest same-category
      neighbour inside the flat array. Order round-trip tests in
      `src/main/modules/config/profiles.test.ts`, `src/main/modules/config/index.test.ts` and
      `src/main/lib/schemas.test.ts`.
      *Acceptance:* the array order sent through `setActions` comes back identically from `list`
      and survives a persisted read; the helper never moves an entry past a foreign category.

- [x] **D4 — Controls: kind per entry, no type per category.**
      `src/renderer/src/modules/config/AdvancedTab.tsx`,
      `src/renderer/src/i18n/locales/en.json`: `CreateCategoryDialog` loses the type select,
      `CreateActionDialog` gains a kind choice (bind/message/alias), category chips lose the
      entryKind badge, each entry row shows its own kind `Badge`
      (`src/renderer/src/components/ui/primitives.tsx` `Badge`, mirroring today's
      `ENTRY_KIND_TONE` map).
      *Acceptance:* creating a category asks only for a name; creating an entry asks for a kind;
      the row badge shows that kind; a mixed-kind category renders correctly.

- [x] **D5 — Kind-aware entry editor.**
      `src/renderer/src/modules/config/components/ActionEditor.tsx`,
      `components/MessageEditor.tsx`, dispatch in `AdvancedTab.tsx`, `en.json`: dispatch by
      `action.kind`; a binding switches its payload between command and message in place; a
      message edits channel + text; an alias edits its commands and has **no key slot and no
      capture control at all**.
      *Acceptance:* an alias entry offers no way to reach key capture through the UI; switching
      a binding's payload to a message keeps the entry's key; a message entry still keys.

- [x] **D6 — A binding can call an alias by name, with suggestions.**
      New `src/renderer/src/modules/config/lib/alias-suggestions.ts` (+ test) listing the
      profile's alias-kind entry names; wired into `ActionEditor.tsx`'s raw-command input
      (native `datalist`, no new dependency), `en.json`.
      *Acceptance:* typing `+` in a binding's command field offers the profile's own aliases;
      picking one writes its exact name; suggestions exclude non-alias entries.

- [x] **D7 — Reorder entries by hand.**
      `src/renderer/src/modules/config/AdvancedTab.tsx`, `en.json`: up/down `IconButton`s per
      entry row (mirroring `ActionEditor.tsx`'s `moveCommand` idiom) calling D3's helper and
      saving through the existing `persistCategoriesAndActions` path; ends disabled, labelled
      for screen readers.
      *Acceptance:* moving an entry persists across a reload and the rendered preview emits the
      entries in that order.

- [x] **D8 — Broken alias wiring is reported, not written out silently.**
      New `src/shared/config/validate-actions.ts` (+ test) producing `Finding`s for: a binding
      referencing an undefined alias, an alias never referenced, a duplicate alias name; wired
      into `src/renderer/src/modules/config/lib/validation-scope.ts` (+ test) and `en.json`
      (`config.validation.actions.*`).
      *Acceptance:* each case shows up in the Validation panel with a readable message; a clean
      profile produces none of them.

## Model Hints

- `D1 → deliverable-hard` — the derive-on-read migration without a schema bump is the one place
  a mistake silently retypes or drops entries in every existing saved profile.
- `D2 → deliverable-hard` — touches the derived `binds`/`overrides` mirrors and the alias writer
  at once; a wrong skip either leaves a stale `q2l_a_*` bind behind or wipes hand-made overrides.
- D3–D8 → default tier (bounded, single-layer, each with its own test or visible surface).
- `Review: → story-review-hard` — a schema-derive migration plus two derived mirrors plus eight
  Ds across all three layers is exactly the diff a cheap review misreads.

## Coverage (AC → D)

- AC 1 (`entryKind` gone from categories) → D1, D4
- AC 2 (kind per entry + badge) → D1, D4
- AC 3 (payload per kind, editable in place) → D5
- AC 4 (alias has no key slot at all) → D5 (UI), D2 (engine side: never bound)
- AC 5 (binding references an alias, suggestions) → D6, D2 (the alias name is emitted)
- AC 6 (reorder, persists, emitted in that order) → D3, D7, D2
- AC 7 (existing profiles keep working, kind derived) → D1
- AC 8 (undefined / unreferenced alias reported) → D8

## Test Plan (manual acceptance)

Live smoke through the real UI (`npm run dev`), on a profile that already has entries:

1. Config → Controls: create a category — it asks for a name only, no type.
2. In it, create three entries: `+test` (alias), `-test` (alias), `Test binding` (binding).
3. Open `Test binding`, type `+t` in the command field → the two aliases are suggested; pick
   `+test`, save.
4. Open `+test` → there is no key slot and no capture button anywhere in the dialog.
5. Reorder so both aliases sit above `Test binding`; switch tabs and back — the order held.
6. Raw/Preview: `alias +test …` and `alias -test …` appear before `Test binding`'s alias line,
   and no `bind` line exists for either alias entry.
7. Delete `+test` → the Validation panel reports the undefined alias reference and `-test` as
   never referenced.
8. Restart the app with a pre-019 profile (a category that was `message` or `alias`): every entry
   still exists and shows the derived kind badge; nothing had to be re-created.

## Done

`ConfigAction.kind` (`bind`|`message`|`alias`) now drives the whole model instead of the
category-level `entryKind`, which is gone from both category types. The strict IPC schema
requires `kind` on every `setActions` payload; the persisted schema derives a missing `kind`
from a legacy category's `entryKind` on read, and now also strips any stale `binds`/layer
`overrides` entry that used to point at an entry that has just been retyped to `alias` — matched
by value (the alias's own would-be synthetic bind name), never by key slot, so an unrelated bind
on the same key survives. Alias entries render as `alias <own name>` (own name/sign kept, no
`q2l_a_` prefix), contribute neither a `binds` entry nor a layer override, and have no key slot
or capture control anywhere in the editor (not hidden — genuinely absent from that dispatch
branch). Order is array position; a pure `moveEntryWithinCategory` helper swaps an entry with its
nearest same-category neighbour, wired to up/down buttons that persist through the existing save
path. The Controls surface: category create/rename ask for a name only; entry creation asks for
a kind and each row shows its own kind badge; the editor dispatches by `action.kind` (binding:
command/message payload toggle in place; message: channel+text; alias: its commands only); a
binding's raw-command field offers the profile's own alias names via a native `datalist`. A new
`validateActions` reports an undefined alias reference (bind calling a name that isn't a defined
alias — narrowed to exclude known movement commands and the app's own generated hold-layer
aliases, and reported as a `warning` rather than an `error` since no full engine-command
catalogue exists to fully eliminate false positives), an alias never referenced by any action,
`profile.binds`, or a layer override, and a duplicate alias name; wired into the existing
Validation panel.

**Decisions**
- `undefinedAlias` is reported at `warning`, not `error`: without a full engine-command
  catalogue, a bare `+`/`-` token in a hand-typed command can't be told apart from an ordinary
  built-in engine command with full certainty. The check still fires (AC 8's "reported, not
  silently broken") but doesn't assert a confidence the codebase can't back up. Known movement
  commands (`action-catalog.ts`) and the app's own generated hold-layer aliases (`alt-layers.ts`)
  are excluded outright, closing the two concrete false-positive classes found in review.
- Alias entries can still end up carrying stale key data through a pre-019 migration or an
  in-memory edit; two independent lines of defense: the persisted-read normalize step strips a
  stale bind/override for a freshly-derived alias (value-matched), and both key-collision
  detectors (`bind-collision.ts`, `bind-slot-collision.ts`) skip `kind === 'alias'` actions
  outright so a leftover value never surfaces as a collision owner.
- Order = array position (Decisions (Sprint)); the reorder helper swaps with the nearest
  same-category neighbour by array index, which can jump over an interleaved foreign-category
  row rather than becoming strictly adjacent to it — matches the story's own wording exactly and
  is harmless, since alias resolution happens at call time in the engine, not by proximity.
- Deliberately left as-is from review (cosmetic, no behavior impact): `PersistedConfigProfile`
  exported from `src/main/lib/schemas.ts` is unused outside that file (documents the parse
  guarantee); `config.advanced.createDialog.entryKindLabel` is reused by the action-creation
  dialog instead of a dedicated `actions.createDialog.*` key (content fits, avoids a duplicate
  string); the D3 `index.test.ts` order round-trip test's `rm(..., { maxRetries, retryDelay })`
  is an unrelated Windows `ENOTEMPTY` flake fix picked up along the way, kept and commented in
  place.

**Commit message**

019: type the entry, not the category, and let users order entries

**Verification:** `npm run build`, `npm test` (37 files / 640 tests), `npm run typecheck` all
green. Clean-agent review (story-review-hard) ran two fix cycles: cycle 1 fixed a missed
binds/overrides reconciliation on migration, a false-positive `undefinedAlias` on ordinary
commands, an unreferenced-alias check that ignored `profile.binds`/layer overrides, collision
detectors not filtering alias-kind actions, and an incomplete key-field clear in `ActionEditor`;
cycle 2 fixed a regression from cycle 1 (the stale-bind strip matched by key/slot instead of
value, which risked deleting an unrelated legitimate bind on the same key) and narrowed the
remaining `undefinedAlias` false positives (hold-layer aliases + severity downgrade, see
Decisions). A third review pass found both fixes correct with no further findings. Live smoke:
a temporary `ui:flow` script (deleted after use, same idiom as story 018) drove the real
Electron app against the `Plain Profile` fixture — created a category with no type field,
created an alias and a binding entry, confirmed each row's own kind badge, confirmed the alias
editor renders no key label and no capture button anywhere, reordered the two entries and
confirmed the row order changed and persisted, and confirmed the Validation panel surfaces the
"alias not called by anything" warning with a readable message. `npm run ui:verify`'s overall
exit code is 1 only because of the pre-existing, unrelated `config-raw` crash noted in the S04
sprint context (not covered by the manual smoke for the same reason) — `config-advanced` and
`config-validation` themselves screenshot clean at both viewports.
