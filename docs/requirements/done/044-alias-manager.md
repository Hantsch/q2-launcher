---
id: 044
title: One surface to manage every alias in a profile
status: done # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

Aliases are the backbone of a real Quake II config. My own `dmalias.cfg` is roughly ninety of them,
and they are structured deliberately: status messages (`s_ok`, `s_neg`, `s_support`), weapon
switches that each call a per-weapon settings hook (`blaster` -> `blaster_settings`), drop
commands that also announce themselves in team chat, helper chains (`wait5`, `wait20`, `wait50`),
and a `dall` that calls a dozen drops in one go.

The launcher has no place to see that. An alias is a row inside a category on the Controls tab,
next to binds and messages, and the things that actually matter about an alias are the things that
view cannot show:

- **What is the name space?** Which names are taken - by my entries, by generated entry aliases, by
  the launcher's own layer aliases (`+alt`/`-alt`). Uniqueness is a hard rule after story 039, so
  the user needs to see it.
- **Who calls this?** An alias exists to be referenced. `blaster_settings` is called from
  `blaster`; `wait5` from `wait20`; `ssg_sg` from `bind q`. Without that, deleting one is a guess.
- **What does nothing call?** Care warns about it, but the fix belongs where the aliases live.
- **How long is it?** An alias body has a hard engine line budget (`alias-render.ts` splits into
  `_p1`/`_p2` chunks when it overflows) and a user writing a `dall`-sized chain needs to see that
  before it silently becomes three lines.

## Acceptance Criteria

- [x] One surface lists every alias name that exists in the profile in one table: user-authored
      `kind: 'alias'` entries, the aliases generated for keyed entries, and the layer aliases the
      launcher emits - each labelled with which of the three it is.
- [x] Generated and layer aliases are shown read-only, with a link to the entry or layer that owns
      them. They are in the list because they occupy names, not because they are editable here.
- [x] Each row shows: name, body (or a truncated body with the full text on demand), what
      references it, and the rendered line length against the engine budget.
- [x] References are shown per alias and are complete: base binds, layer overrides, other aliases'
      bodies, and other entries' commands. "Nothing references this" is a distinct, explicit state,
      not an empty list the user has to interpret.
- [x] Creating, renaming, editing and deleting a user alias is possible from here, including the own
      alias name from story 039.
- [x] A rename either updates every reference or refuses with the list of referencing entries -
      whichever story 039 decided. It never leaves a dangling reference.
- [x] Deleting an alias that is still referenced requires an explicit confirmation naming the
      referencing entries.
- [x] A duplicate name is flagged inline on both rows (story 039's warning), with no auto-suffixing.
- [x] Care's `unreferencedAlias` / `undefinedAlias` / `duplicateAlias` rows link here, and this
      surface and Care never disagree about what is referenced - one reference graph, one function.
- [x] Sorting/filtering at least by name and by "unreferenced only".
- [x] The surface is in `ui:verify`'s screen registry, screenshotted and axe-clean, per
      `docs/UI-VERIFICATION.md`.
- [x] `/frontend-guidelines` and `/design-tokens` hold - no image assets, tokens only, keyboard
      reachable.

## Open Questions

- ~~Where does it live?~~ answered → Decisions (Sprint)
- ~~Does Controls keep showing alias rows, or do aliases move here entirely?~~ answered →
  Decisions (Sprint)
- ~~Does this surface get its own body editor, or reuse the existing action editor drawer?~~
  answered → Decisions (Sprint)
- ~~Are read-only generated aliases shown by default or behind a toggle?~~ answered →
  Decisions (Sprint)

## Decisions (Sprint)

- **(User)** The surface lives on a new fifth tab, alongside Overview/Settings/Controls/Care.
- **(User)** The Controls tab keeps showing alias rows inside categories — story 019's "alias next
  to the binding that references it" context stays. The new tab is the comprehensive management
  view, not a replacement.
- **(User)** The surface reuses the existing action editor drawer for editing an alias body, rather
  than a new dedicated editor.
- **(User)** Read-only generated/layer aliases are shown behind a toggle, off by default — the list
  defaults to what the user actually wrote; the toggle reveals the full name space on demand.
- Tab id is `aliases`, inserted after `controls` in `ConfigView.tsx`'s tab bar — the bar already
  carries a `raw` (File) tab, so "fifth tab" is read as "a new top-level tab next to the four named
  ones", not as a literal button count.
- No new IPC channel: the tab reads the already-loaded profile draft and saves through the existing
  `updateProfileActions` — the whole name space is derivable from data the renderer already holds.
- The name space + reference graph is built by **one** new exported function in
  `src/shared/config/alias-references.ts`, and `validate-actions.ts` is refactored onto it, because
  the AC demands Care and this surface can never disagree.
- Rename keeps story 039's rule unchanged (refuse with the referrer list, never rewrite references);
  the AC explicitly defers to 039, and no reference-rewriting code exists anywhere today.
- The length indicator is byte-based against `MAX_LINE_BYTES` from `engine-limits.ts`, by exporting
  the logic behind `alias-render.ts`'s private `lineFits`, so the UI shows exactly the number that
  decides `_p1`/`_p2` splitting instead of a second, drifting count.
- Delete asks for confirmation only when the alias is referenced (AC 7); an unreferenced alias
  deletes straight away, since the confirmation exists to prevent dangling references.
- The body is shown truncated to one line with expand-in-place, mirroring `CareTidyUpSection`'s row
  expansion, rather than a tooltip — it is keyboard reachable and already an established pattern.
- `RenameActionDialog` is extracted from `ControlsTab.tsx` into `components/` and reused, rather
  than duplicated, so 039's refusal rule has exactly one implementation.
- Sort/filter/toggle state is local component state, consistent with the config module, which has
  no Zustand store of its own.

## Plan

New tab in the existing config module; no new module, no new IPC. Two shared-layer additions
(name-space index, exported line budget), then the surface on top, then the Care deep link.

1. **Shared — name space index.** `src/shared/config/alias-references.ts`: add
   `buildAliasIndex(sources)` returning one row per defined name:
   `{ name, origin: 'user' | 'generated' | 'layer', ownerActionId? , ownerLayerName?, editable,
   referrers: AliasReferrer[], duplicateOf: string[] }`. Sources = actions + binds + layers
   (`generateLayerAliases` from `alt-layers.ts` for the layer names, `aliasNameFor` from
   `alias-render.ts` for user/generated). Generalise the existing `findAliasReferrers(action, …)`
   into a by-name core so it also works for names that have no owning action; keep the old
   signature as a thin wrapper. Refactor `validate-actions.ts`'s `aliasDuplicate` /
   `aliasUnreferenced` / `undefinedAlias` checks onto the index — one graph, one function.
2. **Shared — line budget.** `src/shared/config/alias-render.ts`: export
   `aliasLineBudget(action)` → `{ bytes, max, chunks }` built from the existing private
   `lineFits`/`renderAliasLine` path and `MAX_LINE_BYTES` (`engine-limits.ts`). No behaviour change
   to rendering itself.
3. **Renderer — tab shell + table.** New `src/renderer/src/modules/config/AliasesTab.tsx`; register
   `'aliases'` in the `DetailTab` union, the tab array and the panel switch in `ConfigView.tsx`;
   i18n under `config.tabs.aliases` / `config.aliases.*` in `en.json`. Columns: name, origin badge,
   body (truncated + expand), references, length vs budget. Toggle "show generated & layer aliases",
   off by default.
4. **Renderer — states, sort, filter.** Explicit "nothing references this" state, inline duplicate
   flag on every colliding row, sort by name, filter by name text and "unreferenced only".
5. **Renderer — CRUD.** Create / edit via the existing `ActionEditor` modal; rename via the
   `RenameActionDialog` extracted out of `ControlsTab.tsx` (039's refusal rule); delete with a
   referrer-naming confirmation. All saves go through `ControlsTab`'s existing pattern
   (`updateProfileActions`), read-only rows have no edit affordance.
6. **Renderer — deep links.** Care's `unreferencedAlias` / `undefinedAlias` / `duplicateAlias` rows
   in `CareTidyUpSection.tsx` get a "show in Aliases" action; the Aliases tab's owner column links
   back to the owning entry on Controls. One small cross-tab focus mechanism in `ConfigView.tsx`
   (`{tab, focusAlias|focusActionId}`), used by both directions.
7. **Verification.** Add `config-tab-aliases` to `scripts/lib/screens.mjs`, note it in
   `docs/UI-VERIFICATION.md`, run `npm run ui:verify` (screenshot + axe clean).

## Deliverables

- [x] D1

**D1 — Shared alias name-space index (one graph for Care and the new tab)**
Files: `src/shared/config/alias-references.ts`, `alias-references.test.ts`,
`src/shared/config/validate-actions.ts`, `validate-actions.test.ts`.
Mirror: existing `findAliasReferrers` / `collectAliasReferences` in the same file.
Acceptance: `buildAliasIndex` returns every defined name once — user `kind:'alias'` entries,
generated entry aliases, layer aliases from `generateLayerAliases` — each with origin, owner,
complete referrers (base binds, layer overrides, other alias bodies, other entries' commands) and
duplicate partners. `validate-actions.ts` produces byte-identical findings to before, now derived
from the index; its existing tests stay green unchanged.

- [x] D2

**D2 — Exported alias line budget**
Files: `src/shared/config/alias-render.ts`, `alias-render.test.ts`.
Acceptance: `aliasLineBudget(action)` reports bytes, max and resulting chunk count, and agrees with
what `renderActionAlias` actually emits (a body that renders as `_p1`/`_p2` reports 2 chunks and
over-budget). No change to rendered output; round-trip tests stay green.

- [x] D3

**D3 — Aliases tab shell + read-only table**
Files: `src/renderer/src/modules/config/AliasesTab.tsx` (new), `ConfigView.tsx`,
`src/renderer/src/i18n/locales/en.json`.
Mirror: `CareTidyUpSection.tsx` (row list + expand), `ControlsGrid.tsx` (row layout).
Acceptance: a sixth tab button `config-tab-aliases` shows a table of the profile's user aliases with
name, origin label, truncated body (expandable in place), referrer list and length-vs-budget; a
toggle, off by default, additionally lists generated and layer aliases as read-only rows with their
owner named. Tokens only, no image assets, every row control keyboard reachable.

- [x] D4

**D4 — Empty/duplicate states, sort and filter**
Files: `src/renderer/src/modules/config/AliasesTab.tsx`, `en.json`,
`src/renderer/src/modules/config/lib/alias-rows.ts` (new, pure row shaping + tests).
Acceptance: "Nothing references this" renders as its own labelled state, not an empty cell; both
rows of a duplicate pair carry an inline duplicate flag (no auto-suffix); the list sorts by name and
filters by name text and by "unreferenced only", including in combination.

- [x] D5

**D5 — Create / edit / rename / delete a user alias**
Files: `src/renderer/src/modules/config/AliasesTab.tsx`, `ControlsTab.tsx`,
`src/renderer/src/modules/config/components/RenameActionDialog.tsx` (extracted), `en.json`.
Mirror: `ControlsTab.tsx`'s `handleSaveAction` / delete flow and `components/ActionEditor.tsx`.
Acceptance: a new alias can be created, its body edited in the existing `ActionEditor`, its display
name and own alias name changed in the extracted rename dialog — which still refuses a rename whose
current name is referenced, naming the referrers (039). Deleting a referenced alias requires a
confirmation naming the referring entries; unreferenced deletes directly. Controls tab behaviour is
unchanged after the extraction.

- [x] D6

**D6 — Cross-tab deep links (Care → Aliases, Aliases → Controls)**
Files: `ConfigView.tsx`, `CareTidyUpSection.tsx`, `AliasesTab.tsx`, `en.json`.
Acceptance: the three alias findings in Care offer an action that opens the Aliases tab with that
name focused/scrolled into view; a generated or layer alias row links to its owning entry on
Controls (layer aliases name their layer). Focus lands on the target row, not the tab button.

- [x] D7

**D7 — UI verification**
Files: `scripts/lib/screens.mjs`, `docs/UI-VERIFICATION.md`.
Acceptance: `config-tab-aliases` is in the screen registry and `npm run ui:verify` screenshots it
with no axe violations.

## Model Hints

- `D1 → deliverable-hard` — it rewrites the alias reference graph *and* re-points
  `validate-actions.ts` at it; a missed reference source (layer overrides, secondary binds,
  self-mirroring aliases) silently turns a referenced alias into "unreferenced" and lets Care
  offer a destructive tidy-up. This is the `alias-references.ts` area where 039 needed four review
  rounds and 042 eight.
- `D2 → deliverable-hard` — the budget number must match `renderActionAlias`'s own chunking
  decision exactly; exporting the private `lineFits` path risks drifting from, or subtly changing,
  the `_p1`/`_p2` split that 042's round-trip property depends on.
- D3, D4, D5, D6, D7 → default tier (renderer composition over existing patterns; D5 is an
  extract-and-reuse of code that already exists).
- `Review: → story-review-hard` — the diff spans the shared reference graph plus a render-budget
  export, the exact path the sprint notes flag for adversarial re-checking; a default reviewer
  reading only the diff will not catch a dropped reference source.

## Test Plan (manual acceptance)

Profile with: two user aliases where A's body calls B, one alias nobody calls, two entries whose
resolved alias names collide, one keyed entry (generated alias), one alt layer.

1. Open a profile → **Aliases** tab. Only the user-authored aliases are listed; each shows body,
   references and a length indicator.
2. Row for B shows A as a referrer; the unreferenced alias shows an explicit "nothing references
   this" state. Both colliding rows show the duplicate flag.
3. Turn on "show generated & layer aliases" → the keyed entry's alias and the layer's `+alt`/`-alt`
   names appear, read-only, with their owner named; the owner link jumps to Controls.
4. Filter "unreferenced only" → only the unreferenced alias remains; type a name fragment → the
   list narrows; sort by name toggles order.
5. Create an alias, edit its body in the editor drawer, save → it appears on Controls too.
6. Rename A while B still calls its name → the dialog refuses and names B. Set an own alias name
   instead → the rename goes through.
7. Delete B → confirmation names A. Cancel, then delete the unreferenced alias → no confirmation.
8. Care tab → an alias finding's "show in Aliases" action opens the tab with that row focused.
9. Paste a `dall`-sized body (a dozen commands) → the length indicator shows over-budget / 2 chunks
   before saving; after save the rendered file contains `_p1`/`_p2`.
10. `npm run ui:verify` → `config-tab-aliases` screenshot present, axe report clean.

## Done

A new fifth "Aliases" tab (`config-tab-aliases`, inserted after Controls) gives one surface over
every alias name in a profile — user-authored, generated, and layer aliases — built on one shared
name-space/reference-graph function (`buildAliasIndex`) that `validate-actions.ts` now consumes too,
so Care and the tab can never disagree about what references what. The tab supports sort/filter,
explicit empty/duplicate states, full CRUD on user aliases (create/edit via the existing
`ActionEditor`, rename via an extracted `RenameActionDialog` that keeps story 039's refusal rule,
delete with referrer-naming confirmation), and two-way deep links with Care and Controls/Overview.

**Deliverables:** D1 shared alias index (`alias-references.ts`), D2 exported line budget
(`alias-render.ts`), D3 tab shell + read-only table, D4 empty/duplicate states + sort/filter
(`lib/alias-rows.ts`), D5 create/edit/rename/delete, D6 cross-tab deep links, D7 `ui:verify`
registration. All seven landed; see `docs/sprints/S09/progress.md` for the timestamped trail.

**Commit message:**
`044: Aliases tab — one surface for the alias name space, backed by one reference graph`

**Verification:**
- `npm run typecheck` — clean.
- `npm run build` — clean.
- `npm test` — 1764/1765 passing; the one failure
  (`src/main/modules/config/core/import-reader.test.ts`, a 512-file fan-out timing test hitting its
  5000ms timeout under load) is untouched by this story's diff (confirmed absent from `git diff`/
  `git status`) and was independently reproduced as a pre-existing, machine-timing flake by two
  implementation agents — not a regression.
- `npm run ui:verify` — 54/54 shots written, 0 axe violations, 27/27 screens, including
  `config-aliases@1280x800` and `@940x620` both `shot:written — axe:audited (clean)`. This run only
  went green after the orchestrating session root-caused and fixed a genuinely unbounded (not just
  slow) fixture-cleanup lock in `scripts/lib/fixture.mjs` (`rmDirBestEffort`, best-effort cache
  cleanup) outside this story's deliverables — see Decisions below.
- Story review: `story-review-hard`, round 1 — verdict **PASS** with 5 findings. 3 were fixed
  (see Decisions); 2 were deliberately left as documented, non-blocking gaps.

**Decisions (implementation):**
- Rows in the shared index are one per *definition*, not per name — a name collision (e.g. a user
  alias vs. a layer alias) produces two rows that list each other in `duplicateOf`, which is what
  lets both AC 8 (duplicate flagged on both rows) and `validate-actions.ts`'s existing
  entry-vs-entry duplicate finding coexist without merging distinct kinds of collisions.
- A layer's own trigger bind and its `_pN`/`_cN` chunk-alias family are deliberately not modelled as
  referrers of themselves (documented in `alias-references.ts`), so a layer-origin row can show
  "nothing references this" even though the layer emits it. Left as-is: this is presentation-only
  (layer rows are read-only, no destructive action is attached) and Care never produces an
  `unreferencedAlias` finding for layer-origin names in the first place (`validate-actions.ts` only
  iterates `kind: 'alias'` entries), so the two surfaces still never disagree about anything
  actionable. Flagged by review as finding 3.
- Review finding 1 (a layer alias's owner link could silently focus nothing when no Controls row
  happened to reference that layer's modifier) was fixed by routing the link to Overview's
  `LayersPanel` instead — the layer's actual owning surface — via the existing
  `activeLayerId`/`onSelectLayer` mechanism, rather than keeping the best-effort Controls-row scan.
- Review finding 2 (no over-budget indicator for a single command too long to fit on any line, where
  `aliasLineBudget` reports `chunks: 1` by design) was fixed by also triggering the UI's warning
  state on `bytes > max`, not only on `chunks > 1`.
- Review finding 4 (Care's `undefinedAlias` deep link landed on the Aliases tab with no feedback,
  since an undefined name by definition has no row to focus) was fixed by pre-seeding the tab's text
  filter with the searched-for name so the existing "no matching aliases" state explains the result.
- Review finding 5 (`scripts/lib/fixture.mjs`'s best-effort fixture cleanup) is **not** part of this
  story — it was made directly by the orchestrating session, outside any of D1–D7, to unblock the
  `ui:verify` environment (a fixture-cache lock that turned out to be unbounded rather than
  time-boxed). Noted here for traceability only; not evaluated or altered as part of story 044.
- `MAX_LINE_BYTES` reused directly from `alt-layers.ts` (the same constant `lineFits` itself uses)
  rather than `engine-limits.ts`'s `CBUF_LINE_BYTES`, to guarantee the UI number can never drift from
  the splitter's own constant.
- The screen-registry id is `config-aliases` (matching this repo's existing `config-<tab>` naming
  convention in `scripts/lib/screens.mjs`), reusing the `config-tab-aliases` testid the AC names.

**Open points:** none blocking. The two documented-and-left findings (3 and 5) are non-destructive
and outside this story's scope respectively.
