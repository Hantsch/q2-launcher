import c from '../../../src/shared/fixture-constants.json' with { type: 'json' }
import { join } from 'node:path'
import { variantUserDataDir } from '../harness.mjs'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import {
  DEFAULT_SETTINGS,
  FIXED_TIMESTAMP,
  INSTALL_ONE_ID,
  INSTALL_TWO_ID,
  STATE_FILE,
  WINDOW_STATE_FILE,
  gameRoot,
  rmDirBestEffort,
  windowStateDocument,
  writeJson,
} from './core.mjs'
import {
  INSTALL_DEMO_UPGRADE_ID,
  INSTALL_ENGINE_UPDATE_ID,
  makeInstallation,
} from './installations.mjs'
import { RETAIL_PAK_SIZES, writeSizedFile } from './bootstrap.mjs'

// --- config.ts ConfigProfile shape ------------------------------------------
// Mirrors src/shared/modules/config.ts:181 (`ConfigProfile`), `:45`
// (`ProfileAssignment`) and `:56` (`UnrecognizedConfigLine`).
// AltLayer mirrors src/shared/config/aliases/alt-layers.ts:55 (`AltLayer`).
//
// Story 038 D4: `plain.actions` below (+ its `binds` mirror) makes the
// writer's dead-alias-line fix (`src/shared/config/aliases/alias-references.ts`)
// visible on the `config-raw`/`config-write-preview` screens. This file
// cannot import `aliasNameFor`/`bindValueFor` (plain Node ESM outside both TS
// projects - see the file doc comment), so `binds.q` below is that
// algorithm's output hand-computed for action 2 and must stay in lockstep
// with it if either changes: `q2l_a_` + `slugAliasName('Weapon Combo', 14)`
// (`weapon_combo`) + `_` + the action id's first 4 alnum chars (`fixt`).

export function populatedConfigProfiles() {
  const plain = {
    id: 'fixture-profile-plain',
    name: 'Plain Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    // Story 047 D2: `r` is a `$r`-style colour cvar (mirrors
    // src/shared/config/syntax/color-cvars.ts:33 `isColorCvar` - every byte is 0x7f
    // or 0x80-0xff) so the message editor's colour-cvar badge has a real
    // token to resolve for the two message actions below.
    //
    // Story 059 D10: `q2l_fixture_note` is a name `ALL_CVARS` (src/shared/config/catalog/cvar-catalog.ts)
    // does not know - it exists purely so the Settings tab has a real `PlainCvarRow` to show
    // (D7's "the catalogue does not know this name" row), placed into `PLAIN_FIXTURE_SECTION_ID`
    // below alongside a real catalogue cvar so the `config-settings` screen's screenshot shows a
    // user-named section header with both kinds of row under it, not just one.
    cvars: {
      sensitivity: '3',
      crosshair: '0',
      r: '\x7f\x88\x88\x7f',
      q2l_fixture_note: 'shown in raw file',
    },
    // Story 059 D10: a real, user-named `ConfigCvarSection` (mirrors `ConfigCvarSection`,
    // src/shared/modules/config.ts) - this profile's `cvarSections` predates D1, so without this
    // the migration (`materialiseCvarSections`, src/main/services/migrations.ts D6) would seed the
    // four template group sections instead and there would be no *user-named* section anywhere in
    // the populated fixture, which is exactly what D10's `config-settings` screen and the
    // `settings-section-rename-add-cvar` flow both need to show/rename. Holds one real catalogue
    // cvar (`sensitivity`) alongside the plain one above, so the section's own row list already
    // demonstrates both a rich `CvarRow` and a `PlainCvarRow` line up together (AC3).
    cvarSections: [
      {
        id: 'fixture-section-custom',
        name: 'Fixture Section',
        cvars: ['sensitivity', 'q2l_fixture_note'],
      },
    ],
    binds: {
      MOUSE1: '+attack',
      SPACE: '+moveup',
      // Mirrors action 2 ("weapons") below - a multi-command action's mirror
      // is always its alias name, never a bare command (`bindValueFor`).
      q: 'q2l_a_weapon_combo_fixt',
    },
    // Story 079 D3: also assigned to `INSTALL_TWO_ID` (not its default there - `withLayers` below
    // keeps that role), so `scripts/flows/raw-save-cascades.mjs` and
    // `scripts/flows/external-edit-cascades.mjs` have a second real installation to prove "every
    // assigned installation" against, not just the one every other Plain Profile flow already reads.
    assignments: [
      { installationId: INSTALL_ONE_ID, isDefault: true },
      { installationId: INSTALL_TWO_ID, isDefault: false },
    ],
    // Actions 1-3 exercise the writer's three alias-line outcomes
    // (`actionsWithAliasLine`, `src/shared/config/aliases/alias-references.ts`);
    // actions 4-5 (story 047 D2) give the message editor something to show.
    actions: [
      // 1. Catalogue row whose single command is a bare `+attack` (story
      //    034/038's own case): `bindValueFor` returns the command itself,
      //    not the alias, so `binds.MOUSE1` above already carries `+attack`
      //    directly and nothing calls `q2l_a_attack_*` by name. Its alias
      //    line must be entirely absent from the rendered file (AC1).
      {
        id: 'fixture-action-attack',
        categoryId: 'movement',
        name: 'Attack',
        kind: 'bind',
        catalogId: 'movement:attack',
        commands: [{ kind: 'raw', text: '+attack' }],
        key: 'MOUSE1',
      },
      // 2. Free-form, two-command "weapons" row bound on `q`: more than one
      //    command means `bindValueFor` falls back to the alias name, so
      //    `binds.q` above names it and its `alias q2l_a_weapon_combo_fixt …`
      //    line must survive (AC2).
      {
        id: 'fixture-action-weapons',
        categoryId: 'weapons',
        name: 'Weapon Combo',
        kind: 'bind',
        commands: [
          { kind: 'raw', text: 'use shotgun' },
          { kind: 'raw', text: 'use super shotgun' },
        ],
        key: 'q',
      },
      // 3. Keyless, unreferenced action (the User decision): kept regardless
      //    - user-authored content the user may be about to bind, unlike the
      //    catalogue-mirror case above. No `key`, so no `binds` entry.
      {
        id: 'fixture-action-keyless',
        categoryId: 'weapons',
        name: 'Keyless Combo',
        kind: 'bind',
        commands: [
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: '+attack' },
        ],
      },
      // 4. Story 047 D2: a `drops` catalogue row with a message command, so
      //    the drop-row "Edit message" path (`ControlsTab.tsx:701`) and the
      //    message editor's `$r` colour-cvar badge both have something real
      //    to show. `catalogId`/`commands` mirror what `applyMessage`
      //    (src/renderer/src/modules/config/lib/catalog-binds.ts:309) would
      //    write for the `railgun` droppable (`dropWeapon:railgun`,
      //    `action-catalog.ts`'s `DROPPABLES`/`catalog-rows.ts`'s
      //    `makeCatalogId`): the row's own raw `drop <item>` command, plus a
      //    trailing `{ kind: 'message' }` command whose text references the
      //    `r` colour cvar above via `$r`.
      {
        id: 'fixture-action-drop-message',
        categoryId: 'drops',
        name: 'Railgun',
        kind: 'bind',
        catalogId: 'dropWeapon:railgun',
        commands: [
          { kind: 'raw', text: 'drop railgun' },
          { kind: 'message', channel: 'say', text: 'Dropped railgun $r' },
        ],
      },
      // 5. Story 047 D2: a free-form `kind: 'message'` action (no
      //    `catalogId`) for the Team-messages path (`ControlsTab.tsx:1237`,
      //    `editingAction.kind === 'message'`) - a named chat message kept on
      //    a `say_team` channel, distinct from the drops row above which is
      //    catalogue-backed and uses `say`.
      {
        id: 'fixture-action-team-message',
        categoryId: 'weapons',
        name: 'Team Update',
        kind: 'message',
        commands: [{ kind: 'message', channel: 'say_team', text: 'Need ammo $r' }],
      },
      // 6. Story 056 D5: a free-form, three-key action ("Multi Bind") so the extra-keys group
      //    (folded "+2" chevron, indented sub-rows) has a real row to render against - AC 6's
      //    "hand-added third key" is now editable/clearable in Controls itself, not only in Care.
      //    `categoryId: 'movement'` puts it in the rail's default first category (mirrors action 1)
      //    so the new `config-controls-extra-keys-*` screens below need no category-chip click.
      //    `keys` (not the legacy singular `key`, see `ConfigAction.keys` in
      //    src/shared/modules/config.ts) uses three keys not already claimed by `binds`/any other
      //    action's `key`/`keys` above (`MOUSE1`, `SPACE`, `q`). No `binds` entry: `binds` only
      //    mirrors the PRIMARY key of a single-command action for the base bind table
      //    (`action-mirror.ts`), and this fixture's whole point is to view/edit the action in the
      //    Controls tab, not round-trip a specific alias line.
      {
        id: 'fixture-action-multibind',
        categoryId: 'movement',
        name: 'Multi Bind',
        kind: 'bind',
        commands: [
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: '+attack' },
        ],
        keys: [{ key: 'G' }, { key: 'H' }, { key: 'J' }],
      },
      // 7-8. Story 063 D4: two already-damaged, keyless Weapons entries - one per grenade command -
      //   seeded as `kind: 'alias'` so the Controls tab's "Make bindable" row-menu item
      //   (`applyEntryKindBindable`) has real inert rows to repair. These are the shape a profile
      //   that hit story 063's root-cause bug is stuck with forever (a keyless bind/message entry
      //   that got silently misread back as `kind: 'alias'` on a file->state pass, decision 4) - and,
      //   distinct from the catalogue's own `weaponUse:use_grenades`/`weaponUse:use_glauncher` rows
      //   (which already round-trip correctly since D1/D2 and are not inert), these are user-created
      //   entries with their own synthetic ids/names, same idea as `fixture-action-weapons`
      //   ("Weapon Combo") above but one command each and no key, mirroring the real damaged
      //   `Grenade + Launcher` entry the story's root-cause section describes split one-command-per-
      //   entry per the D4 acceptance ("one keyless kind: 'alias' Weapons entry per grenade
      //   command").
      {
        id: 'fixture-action-inert-grenades',
        categoryId: 'weapons',
        name: 'Grenades (inert)',
        kind: 'alias',
        commands: [{ kind: 'raw', text: 'use grenades' }],
      },
      {
        id: 'fixture-action-inert-glauncher',
        categoryId: 'weapons',
        name: 'Grenade Launcher (inert)',
        kind: 'alias',
        commands: [{ kind: 'raw', text: 'use grenade launcher' }],
      },
    ],
  }

  const withLayers = {
    id: 'fixture-profile-layers',
    name: 'Layered Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: { sensitivity: '5' },
    binds: { w: '+forward', s: '+back' },
    assignments: [{ installationId: INSTALL_TWO_ID, isDefault: false }],
    layers: [
      {
        id: 'fixture-layer-drops',
        name: 'Drops',
        mode: 'hold',
        triggerKey: 'ALT',
        overrides: { 1: 'drop rl', 2: 'drop rg' },
      },
    ],
  }

  const withUnrecognized = {
    id: 'fixture-profile-unrecognized',
    name: 'Imported Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: {},
    binds: {},
    assignments: [],
    unrecognized: [{ file: 'config.cfg', line: 42, text: 'seta cl_oddcvar "1"' }],
  }

  // Story 167 D4: the one profile assigned to a Q2PRO installation (`INSTALL_ENGINE_UPDATE_ID`), so
  // `scripts/flows/demo-actions-bind.mjs` can prove the demo rows are bindable there. Plain Profile
  // (both installations r1q2) is that flow's r1q2 case. No `categories`/`actions`: the state
  // migration materialises them on load, like every other populated profile.
  const withQ2pro = {
    id: 'fixture-profile-q2pro',
    name: 'Q2PRO Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: {},
    binds: {},
    assignments: [{ installationId: INSTALL_ENGINE_UPDATE_ID, isDefault: true }],
  }

  // Story 168 D3: assigned to one r1q2 (`INSTALL_DEMO_UPGRADE_ID`) and one healthy Q2PRO installation
  // (`INSTALL_ENGINE_UPDATE_ID`) so `scripts/flows/autorecord-setting.mjs` can switch the engine
  // scope. The existing `cl_beginmapcmd` proves the Q2PRO recipe chains after it, not over it.
  const withAutorecord = {
    id: 'fixture-profile-autorecord',
    name: 'Autorecord Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: { cl_beginmapcmd: 'echo welcome' },
    binds: {},
    assignments: [
      { installationId: INSTALL_DEMO_UPGRADE_ID, isDefault: false },
      { installationId: INSTALL_ENGINE_UPDATE_ID, isDefault: false },
    ],
  }

  return [plain, withLayers, withUnrecognized, withQ2pro, withAutorecord]
}

// --- config.cfg importable fixture ------------------------------------------
// Fixed-content `baseq2/config.cfg` written under `fixture-install-writedir`
// only, so the config-import/preview flow has something real to read. Used by
// `config-import-preview` and `config-import-review`; see
// src/main/modules/config/core/import-reader.ts for how `seta`/`bind`/`alias`
// lines are recognized.
//
// - `bind w` appears twice with no `unbind w` in between: import-reader.ts's
//   `applyBind` records that as a duplicate bind (mirrors its own test,
//   "reports a key bound twice with no unbind in between as a duplicate").
// - `alias +fixture_unrecognized "echo hi"` is a plain alias definition
//   (story 041 taught `config-parser.ts` to recognize `alias`, so this no
//   longer lands in `preserved` the way it used to pre-story-041).
// - `alias q2l_fixture_layer "bind e +use"` is story 041's ambiguous
//   construct: its body contains a top-level `bind`, so it lands in
//   `ImportPreviewResult.ambiguousRebindAliases` and is what makes the
//   `config-import-review` screen's review step reachable.
export const FIXTURE_CONFIG_CFG = `seta sensitivity "5"
seta cl_run "1"
seta name "FixtureUser"
seta cl_particles "1"
bind w "+forward"
bind s "+back"
bind MOUSE1 "+attack"
bind w "+moveup"
alias +fixture_unrecognized "echo hi"
alias q2l_fixture_layer "bind e +use"
`

// --- own-file ("restore") importable fixture -------------------------------
// Story 042 D6: fixed-content config carrying the `OWNERSHIP_MARKER` sentinel
// (`@shared/config/render/render.ts`) plus a well-formed `[q2l v=1]` header tag
// (`@shared/config/profile/profile-metadata.ts`), written under `INSTALL_TWO_ID`'s
// `RESTORE_GAME_DIR` gamedir - used by the `config-import-restore` screen to
// exercise `ImportPreviewResult.ownWrittenFile`/`sourceProfileId`/
// `metadataWarnings`.
//
// - Line 1 is the literal sentinel line naming `fixture-profile-plain` (the
//   `plain` profile's own id, `populatedConfigProfiles()` below) - so the
//   import dialog's restore banner resolves and names a real local profile
//   rather than falling back to the bare id.
// - Line 3 carries the header block's `[q2l v=1]` version marker - required
//   for `restoreProfileParts` to take the tagged path at all (an untagged
//   sentinel-only file delegates wholesale to story 041's import instead).
// - The last `bind` line's trailing comment carries a deliberately malformed
//   tag (`[q2l bogus]`, no `key=value` pairs) so `metadataWarnings` is
//   non-empty on this screen (`tag-malformed`, `profile-restore.ts`) -
//   without it the warnings list would never render on any fixture screen.
// - No entry (`e=`)/category (`cat=`) tags at all: this is a minimal
//   launcher file with no actions/layers, same as a freshly created empty
//   profile would restore to (`actions`/`categories`/`layers` all empty).
// - Line 1's trailing clause is deliberately the OLD (pre-story-043) sentinel wording, not the
//   current one - a live exercise of the wording-tolerant ownership check
//   (`ownedProfileId`/`findOwnCanonicalFile`, `@shared/config/render/render.ts` + `canonical.ts`) rather
//   than a copy/paste that happened to go stale. Line 4, in contrast, must stay byte-identical to
//   `HAND_EDIT_SENTENCE` (`@shared/config/render/render.ts`) - `profile-restore.ts`'s
//   `consumeHeaderDecoration` matches it exactly so this line is recognised as understood header
//   decoration and folded out of the import dialog's "unrecognised leftovers" list; letting it
//   drift out of sync (as it did across story 043's D1 wording change) reintroduces the exact
//   `scrollable-region-focusable` axe violation story 042's fix-cycle-5 closed, because an
//   unrecognised long comment line renders as its own scrollable single-line code block with no
//   keyboard access.
// - Story 051 (the header-block rewrite: sentinel line dropped from profile files, ownership id
//   moved into the `[q2l ...]` tag's `id` field, four-line `=`-ruled banner replacing this five-line
//   block) deliberately leaves this whole literal in the OLD/legacy shape rather than updating it to
//   match `buildHeaderBlock`'s new output. That is not staleness: this fixture is now the
//   live-smoke regression probe for story 051's AC7 - "a file carrying the previous header shape is
//   still recognised as launcher-owned and is rewritten in the new shape on its next save" - so
//   `npm run ui:verify`'s config-import-restore screen exercises the legacy-shape read path in the
//   real app on every run. Do not "fix" this to the new banner shape in a future change; that would
//   delete the one place in the repo that keeps the legacy-shape reader honest end to end.
export const FIXTURE_RESTORE_CONFIG_CFG = `// q2-launcher profile fixture-profile-plain - generated, do not edit
// ================================================================
// Fixture Restored Profile [q2l v=1]
// Q2 Launcher - hand-edited changes to this file are read back
// ================================================================

// --- General ---
set sensitivity "5"

// --- Other binds ---
bind w "+forward"
bind s "+back" // note [q2l bogus]
`

// --- writers ----------------------------------------------------------------

// --- story 052 D10: template-seeded / imported-only Controls fixtures --------
//
// `LEGACY_SEED_SCHEMA_VERSION` above (`1`) is deliberately never bumped in step with
// `src/shared/constants.ts` (now `5`): every `LEGACY_SEED_VARIANTS` run starts behind the real app
// on purpose, so the real migration
// (`src/main/services/migrations.ts`, story 052 D6) runs fresh on every reseed and materialises
// `TEMPLATE_ACTION_CATEGORIES` plus one action per `allCatalogRows()` row into every pre-existing
// profile at runtime - exactly the "existing profiles migrate once" behaviour AC8 describes. That
// is what already makes the `config-controls`/`config-controls-message`/
// `config-controls-drop-message` screens and the `drop-message-checkbox` flow show Plain Profile's
// full Movement/Weapons/Weapon-dropping rail today, without hand-authoring roughly fifty catalogue
// rows here.
//
// The two profiles below need the opposite guarantee: a profile with only its own "Imported"
// category must show *only* that (AC1/AC7). If it shared a document with `LEGACY_SEED_SCHEMA_VERSION`
// still at `1`, that very same migration would blindly add Movement/Weapons/Weapon dropping to it
// too - the migration has no way to tell "predates story 052" apart from "genuinely has just one
// category". A dedicated third fixture variant, seeded at the real, current schema version (so no
// migration runs for anyone in this document), is what keeps that guarantee intact without
// touching `populated`/`empty` at all.
/** The real, current schema version, unlike the deliberately-stale `LEGACY_SEED_SCHEMA_VERSION` -
 * see the comment block just above this constant. */
const CONTROLS_SEED_SCHEMA_VERSION = c.stateSchemaVersion

/** Mirrors src/shared/modules/config.ts:146-150 (`TEMPLATE_ACTION_CATEGORIES`). */
const TEMPLATE_CATEGORIES = [
  { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.movement' },
  { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
  { id: 'drops', name: 'Weapon dropping', nameKey: 'config.controls.categories.drops' },
]

/**
 * Mirrors src/shared/config/catalog/catalog-rows.ts's `allCatalogRows()` (in turn built from
 * src/shared/config/catalog/action-catalog.ts's `MOVEMENT_ACTIONS`/`WEAPONS`/`WEAPON_ACTIONS`/
 * `WEAPON_EXTRA_ACTIONS`/`DROPPABLES`), in the exact order the real function produces them:
 * movement, `use <weapon>`, weapon cycling, then the three drop groups (weapon/ammo/misc). Each
 * tuple is `[kind, id, categoryId, command]`; `catalogId` is `${kind}:${id}` (`makeCatalogId`) and
 * a row's display name is its own raw command (`nameForCatalogRow`), since every row here carries
 * exactly one command.
 */
const TEMPLATE_CATALOG_ROW_TUPLES = [
  // movement (MOVEMENT_ACTIONS)
  ['movement', 'forward', 'movement', '+forward'],
  ['movement', 'back', 'movement', '+back'],
  ['movement', 'moveleft', 'movement', '+moveleft'],
  ['movement', 'moveright', 'movement', '+moveright'],
  ['movement', 'moveup', 'movement', '+moveup'],
  ['movement', 'movedown', 'movement', '+movedown'],
  ['movement', 'attack', 'movement', '+attack'],
  ['movement', 'speed', 'movement', '+speed'],
  ['movement', 'strafe', 'movement', '+strafe'],
  ['movement', 'left', 'movement', '+left'],
  ['movement', 'right', 'movement', '+right'],
  ['movement', 'klook', 'movement', '+klook'],
  ['movement', 'mlook', 'movement', '+mlook'],
  ['movement', 'centerview', 'movement', 'centerview'],
  // weaponUse (WEAPON_ACTIONS, one per WEAPONS entry)
  ['weaponUse', 'blaster', 'weapons', 'use blaster'],
  ['weaponUse', 'shotgun', 'weapons', 'use shotgun'],
  ['weaponUse', 'sshotgun', 'weapons', 'use super shotgun'],
  ['weaponUse', 'machinegun', 'weapons', 'use machinegun'],
  ['weaponUse', 'chaingun', 'weapons', 'use chaingun'],
  ['weaponUse', 'grenades', 'weapons', 'use grenades'],
  ['weaponUse', 'glauncher', 'weapons', 'use grenade launcher'],
  ['weaponUse', 'rlauncher', 'weapons', 'use rocket launcher'],
  ['weaponUse', 'hyperblaster', 'weapons', 'use hyperblaster'],
  ['weaponUse', 'railgun', 'weapons', 'use railgun'],
  ['weaponUse', 'bfg', 'weapons', 'use bfg10k'],
  // weaponExtra (WEAPON_EXTRA_ACTIONS)
  ['weaponExtra', 'weapnext', 'weapons', 'weapnext'],
  ['weaponExtra', 'weapprev', 'weapons', 'weapprev'],
  ['weaponExtra', 'weaplast', 'weapons', 'weaplast'],
  // dropWeapon (DROPPABLES kind === 'weapon', i.e. WEAPONS minus blaster)
  ['dropWeapon', 'shotgun', 'drops', 'drop shotgun'],
  ['dropWeapon', 'sshotgun', 'drops', 'drop super shotgun'],
  ['dropWeapon', 'machinegun', 'drops', 'drop machinegun'],
  ['dropWeapon', 'chaingun', 'drops', 'drop chaingun'],
  ['dropWeapon', 'grenades', 'drops', 'drop grenades'],
  ['dropWeapon', 'glauncher', 'drops', 'drop grenade launcher'],
  ['dropWeapon', 'rlauncher', 'drops', 'drop rocket launcher'],
  ['dropWeapon', 'hyperblaster', 'drops', 'drop hyperblaster'],
  ['dropWeapon', 'railgun', 'drops', 'drop railgun'],
  ['dropWeapon', 'bfg', 'drops', 'drop bfg10k'],
  // dropAmmo (DROPPABLES kind === 'ammo')
  ['dropAmmo', 'shells', 'drops', 'drop shells'],
  ['dropAmmo', 'bullets', 'drops', 'drop bullets'],
  ['dropAmmo', 'rockets', 'drops', 'drop rockets'],
  ['dropAmmo', 'cells', 'drops', 'drop cells'],
  ['dropAmmo', 'slugs', 'drops', 'drop slugs'],
  ['dropAmmo', 'hgrenades', 'drops', 'drop grenades'],
  // dropMisc (DROPPABLES kind === 'powerup' || 'tech')
  ['dropMisc', 'powershield', 'drops', 'drop power shield'],
  ['dropMisc', 'powerscreen', 'drops', 'drop power screen'],
  ['dropMisc', 'quad', 'drops', 'drop quad damage'],
  ['dropMisc', 'invuln', 'drops', 'drop invulnerability'],
  ['dropMisc', 'silencer', 'drops', 'drop silencer'],
  ['dropMisc', 'rebreather', 'drops', 'drop rebreather'],
  ['dropMisc', 'envsuit', 'drops', 'drop environment suit'],
  ['dropMisc', 'adrenaline', 'drops', 'drop adrenaline'],
  ['dropMisc', 'bandolier', 'drops', 'drop bandolier'],
  ['dropMisc', 'ammopack', 'drops', 'drop ammo pack'],
  ['dropMisc', 'tech', 'drops', 'drop tech'],
]

const TEMPLATE_CATALOG_ROWS = TEMPLATE_CATALOG_ROW_TUPLES.map(
  ([kind, id, categoryId, command]) => ({
    catalogId: `${kind}:${id}`,
    categoryId,
    command,
  }),
)

/** Mirrors src/shared/modules/config.ts's `TEMPLATE_BOUND_CATALOG_IDS` and `STANDARD_TEMPLATE.binds`
 * - the six catalogue rows a freshly created template profile binds immediately, and the key each
 * is bound to. */
const TEMPLATE_BOUND_KEYS = {
  'movement:forward': 'UPARROW',
  'movement:back': 'DOWNARROW',
  'movement:moveup': 'SPACE',
  'movement:movedown': 'c',
  'movement:speed': 'SHIFT',
  'movement:attack': 'MOUSE1',
}

/**
 * Story 053 D8: mirrors `src/shared/modules/config.ts`'s five template sub-category ids/names
 * (`WEAPONS_USE_SUBCATEGORY_ID` etc., added by D5) and its `TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX`
 * - this fixture's `templateSeededConfigProfile()` predates D5 and, until this deliverable, never
 * carried any `subcategories`/`subcategoryId`, so the `config-controls-template-seeded` screen never
 * actually showed a sub-categorised view even after D5 landed. Kept as its own literal block, not
 * imported, for the same "plain Node ESM can't import from the src TS trees" reason every other
 * mirror in this file gives (see the file's own doc comment at the top).
 */
const WEAPONS_USE_SUBCATEGORY_ID = 'weapons-use'

const WEAPONS_CYCLING_SUBCATEGORY_ID = 'weapons-cycling'

const DROPS_WEAPONS_SUBCATEGORY_ID = 'drops-weapons'

const DROPS_AMMO_SUBCATEGORY_ID = 'drops-ammo'

const DROPS_MISC_SUBCATEGORY_ID = 'drops-misc'

/** `CatalogRowKind` prefix (`row.catalogId.split(':')[0]`) -> the template sub-category it seeds
 * into. Mirrors `TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX` (`src/shared/modules/config.ts`). A
 * prefix missing here (`movement`) gets no `subcategoryId` - it lands in the ungrouped run. */
const TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX = {
  weaponUse: WEAPONS_USE_SUBCATEGORY_ID,
  weaponExtra: WEAPONS_CYCLING_SUBCATEGORY_ID,
  dropWeapon: DROPS_WEAPONS_SUBCATEGORY_ID,
  dropAmmo: DROPS_AMMO_SUBCATEGORY_ID,
  dropMisc: DROPS_MISC_SUBCATEGORY_ID,
}

function templateSubcategoryIdFor(catalogId) {
  const prefix = catalogId.split(':')[0] ?? ''
  return TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX[prefix]
}

/**
 * A profile shaped exactly like "create from template" would produce (mirrors
 * `STANDARD_TEMPLATE`/`buildTemplateActions` in src/shared/modules/config.ts): the three template
 * categories, and one action per catalogue row - unbound (`commands: []`) except the six rows
 * `TEMPLATE_BOUND_KEYS` names, which carry their real command and key exactly as a fresh template
 * profile's first commit would. Demonstrates AC4 on the `config-controls-template-seeded` screen.
 */
function templateSeededConfigProfile() {
  const binds = {}
  for (const [catalogId, key] of Object.entries(TEMPLATE_BOUND_KEYS)) {
    const row = TEMPLATE_CATALOG_ROWS.find((candidate) => candidate.catalogId === catalogId)
    binds[key] = row.command
  }

  return {
    id: 'fixture-profile-template-seeded',
    name: 'Template Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    // Mirrors STANDARD_TEMPLATE.cvars (src/shared/modules/config.ts).
    cvars: {
      sensitivity: '3',
      cl_run: '0',
      crosshair: '0',
      cl_gun: '1',
      m_pitch: '0.022',
      volume: '0.7',
    },
    binds,
    assignments: [],
    // Story 053 D8: `weapons`/`drops` now carry the same `subcategories` STANDARD_TEMPLATE.categories
    // seeds (D5) - so a template-seeded profile shows real group headers, not just three flat
    // categories, matching what "create from template" actually produces today.
    categories: TEMPLATE_CATEGORIES.map((category) => ({
      ...category,
      ...(category.id === 'weapons'
        ? {
            subcategories: [
              { id: WEAPONS_USE_SUBCATEGORY_ID, name: 'Use weapon' },
              { id: WEAPONS_CYCLING_SUBCATEGORY_ID, name: 'Cycling' },
            ],
          }
        : {}),
      ...(category.id === 'drops'
        ? {
            subcategories: [
              { id: DROPS_WEAPONS_SUBCATEGORY_ID, name: 'Weapons' },
              { id: DROPS_AMMO_SUBCATEGORY_ID, name: 'Ammunition' },
              { id: DROPS_MISC_SUBCATEGORY_ID, name: 'Misc' },
            ],
          }
        : {}),
    })),
    actions: TEMPLATE_CATALOG_ROWS.map((row) => {
      const key = TEMPLATE_BOUND_KEYS[row.catalogId]
      const slug = row.catalogId.replace(/[^a-z0-9]+/gi, '-')
      const subcategoryId = templateSubcategoryIdFor(row.catalogId)
      return {
        id: `fixture-template-seed-${slug}`,
        categoryId: row.categoryId,
        name: row.command,
        kind: 'bind',
        catalogId: row.catalogId,
        commands: key ? [{ kind: 'raw', text: row.command }] : [],
        ...(key ? { key } : {}),
        ...(subcategoryId ? { subcategoryId } : {}),
      }
    }),
  }
}

/**
 * Story 058 D7: the `controls-seed` variant's own installation, used only so
 * `importedOnlyConfigProfile()` below can be assigned to one for the `config-care-clear` screen
 * (the healthy Care fixture). None of `config-controls-imported-only`/`config-controls-template-
 * seeded`/`config-controls-template-subcategories` or the `controls-subcategory` flow touch
 * installations at all, so adding one here does not change anything about how those screens read.
 */
const INSTALL_CONTROLS_SEED_ID = 'fixture-install-controls-seed'

/**
 * A profile with a single, non-template category ("Imported") and a few free-form entries of its
 * own - no `movement`/`weapons`/`drops` at all. Demonstrates AC1/AC7: "a profile with only an
 * Imported category shows only that" on the `config-controls-imported-only` screen.
 *
 * Story 058 D7: also the `config-care-clear` screen's healthy fixture - deliberately NOT
 * `templateSeededConfigProfile()`/a migrated `populated` profile, both of which carry the full
 * movement/weapons/drops catalogue and therefore always raise `aliasShadowsCommand` findings for
 * several of its rows (`+moveleft` etc. resolve to alias names that collide with a reserved
 * command name - `validate-actions.ts`'s own doc comment confirms this fires for a catalogue row
 * too, not just a hand-typed one). This profile's three free-form entries do not collide with
 * anything reserved, so it is the one fixture profile that can actually reach Care's "All clear".
 * Assigned to `INSTALL_CONTROLS_SEED_ID` below so AC 1's "assigned, in-sync installation" is real,
 * not merely "nothing to validate against".
 */
function importedOnlyConfigProfile() {
  return {
    id: 'fixture-profile-imported-only',
    name: 'Imported Category Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: {},
    // No `binds` mirror for the "Use item" action below: unlike a catalogue-backed row,
    // `bindValueFor` (@shared/config/aliases/action-mirror.ts) only passes a bare `+command` through
    // verbatim when the action carries a `catalogId` - a free-form action's mirror is always its
    // alias name, so a hand-authored `binds.e: '+use'` here would read as a *second*, independent
    // claimant on `e` to `bind-conflicts.ts`'s scan and raise a spurious conflict badge that has
    // nothing to do with this screen's own point (AC1/AC7's "shows only its own category").
    binds: {},
    assignments: [{ installationId: INSTALL_CONTROLS_SEED_ID, isDefault: true }],
    categories: [{ id: 'imported', name: 'Imported' }],
    actions: [
      {
        id: 'fixture-imported-use',
        categoryId: 'imported',
        name: 'Use item',
        kind: 'bind',
        // Story 058 D7: real Quake II has no continuous `+use`/`-use` pair (the actual console
        // command is the discrete `use <item>`), so a signed `+use` token here reads to
        // `validate-actions.ts`'s `undefinedAlias` rule exactly like a hand-typed reference to an
        // alias that does not exist - it is neither a known engine command nor a defined alias.
        // Harmless for this profile's original purpose (`config-controls-imported-only` only checks
        // that the "Imported" category renders, never this row's exact command), but it is also now
        // the `config-care-clear` screen's healthy fixture (added in this deliverable), which needs
        // this profile to carry zero validation findings. The bare `use` command is exactly what a
        // real "Use item" bind would send.
        commands: [{ kind: 'raw', text: 'use' }],
        key: 'e',
      },
      {
        id: 'fixture-imported-inventory',
        categoryId: 'imported',
        name: 'Inventory',
        kind: 'bind',
        commands: [{ kind: 'raw', text: 'inven' }],
      },
      {
        id: 'fixture-imported-gg',
        categoryId: 'imported',
        name: 'GG',
        kind: 'message',
        commands: [{ kind: 'message', channel: 'say', text: 'gg' }],
      },
    ],
  }
}

function controlsSeedStateDocument() {
  return {
    schemaVersion: CONTROLS_SEED_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, scanOnFirstRun: false },
    installations: [
      makeInstallation({
        id: INSTALL_CONTROLS_SEED_ID,
        name: 'Controls Seed Install',
        rootPath: join(gameRoot(), INSTALL_CONTROLS_SEED_ID),
        favorite: false,
        sortOrder: 0,
      }),
    ],
    configProfiles: [templateSeededConfigProfile(), importedOnlyConfigProfile()],
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
  }
}

/** Deletes and rewrites the `controls-seed` variant's userdata, plus its one installation's game
 * dir (story 058 D7 - see `INSTALL_CONTROLS_SEED_ID`'s own doc comment). */
export function writeControlsSeedFixture() {
  const userDataDir = variantUserDataDir('controls-seed')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), controlsSeedStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const installRoot = join(gameRoot(), INSTALL_CONTROLS_SEED_ID)
  const baseq2Dir = join(installRoot, 'baseq2')
  rmDirBestEffort(installRoot)
  mkdirSync(baseq2Dir, { recursive: true })

  // This root used to hold nothing but an empty `baseq2`, and got away with it because the app's
  // own startup `validateAll()` (`main/index.ts`) never actually ran: it hung off a
  // `did-finish-load` listener registered after the event had already fired, so every fixture kept
  // whatever `makeInstallation()` seeded - here `status: 'ok'`, `engineKind: 'r1q2'`. Now that the
  // listener is gone and `validateAll()` really runs, the verdict is re-derived from the files
  // below, and an empty root inspects as `engineKind: 'unknown'` plus an error-level `pak0Missing`.
  //
  // `config-care-clear` is the screen that notices, and it fails rather than merely looking
  // different: its Care "All clear" block needs `ProfileValidation.status === 'ok'`, which
  // `engineScope()` (renderer/src/modules/config/lib/engine-scope.ts) only answers when an assigned
  // installation runs an engine the cvar catalogue has facts for. `unknown` has none, so the tab
  // renders `healthNotChecked` and the screen's own `waitFor` times out.
  //
  // So the folder now holds what this variant's `state.json` has always claimed. The engine marker
  // is matched by NAME, on every platform (`classifyEngine`, src/main/services/inspector.ts), but
  // `looksExecutable` (src/main/lib/fs-utils.ts) is extension-only on Windows and execute-bit-only
  // off it - the same split `writeLinuxJourneyInstallRoot()` below already documents at length, so
  // the name and the `chmodSync` follow its lead rather than inventing a second convention. Without
  // it the root would classify as r1q2 yet carry no runnable client, i.e. an error-level
  // `noExecutable` and `status: 'invalid'` on Linux only.
  const executableName = process.platform === 'win32' ? 'r1q2.exe' : 'r1q2'
  const executablePath = join(installRoot, executableName)
  // Contents are never read - `classifyEngine`/`rankExecutables` look at the name and the mode.
  writeFileSync(executablePath, '')
  if (process.platform !== 'win32') chmodSync(executablePath, 0o755)

  // The exact pak combination `inspectInstallation` turns into zero checks: `pak0.pak` at its real
  // retail length (the size comparison is genuine - anything else raises `pak0NotRetail` and paints
  // a Demo marker on an installation this screen wants to read as plain and healthy) with
  // `pak1.pak`/`pak2.pak` beside it, which are only ever tested for existence. `writeSizedFile` is
  // `truncateSync`, the same trick `INSTALL_ENGINE_UPDATE_ID`'s block above uses, so the 184 MB is
  // a hole rather than bytes; it and `RETAIL_PAK_SIZES` are declared further down this file as plain
  // module-level bindings, forward-referenced exactly as that block already does.
  writeSizedFile(join(baseq2Dir, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
  writeSizedFile(join(baseq2Dir, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
  writeSizedFile(join(baseq2Dir, 'pak2.pak'), RETAIL_PAK_SIZES['pak2.pak'])

  return { userDataDir, installations: 1, configProfiles: 2 }
}
