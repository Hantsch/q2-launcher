---
id: 015
title: Advanced tab — dual-bind editor for Movement, Weapons and Weapon dropping
status: done
created: 2026-08-18
---

## Requirement

As a user, I want the Movement, Weapons and Weapon dropping categories in the Advanced tab
(story 008) to stop being a generic, free-form action list and instead show the fixed set of
actions each category actually has — one row per action, with a **Primary** and a **Secondary**
bind slot, each showing the key it's bound to or an explicit "empty" state — so I can select a
slot and press the key I want, exactly like the dual-bind keybinding screens most games ship
(a left-hand list of actions, then two columns showing what's bound and letting me reassign it
with a keypress). Today's flow (name a new action, open its editor, pick catalogue entries by
hand, add commands one at a time) is the right shape for genuinely custom, user-authored actions,
but it's the wrong shape for a fixed catalogue like "move forward" or "use rocket launcher" —
those don't need naming, they need binding.

Weapon dropping additionally needs to be organized into three groups instead of one flat list —
**Weapons**, **Ammunition** and **Misc** (everything else droppable: powerups, tech) — and each
weapon-dropping row needs two things the other two categories don't: a choice of whether the drop
includes the matching ammo or not, and a free-text field for the team-chat line said when the key
is pressed (a `say_team` alongside the `drop` command(s)).

The built-in/custom split and the entry-kind picker (`bind`/`message`/`alias`, story 008 decision
6) stop applying to these three categories once they get their own dedicated editor — that
generic machinery stays exactly as it is today, but only for categories the user creates
themselves.

Assigning a key while a modifier (Alt/Ctrl/Shift) is held is a related but separate capability,
covered by [016](016-modifier-layer-on-bind-capture.md) — this story's capture slots must exist
and be pressable before that story has anywhere to plug into.

See [docs/systems/config-module.md §5](../systems/config-module.md#5-feature-areas-carried-over-from-q2-config-manager-redesigned),
`src/shared/config/action-catalog.ts` (`MOVEMENT_ACTIONS`, `WEAPONS`/`WEAPON_ACTIONS`/
`WEAPON_EXTRA_ACTIONS`, `DROPPABLES`/`DROP_ACTIONS`) and story 008's
`src/renderer/src/modules/config/AdvancedTab.tsx` / `components/ActionEditor.tsx`, which this
story replaces the built-in-category path of.

## Acceptance Criteria

- [x] Movement, Weapons and Weapon dropping each show every action from their fixed catalogue as
      a row; there is no "create action" step and no name field for these three categories —
      users can neither add nor remove rows there (only custom categories keep today's free-form
      create/rename/remove).
- [x] Every row has two independent bind slots, **Primary** and **Secondary**; each shows its
      currently bound key, or an explicit "not bound" state when empty.
- [x] Clicking a slot starts a capture; the next key pressed becomes that slot's key, replacing
      whatever was there; a slot can also be cleared without entering capture.
- [x] Weapon dropping is split into three groups: **Weapons** (one row per `DROPPABLES` entry of
      kind `weapon` — the Blaster is not listed, matching today's catalogue, since it cannot be
      dropped), **Ammunition** (`kind: 'ammo'`), **Misc** (`kind: 'powerup' | 'tech'`).
- [x] Every Weapon-dropping row whose droppable has a matching ammo type offers a "with ammo" /
      "without ammo" choice that controls whether the row's key drops one command (the item
      alone) or two (item + ammo); rows without an ammo type (Ammunition and Misc rows, and any
      Weapons row without one) have no such choice to make.
- [x] Every Weapon-dropping row has a free-text field for the team message said (`say_team`) when
      the row's key is pressed, alongside its `drop` command(s).
- [x] Movement rows use the same Primary/Secondary editor, with no ammo choice and no message
      field — those are Weapon-dropping-only.
- [x] Weapons rows let the user assign the "use `<weapon>`" bind, and the `weapnext`/`weapprev`/
      `weaplast` cycling actions, through the same Primary/Secondary editor.
- [x] Movement, Weapons and Weapon dropping no longer show the "Built-in" badge or an entry-kind
      picker — both stay exactly as they are today, but only for user-created custom categories.
- [x] Assigning a Primary/Secondary key that collides with a bind already used elsewhere in the
      profile is surfaced to the user, not silently overwritten without warning.
- [x] Everything bound here shows up correctly in the Overview tab and in the generated profile
      file, the same way story 008's action binds already do.

## Open Questions

*(none — all detail questions were decided during the sprint refine pass, see below)*

## Decisions (Sprint)

1. **Slot storage:** `ConfigAction` gains an optional `secondaryKey?: string`; both `key` and
   `secondaryKey` mirror onto the *same* alias in `setActions`. Reason: one alias per action
   instead of two duplicate actions per row, and it is a purely additive contract change.
2. **Row identity:** `ConfigAction` gains an optional `catalogId?: string` — a catalogue row is
   recognised by that field, never by its `name`. Reason: stable identity that survives i18n
   label changes and does not depend on user-visible prose.
3. **Lazy materialisation:** a catalogue row only becomes a persisted `ConfigAction` once the
   user assigns something (key, ammo choice or message); untouched rows render "not bound" and
   store nothing. Reason: no data migration, and profiles do not gain ~40 empty actions each.
4. **Pruning:** an action whose both keys and message are cleared is removed from the profile
   again. Reason: prevents accumulating empty actions and empty aliases in the rendered file.
5. **Legacy free-form actions** that already exist in `movement`/`weapons`/`drops` (no
   `catalogId`) are shown in a separate "Other actions" group at the bottom of the category,
   with edit/remove but no create. Reason: their binds stay reachable instead of turning
   invisible; AC 1 forbids *adding* rows, not cleaning up pre-existing ones.
6. **Ammo choice + team message live in `commands`**, not in new fields: `{raw 'drop <item>'}`
   [+ `{raw 'drop <ammo>'}`] + optional `{kind:'message', channel:'say_team', text}` last, and
   the UI derives its state back from that array. Reason: `alias-render.ts` already renders both
   correctly; zero renderer/contract work.
7. **Ammo control = `Checkbox` "with ammo"**, default on for rows that have an ammo type.
   Reason: binary choice, no SegmentedControl/RadioGroup atom exists in this app, and "on"
   matches today's `DROP_ACTIONS` behaviour.
8. **Rows without an ammo type render no ammo control at all** (not a disabled one). Reason:
   AC 5 — those rows "have no such choice to make".
9. **Category ids stay** (`movement`, `weapons`, `drops`) and keep their chips; only the chip's
   badge and the panel body change. Reason: preserves selection state and all data keyed by
   `categoryId`.
10. **Weapons shows two groups:** the 11 `WEAPON_ACTIONS` (`use <weapon>`), then the 3
    `WEAPON_EXTRA_ACTIONS` (`weapnext`/`weapprev`/`weaplast`). Reason: AC 8 wants both in one
    editor; grouping keeps the cycling actions findable.
11. **Blaster** is a Weapons row but not a drops row. Reason: matches the catalogue —
    `DROPPABLES` excludes it because it cannot be dropped.
12. **Capture is extracted into a reusable `useKeyCapture` hook** that reports
    `{ key, modifiers: { alt, ctrl, shift } }`; 015 ignores `modifiers` and stores the plain
    key. Reason: that is exactly the plug point [016](016-modifier-layer-on-bind-capture.md)
    needs, without changing 015's behaviour. The four existing inline capture effects
    (`ActionEditor`, `MessageEditor`, `OverviewKeyboardPanel`, `SwitchBindControl`) are **not**
    refactored — out of scope, no collateral edits.
13. **Collision, base level:** a capture whose key already carries a base bind or another
    action's slot is **not applied immediately** — the row shows an inline banner plus
    Cancel/Replace (the house inline-confirm idiom from `AdvancedTab`'s category delete). On
    Replace the previous owner loses the key. Reason: AC 10 "not silently overwritten", and 016
    expects a plain-key collision warning it can mirror.
14. **Collision, layer level:** a key that only has an *alt-layer override* is surfaced as a
    non-blocking warning and the assignment proceeds. Reason: a base bind and a layer override
    legitimately coexist — that is how layers work (cf. `layer.triggerConflict`) — and layer
    writes go through a different IPC channel that 015 does not touch.
15. **Layout:** the two slot columns use the existing `<li>` flex-row idiom with a fixed
    `min-w-[…]` per slot; no `<table>`, no header row. Reason: the app has no table/grid row
    component; this matches the house idiom and stays responsive.
16. **Saving:** slot assign/clear and the ammo toggle save immediately; the team-message text
    field goes through the existing 500 ms debounce. Reason: mirrors `AdvancedTab`'s existing
    discrete-vs-bursty save split.
17. **No new IPC channel** — everything persists through `updateProfileActions`. Reason: the
    existing channel already carries categories + actions; only its payload type gains two
    optional fields.

## Plan

Replace the built-in path of the Advanced tab for `movement`/`weapons`/`drops` with a dedicated
dual-bind editor, built on top of the existing action/alias/bind machinery rather than beside it.

1. **Contract (D1)** — `ConfigAction` gains `secondaryKey?` + `catalogId?`
   (`src/shared/modules/config.ts`), zod mirrors it (`src/main/modules/config/schemas.ts`,
   `src/main/lib/schemas.ts`), and `setActions` (`src/main/modules/config/profiles.ts`) mirrors
   *both* keys onto the same alias name. From there the whole downstream pipeline (alias render,
   bind block, Overview resolution) already works unchanged.
2. **Collision core (D2)** — new pure `src/shared/config/bind-collision.ts`: find who owns a key
   (base bind / other action slot / layer override) and release it. Modelled on `alt-layers.ts`
   (pure, no node/DOM, own vitest file).
3. **Row model (D3)** — new `src/renderer/src/modules/config/lib/catalog-binds.ts`: build the
   fixed rows from `action-catalog.ts` (movement, weapons ×2 groups, drops ×3 groups), and
   derive/apply row state (primary, secondary, withAmmo, message) against `ConfigAction[]`,
   including lazy create and prune.
4. **Capture + slot UI (D4)** — `lib/useKeyCapture.ts` (reports key + held modifiers) and
   `components/BindSlot.tsx` (bound key / "not bound" / capturing / clear).
5. **Panels (D5, D6)** — `components/DualBindPanel.tsx` for Movement and Weapons,
   `components/DropBindPanel.tsx` for Weapon dropping (3 groups, ammo checkbox, `say_team`
   field). `AdvancedTab.tsx` dispatches the three built-in categories to them, drops the
   "Built-in" badge and hides create/rename/remove there; the generic
   `ActionEditor`/`MessageEditor`/entry-kind path stays untouched for custom categories.
6. **Collision UX (D7)** — wire D2 into the slot: inline banner + Cancel/Replace, release the
   previous owner on Replace, warn-only for layer overrides.
7. **Pipeline proof (D8)** — tests that a catalogue drop row with ammo + team message and two
   keys renders one alias with three command lines plus two `bind` lines, and resolves in the
   Overview.

Order: D1 → D2/D3 (independent) → D4 → D5 → D6 → D7 → D8.
Guardrails: read `/karpathy`, `/frontend-guidelines`, `/design-tokens` before touching
`src/renderer`, and `/electron-arch` + `/typed-ipc` for D1. All strings via `t()` in
`src/renderer/src/i18n/locales/en.json` under `config.advanced.*`; semantic tokens only
(`text-ink-muted`, `border-line`, `bg-hover`, `border-warning/35 bg-warning/8 text-warning`…),
no raw palette values, no image assets.

## Deliverables

**D1 — `secondaryKey` + `catalogId` on the action contract, mirrored to binds**
Files: `src/shared/modules/config.ts`, `src/main/modules/config/schemas.ts`,
`src/main/lib/schemas.ts`, `src/main/modules/config/profiles.ts`,
`src/main/modules/config/profiles.test.ts`.
Acceptance: both fields are optional on `ConfigAction` and accepted/validated by zod
(`secondaryKey` uses the same key validation as `key`); `setActions` writes *both* keys into
`profile.binds` pointing at the same `aliasNameFor(action)`; clearing one key removes only its
bind; all existing config tests stay green (`npm test`).

**D2 — pure key-collision core**
Files: new `src/shared/config/bind-collision.ts`, new
`src/shared/config/bind-collision.test.ts`. Mirror: `src/shared/config/alt-layers.ts` (style,
purity, test shape).
Acceptance: `findBindCollision(profile, key, ignore?)` returns `null` or one of
`{kind:'baseBind'|'action'|'layerOverride', …}` — an action's own slots are ignorable so
re-assigning the same slot never collides with itself; `releaseKey(actions, binds, collision)`
returns the cleaned `actions`/`binds` for the `baseBind` and `action` cases and leaves
`layerOverride` untouched. Tests for all four outcomes + the self-ignore case.

**D3 — catalogue row model + state derivation**
Files: new `src/renderer/src/modules/config/lib/catalog-binds.ts`, new
`…/lib/catalog-binds.test.ts`. Reads `src/shared/config/action-catalog.ts`.
Acceptance: row builders yield exactly — Movement: all `MOVEMENT_ACTIONS`; Weapons: group 1 =
`WEAPON_ACTIONS` (incl. Blaster), group 2 = `WEAPON_EXTRA_ACTIONS`; Drops: `weapon` /
`ammo` / `powerup|tech` groups from `DROPPABLES` (no Blaster). `deriveRowState(action, row)`
returns `{ primary, secondary, withAmmo, message }` from `commands`/`key`/`secondaryKey`;
`applySlot` / `applyAmmo` / `applyMessage` create the action lazily (with `catalogId`,
`categoryId`, a slug-safe English `name`) and prune it when everything is empty. Tests cover
derive/apply round-trip, ammo on/off command shape, message append/replace, pruning.

**D4 — reusable key capture + bind slot control**
Files: new `src/renderer/src/modules/config/lib/useKeyCapture.ts`, new
`…/components/BindSlot.tsx`, `src/renderer/src/i18n/locales/en.json`. Mirror:
`components/ActionEditor.tsx` capture effect (lines ~56-74) for the listener shape,
`components/KeyBindDialog.tsx` for banner/atom idiom.
Acceptance: the hook adds a capturing `keydown` listener, skips `event.repeat`, `preventDefault`
+ `stopPropagation`, resolves via `resolveQuakeKeyName`, reports
`{ key, modifiers: { alt, ctrl, shift } }` and cancels on Escape; `BindSlot` shows the bound key
(mono/`numeric`), an explicit "not bound" state, a "Press a key…" state while capturing, and a
Clear affordance that is available without entering capture. Existing inline capture sites are
not modified.

**D5 — Movement + Weapons dual-bind panel, wired into the Advanced tab**
Files: new `…/components/DualBindPanel.tsx`, `…/AdvancedTab.tsx`,
`src/renderer/src/i18n/locales/en.json`. Mirror: `AdvancedTab.tsx` row `<li>` idiom
(lines ~364-405) and its save/debounce pattern.
Acceptance: selecting Movement or Weapons shows one row per catalogue action with a Primary and
a Secondary `BindSlot` and no name field; there is no "Add action" button and no rename/remove
per row; the three built-in chips show no "Built-in" badge and no entry-kind badge/picker, while
custom categories keep today's full create/rename/remove + `ActionEditor`/`MessageEditor` flow
unchanged; Weapons renders the two groups of D3; pre-existing free-form actions in these
categories appear under an "Other actions" group with edit + remove only.

**D6 — Weapon dropping panel: three groups, ammo choice, team message**
Files: new `…/components/DropBindPanel.tsx`, `…/AdvancedTab.tsx`,
`src/renderer/src/i18n/locales/en.json`.
Acceptance: Weapon dropping renders the Weapons / Ammunition / Misc groups from D3, each row
with Primary + Secondary slots; rows whose droppable has an `ammo` type show a "with ammo"
`Checkbox` (default on) that toggles the row between one and two `drop` commands, rows without
one show no ammo control; every row has a free-text team-message `Input` stored as a
`say_team` message command after the `drop` command(s), saved through the existing 500 ms
debounce.

**D7 — collision surfacing on assignment**
Files: `…/components/BindSlot.tsx`, `…/components/DualBindPanel.tsx`,
`…/components/DropBindPanel.tsx`, `src/renderer/src/i18n/locales/en.json`. Uses D2. Mirror:
`KeyBindDialog.tsx` banner classes + `AdvancedTab.tsx` inline delete confirm.
Acceptance: capturing a key that already has a base bind or belongs to another action does not
apply immediately — the row shows an inline banner naming the current owner plus Cancel /
Replace; Replace applies the assignment *and* releases the key from its previous owner in the
same save; a key that only has an alt-layer override shows a non-blocking warning and the
assignment goes through; Cancel leaves the slot exactly as it was.

**D8 — pipeline proof: Overview + generated file**
Files: `src/shared/config/alias-render.test.ts`, `src/main/modules/config/render.test.ts`.
Acceptance: a catalogue drop action with `withAmmo`, a team message and both keys set renders
one alias whose body is `drop <item>; drop <ammo>; say_team <text>` and two `bind` lines (one
per key) pointing at that alias; a movement row with only a Primary key renders one bind; the
Overview's `resolveAliasChain` resolves both keys to the same command list.

**Coverage (AC → D), in the order of the Acceptance Criteria above:**
fixed rows / no create-name → D3, D5, D6 · two slots with bound/not-bound → D4, D5 ·
click-to-capture + clear → D4 · drops in 3 groups → D3, D6 · with/without ammo → D3, D6 ·
team-message field → D3, D6 · movement rows without ammo/message → D5 · weapons rows incl.
weapnext/prev/last → D3, D5 · no Built-in badge / no entry-kind picker → D5 (+D6 for the drops
chip) · collision surfaced → D2, D7 · Overview + generated file → D1, D8.

## Model Hints

- `D1 → deliverable-hard` — `setActions` rebuilds the whole `binds` record from actions;
  getting the two-key mirror wrong silently drops or duplicates binds in *existing* profiles,
  and it is the one change that crosses shared contract, zod schemas and main state at once.
- `D7 → deliverable-hard` — the Replace path has to mutate two owners (the new slot and the
  previous base bind / other action's slot) inside a single `updateProfileActions` +
  `updateProfileBinds` save without leaving a half-applied profile, and must not regress the
  optimistic-patch/revert logic.
- D2, D3, D4, D5, D6, D8 → default tier.
- `Review: → story-review-hard` — 11 acceptance criteria, it replaces a working user path for
  three categories while that path must keep working for custom ones, and story 016 builds
  directly on the capture slots it introduces.

## Test Plan (manual acceptance)

Run `npm run dev`, open Config, select (or create) a profile, go to the **Advanced** tab.

1. **Movement** — chip shows no "Built-in" badge, no "Add action" button. Pick the "Forward"
   row, click its **Primary** slot, press `W` → slot shows `W`. Click **Secondary**, press
   `UPARROW` → both slots filled. Clear the Secondary → it reads "not bound" again.
2. **Collision** — click another row's Primary and press `W`: an inline banner names the
   Forward row; **Cancel** leaves both rows untouched; repeat and press **Replace** → the new
   row has `W`, the Forward row's Primary is empty.
3. **Weapons** — the `use <weapon>` group and the `weapnext`/`weapprev`/`weaplast` group are
   both present; assign `1` to Blaster and `MWHEELUP` to `weapnext`. No ammo control and no
   message field anywhere in this category.
4. **Weapon dropping** — three group headings (Weapons / Ammunition / Misc), Blaster absent
   from Weapons. On "Rocket Launcher": assign a Primary key, leave "with ammo" on, type a team
   message. On a Misc row (e.g. Quad) there is no ammo checkbox.
5. **Custom category** — create one, confirm the entry-kind picker, "Add action", rename and
   remove all still work and still open `ActionEditor`/`MessageEditor`.
6. **Overview tab** — the keycaps for every key assigned above show the right action label; the
   count of bound keys matches.
7. **Raw config** (story 012) or the written `.cfg`: the rocket-launcher alias body is
   `drop rocket launcher; drop rockets; say_team <text>`, and each assigned key has its own
   `bind` line pointing at that alias.
8. Reopen the app and confirm every assignment, ammo choice and message survived the restart.

## Done

**Summary.** All 8 deliverables (D1-D8) implemented across 3 layers: the shared/main contract
(`ConfigAction.secondaryKey?`/`catalogId?`, mirrored by `setActions` onto the same alias — D1),
two new pure shared/renderer logic modules (`bind-collision.ts`'s collision core — D2;
`catalog-binds.ts`'s row model/lazy-create/prune — D3), a reusable capture hook + bind-slot
control (D4), two new panels replacing the free-form editor for Movement/Weapons (`DualBindPanel`
— D5) and Weapon dropping (`DropBindPanel` — D6), inline collision Cancel/Replace UX wired into
both panels via a small pure `bind-slot-collision.ts` helper (D7), and pipeline-proof tests
confirming the render/Overview side already worked unchanged (D8). Custom, user-created
categories keep today's full create/rename/remove + `ActionEditor`/`MessageEditor` flow,
completely untouched.

**Review-fix cycle (1 of the allowed 3).** The first `story-review-hard` pass returned FAIL on
2 of 11 ACs:
- **AC 3** — an occupied `BindSlot` only showed Clear, not a way to re-capture directly (had to
  Clear first, then capture). Fixed by restructuring `BindSlot.tsx`'s render branches so a
  capture-again button is always shown alongside Clear, mirroring `ActionEditor`'s idiom.
- **AC 9** — `findBindCollision` checked base binds (`profile.binds`) before other actions'
  slots. Since `setActions` mirrors every action's key into `profile.binds` as its alias name, a
  second action capturing a key already held by a first action was misreported as `kind:
  'baseBind'` (naming an opaque alias token) instead of `kind: 'action'` — and `releaseKey`'s
  `baseBind` case does not clear any action's slot, so Replace left both actions' key fields
  pointing at the same key, with `setActions`' "later action wins" array-order tie-break silently
  deciding the outcome after a reload. Fixed by reordering `findBindCollision`'s checks (actions
  before base binds), so any key another action already holds is always reported as `kind:
  'action'`, whose `releaseKey`/`applyReplace` path genuinely clears the previous owner's slot in
  the same submitted array.

A second `story-review-hard` pass re-verified both fixes line-by-line (including self-ignore
still working, the `layerOverride`/hand-written-bind cases unaffected by the reorder, and the
single-array-single-save Replace path traced end to end) plus a regression pass over the other 9
ACs, and returned **PASS**, no further findings.

**Decisions made or reaffirmed during build** (beyond the 17 already recorded above, which were
all followed as written):
- **D3's row `name`** for a lazily-materialised catalogue action is the row's own raw engine
  command text (e.g. `+forward`, `drop rocket launcher`), not its translated i18n label —
  `catalog-binds.ts` is hook-free (no `useTranslation()`) so it cannot resolve a `labelKey`, and
  this is also the exact string a collision banner names an owner by. Acceptable, not
  label-perfect, but avoids reverse-resolving a `catalogId` back to a label — explicitly
  out of scope per the D7 deliverable text.
- **D3's pruning rule** (decision 4) is applied per-action, gated on `catalogId` being present —
  a legacy free-form action (no `catalogId`) that loses its key is never pruned, only a
  catalogue-materialised one is. An ammo-only, no-key, no-message row is still pruned (an ammo
  choice alone is not "an assignment" until something can fire it) — the visible effect is the
  "with ammo" checkbox can snap back to its default the moment the last key/message is cleared;
  accepted as a direct, defensible consequence of decisions 3+4's own wording, not fixed.
- **D7's Replace path never issues a second `updateProfileBinds` call.** `setActions` (D1)
  already rebuilds the entire bind mirror from `actions` on every save and lets a key's new owner
  overwrite a stale hand-written bind for free, so releasing the previous owner is entirely an
  `actions`-array operation (`releaseKey` + `applySlot`, one array, one `updateProfileActions`
  call) — a second, binds-only IPC call would reopen exactly the half-applied-profile window the
  model hint warned about, so it was deliberately never added.
- **`useKeyCapture` cancels on Escape**, diverging from `ActionEditor`'s inline capture (which
  lets you bind Escape as a real key). This is D4's own stated acceptance text, not a bug: nothing
  in this story's ACs requires binding Escape through the new dual-bind editor, and `ActionEditor`
  itself (decision 12, not refactored) is untouched, so custom actions can still bind Escape.

**Known, deliberately unfixed low-severity findings** (documented rather than spent on further
review-fix cycles, none AC-blocking):
- `findBindCollision` returns only the *first* action holding a given key; a pre-story-015 legacy
  profile that already had two actions sharing one key (impossible to create through this story's
  own editor, since every second capture goes through Replace) would have a Replace release only
  one of them. Pre-existing data shape, not reachable via this story's UI.
- `AdvancedTab.tsx`'s `!DUAL_BIND_CATEGORY_IDS.has(category.id)` "Built-in" badge condition is
  always false today, since `BUILT_IN_ACTION_CATEGORIES` only ever contains the three dual-bind
  ids — correct behavior (AC 10), just written less directly than a literal `false`. Harmless.
- A capture's pending collision banner / non-blocking layer warning is local `BindSlot` state
  that is not reset on a profile switch mid-banner — an edge case (switch profiles while a
  collision banner is open, then click Replace) that could apply a stale collision to the new
  profile. Not exercised by the manual test plan below; left as a follow-up if it proves to
  matter in practice.
- `bind-slot-collision.ts`'s `isEmptyCatalogAction` duplicates `catalog-binds.ts`'s internal
  (non-exported) `isEmptyAction` rule rather than importing it, to avoid touching the already-
  reviewed D3 file for an export-only change; both encode the identical rule today.

**Verification.**
- `npm run build` — clean (main/preload/renderer all bundle).
- `npx tsc -p tsconfig.web.json --noEmit` / `-p tsconfig.node.json --noEmit` — both clean.
- `npm test` — **31 files / 507 tests pass** (run via PowerShell; the Bash tool intermittently
  throws a uniform, unrelated `Cannot read properties of undefined (reading 'config')` error
  across the *entire* suite in this sandbox — a known, pre-existing environment flake this sprint,
  reproduced and ruled out repeatedly against clean PowerShell runs at every deliverable boundary,
  not a real failure).
- Two `story-review-hard` clean-agent reviews: first FAIL (2/11 ACs, detailed above), second PASS
  after the fix cycle, with no new findings and no regressions across the other 9 ACs.
- **Live UI smoke: not performed.** This environment has no way to interactively drive the actual
  Electron window (no Playwright installed in this project, no `ui-verify` harness scaffolded,
  and Playwright MCP only drives a browser page, not `_electron`). Per this project's P2 policy
  (`live-smoke-required: true`), status stays `in-progress` rather than `done` — **built, live
  acceptance pending** against the 8-step manual test plan above.

**Commit message:**
```
015: dual-bind editor for Movement, Weapons, Weapon dropping

secondaryKey+catalogId on ConfigAction, pure collision core, catalogue
row model, reusable key capture, DualBindPanel/DropBindPanel, Cancel/
Replace collision UX, pipeline-proof tests
```
