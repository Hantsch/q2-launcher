// D2 — fixture seed data + writers for the UI-verification harness.
//
// `scripts/` is plain Node ESM outside both TS projects, so it cannot
// `import type`/`import` anything from `src/**/*.ts` at runtime. Instead, the
// small set of literal values this file needs are hardcoded below, each
// annotated with exactly the source file/constant it mirrors, so a future
// schema bump is easy to find via grep (search for "mirrors").
//
// Everything here is deterministic: fixed ids and fixed ISO timestamps, never
// `Date.now()`/`crypto.randomUUID()`. That is what makes `npm run ui:seed`
// idempotent — re-running it regenerates byte-identical files rather than
// merge-patching whatever is already on disk.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { UI_VERIFY_ROOT } from './paths.mjs'
import { variantUserDataDir } from './harness.mjs'

// --- literals mirrored from src/shared -------------------------------------

/** Mirrors src/shared/constants.ts:10 (`STATE_FILE`). */
const STATE_FILE = 'state.json'
/** Mirrors src/shared/constants.ts:11 (`WINDOW_STATE_FILE`). */
const WINDOW_STATE_FILE = 'window-state.json'
/** Deliberately kept one version behind the real `STATE_SCHEMA_VERSION`
 * (`src/shared/constants.ts`, currently `2`) rather than mirroring it - see the comment block
 * above `CONTROLS_SEED_SCHEMA_VERSION` below for why `populated`/`empty` need every reseed to run
 * story 052 D6's migration fresh. */
const STATE_SCHEMA_VERSION = 1

/** Mirrors src/shared/types/settings.ts:22-32 (`DEFAULT_SETTINGS`). */
const DEFAULT_SETTINGS = {
  locale: 'system',
  motion: 'system',
  activeInstallationId: null,
  lastRoute: '/home',
  minimizeOnLaunch: true,
  closeAfterLaunch: false,
  confirmBeforeRemoving: true,
  scanOnFirstRun: true,
  deepScanDrives: [],
}

/** Fixed instant used for every fixture timestamp — never `Date.now()` (idempotency). */
const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z'

/** Root all fixture game directories live under: `.ui-verify/fixture/game/<install>/`. */
function gameRoot() {
  return join(UI_VERIFY_ROOT, 'fixture', 'game')
}

// --- state.ts LauncherStateDocument ("defaults()") shape -------------------
// Mirrors src/main/services/state.ts:16-48 (`LauncherStateDocument`) and its
// `defaults()` (state.ts:50-60).

function emptyStateDocument() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    // `scanOnFirstRun: false` overrides the default: with zero installations,
    // `useLauncher.bootstrap()` otherwise opens `DetectDialog` with
    // `autoStart: true`, which calls `detection:scan` on mount without
    // waiting for a click — exactly the real Steam/GOG/registry scan the
    // harness must never trigger (story 026 Decisions).
    settings: { ...DEFAULT_SETTINGS, scanOnFirstRun: false },
    installations: [],
    configProfiles: [],
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
  }
}

// --- installation.ts Installation shape ------------------------------------
// Mirrors src/shared/types/installation.ts:68 (`Installation`).

function makeInstallation({ id, name, rootPath, writeDirPath, favorite, sortOrder, gameDirs }) {
  return {
    id,
    name,
    rootPath,
    ...(writeDirPath ? { writeDirPath } : {}),
    engineKind: 'r1q2',
    executablePath: undefined,
    launchArgs: [],
    activeGameDir: '',
    detectedVersion: undefined,
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: gameDirs ?? ['baseq2'],
    favorite,
    sortOrder,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    lastValidatedAt: undefined,
    lastPlayedAt: undefined,
    totalPlaytimeSeconds: 0,
    moduleData: undefined,
  }
}

const INSTALL_ONE_ID = 'fixture-install-favorite'
const INSTALL_TWO_ID = 'fixture-install-writedir'

/** Story 042 D6: the second gamedir under `INSTALL_TWO_ID` that holds the own-file (launcher
 * "restore") fixture config, distinct from `baseq2`'s foreign-config fixture above. */
const RESTORE_GAME_DIR = 'q2l-restore-fixture'

function populatedInstallations() {
  return [
    makeInstallation({
      id: INSTALL_ONE_ID,
      name: 'Fixture Favorite Install',
      rootPath: join(gameRoot(), INSTALL_ONE_ID),
      favorite: true,
      sortOrder: 0,
    }),
    makeInstallation({
      id: INSTALL_TWO_ID,
      name: 'Fixture WriteDir Install',
      rootPath: join(gameRoot(), INSTALL_TWO_ID),
      writeDirPath: join(gameRoot(), INSTALL_TWO_ID, 'writedir'),
      favorite: false,
      sortOrder: 1,
      // Story 042 D6: a second gamedir, `RESTORE_GAME_DIR`, holding a launcher-written
      // (own-file) fixture config alongside the plain `baseq2` foreign-config one - `baseq2`
      // always sorts first (decision 12), so this is additive and does not change what
      // `config-import-preview`/`config-import-review` auto-select.
      gameDirs: ['baseq2', RESTORE_GAME_DIR],
    }),
  ]
}

// --- config.ts ConfigProfile shape ------------------------------------------
// Mirrors src/shared/modules/config.ts:181 (`ConfigProfile`), `:45`
// (`ProfileAssignment`) and `:56` (`UnrecognizedConfigLine`).
// AltLayer mirrors src/shared/config/alt-layers.ts:55 (`AltLayer`).
//
// Story 038 D4: `plain.actions` below (+ its `binds` mirror) makes the
// writer's dead-alias-line fix (`src/shared/config/alias-references.ts`)
// visible on the `config-raw`/`config-write-preview` screens. This file
// cannot import `aliasNameFor`/`bindValueFor` (plain Node ESM outside both TS
// projects - see the file doc comment), so `binds.q` below is that
// algorithm's output hand-computed for action 2 and must stay in lockstep
// with it if either changes: `q2l_a_` + `slugAliasName('Weapon Combo', 14)`
// (`weapon_combo`) + `_` + the action id's first 4 alnum chars (`fixt`).

function populatedConfigProfiles() {
  const plain = {
    id: 'fixture-profile-plain',
    name: 'Plain Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    // Story 047 D2: `r` is a `$r`-style colour cvar (mirrors
    // src/shared/config/color-cvars.ts:33 `isColorCvar` - every byte is 0x7f
    // or 0x80-0xff) so the message editor's colour-cvar badge has a real
    // token to resolve for the two message actions below.
    cvars: { sensitivity: '3', crosshair: '0', r: '\x7f\x88\x88\x7f' },
    binds: {
      MOUSE1: '+attack',
      SPACE: '+moveup',
      // Mirrors action 2 ("weapons") below - a multi-command action's mirror
      // is always its alias name, never a bare command (`bindValueFor`).
      q: 'q2l_a_weapon_combo_fixt',
    },
    assignments: [{ installationId: INSTALL_ONE_ID, isDefault: true }],
    // Actions 1-3 exercise the writer's three alias-line outcomes
    // (`actionsWithAliasLine`, `src/shared/config/alias-references.ts`);
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
        overrides: { '1': 'drop rl', '2': 'drop rg' },
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

  return [plain, withLayers, withUnrecognized]
}

function populatedStateDocument() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, activeInstallationId: INSTALL_ONE_ID },
    installations: populatedInstallations(),
    configProfiles: populatedConfigProfiles(),
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
  }
}

// --- settings.ts WindowState shape ------------------------------------------
// Mirrors src/shared/types/settings.ts:34-41 (`WindowState`).

function windowStateDocument() {
  return {
    width: 1280,
    height: 800,
    maximized: false,
    fullScreen: false,
  }
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
const FIXTURE_CONFIG_CFG = `seta sensitivity "5"
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
// (`@shared/config/render.ts`) plus a well-formed `[q2l v=1]` header tag
// (`@shared/config/profile-metadata.ts`), written under `INSTALL_TWO_ID`'s
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
//   (`ownedProfileId`/`findOwnCanonicalFile`, `@shared/config/render.ts` + `canonical.ts`) rather
//   than a copy/paste that happened to go stale. Line 4, in contrast, must stay byte-identical to
//   `HAND_EDIT_SENTENCE` (`@shared/config/render.ts`) - `profile-restore.ts`'s
//   `consumeHeaderDecoration` matches it exactly so this line is recognised as understood header
//   decoration and folded out of the import dialog's "unrecognised leftovers" list; letting it
//   drift out of sync (as it did across story 043's D1 wording change) reintroduces the exact
//   `scrollable-region-focusable` axe violation story 042's fix-cycle-5 closed, because an
//   unrecognised long comment line renders as its own scrollable single-line code block with no
//   keyboard access.
const FIXTURE_RESTORE_CONFIG_CFG = `// q2-launcher profile fixture-profile-plain - generated, do not edit
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
// `populated`'s `STATE_SCHEMA_VERSION` mirror above (`1`) is deliberately never bumped in step
// with `src/shared/constants.ts` (currently `2`): every `populated`/`empty` run starts one schema
// version behind the real app on purpose, so the real migration
// (`src/main/services/migrations.ts`, story 052 D6) runs fresh on every reseed and materialises
// `TEMPLATE_ACTION_CATEGORIES` plus one action per `allCatalogRows()` row into every pre-existing
// profile at runtime - exactly the "existing profiles migrate once" behaviour AC8 describes. That
// is what already makes the `config-controls`/`config-controls-message`/
// `config-controls-drop-message` screens and the `drop-message-checkbox` flow show Plain Profile's
// full Movement/Weapons/Weapon-dropping rail today, without hand-authoring roughly fifty catalogue
// rows here.
//
// The two profiles below need the opposite guarantee: a profile with only its own "Imported"
// category must show *only* that (AC1/AC7). If it shared a document with `STATE_SCHEMA_VERSION`
// still at `1`, that very same migration would blindly add Movement/Weapons/Weapon dropping to it
// too - the migration has no way to tell "predates story 052" apart from "genuinely has just one
// category". A dedicated third fixture variant, seeded at the real, current schema version (so no
// migration runs for anyone in this document), is what keeps that guarantee intact without
// touching `populated`/`empty` at all.
/** Mirrors src/shared/constants.ts:14 (`STATE_SCHEMA_VERSION`), unlike the deliberately-stale
 * `STATE_SCHEMA_VERSION` above - see the comment block just above this constant. */
const CONTROLS_SEED_SCHEMA_VERSION = 2

/** Mirrors src/shared/modules/config.ts:146-150 (`TEMPLATE_ACTION_CATEGORIES`). */
const TEMPLATE_CATEGORIES = [
  { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.movement' },
  { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
  { id: 'drops', name: 'Weapon dropping', nameKey: 'config.controls.categories.drops' },
]

/**
 * Mirrors src/shared/config/catalog-rows.ts's `allCatalogRows()` (in turn built from
 * src/shared/config/action-catalog.ts's `MOVEMENT_ACTIONS`/`WEAPONS`/`WEAPON_ACTIONS`/
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

const TEMPLATE_CATALOG_ROWS = TEMPLATE_CATALOG_ROW_TUPLES.map(([kind, id, categoryId, command]) => ({
  catalogId: `${kind}:${id}`,
  categoryId,
  command,
}))

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
    cvars: { sensitivity: '3', cl_run: '0', crosshair: '0', cl_gun: '1', m_pitch: '0.022', volume: '0.7' },
    binds,
    assignments: [],
    categories: TEMPLATE_CATEGORIES.map((category) => ({ ...category })),
    actions: TEMPLATE_CATALOG_ROWS.map((row) => {
      const key = TEMPLATE_BOUND_KEYS[row.catalogId]
      const slug = row.catalogId.replace(/[^a-z0-9]+/gi, '-')
      return {
        id: `fixture-template-seed-${slug}`,
        categoryId: row.categoryId,
        name: row.command,
        kind: 'bind',
        catalogId: row.catalogId,
        commands: key ? [{ kind: 'raw', text: row.command }] : [],
        ...(key ? { key } : {}),
      }
    }),
  }
}

/**
 * A profile with a single, non-template category ("Imported") and a few free-form entries of its
 * own - no `movement`/`weapons`/`drops` at all. Demonstrates AC1/AC7: "a profile with only an
 * Imported category shows only that" on the `config-controls-imported-only` screen.
 */
function importedOnlyConfigProfile() {
  return {
    id: 'fixture-profile-imported-only',
    name: 'Imported Category Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: {},
    // No `binds` mirror for the "Use item" action below: unlike a catalogue-backed row,
    // `bindValueFor` (@shared/config/action-mirror.ts) only passes a bare `+command` through
    // verbatim when the action carries a `catalogId` - a free-form action's mirror is always its
    // alias name, so a hand-authored `binds.e: '+use'` here would read as a *second*, independent
    // claimant on `e` to `bind-conflicts.ts`'s scan and raise a spurious conflict badge that has
    // nothing to do with this screen's own point (AC1/AC7's "shows only its own category").
    binds: {},
    assignments: [],
    categories: [{ id: 'imported', name: 'Imported' }],
    actions: [
      {
        id: 'fixture-imported-use',
        categoryId: 'imported',
        name: 'Use item',
        kind: 'bind',
        commands: [{ kind: 'raw', text: '+use' }],
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
    installations: [],
    configProfiles: [templateSeededConfigProfile(), importedOnlyConfigProfile()],
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
  }
}

/** Deletes and rewrites the `controls-seed` variant's userdata (no installations). */
export function writeControlsSeedFixture() {
  const userDataDir = variantUserDataDir('controls-seed')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), controlsSeedStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  return { userDataDir, installations: 0, configProfiles: 2 }
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeConfigCfg(baseq2Dir) {
  writeFileSync(join(baseq2Dir, 'config.cfg'), FIXTURE_CONFIG_CFG, 'utf8')
}

/** Story 042 D6: writes the own-file ("restore") fixture into `RESTORE_GAME_DIR`. */
function writeRestoreConfigCfg(installDir) {
  const dir = join(installDir, RESTORE_GAME_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.cfg'), FIXTURE_RESTORE_CONFIG_CFG, 'utf8')
}

/**
 * On Windows, closing an Electron session's GPU process (Dawn's WebGPU/Graphite disk cache
 * under `userData`) doesn't release its cache files immediately - `app.close()` returns before
 * Windows (observed: real-time AV scanning the freshly-closed cache blobs, anywhere from a few
 * seconds up to several minutes under load, with no live process holding the handle) actually
 * lets go, so the very next fixture reseed can hit `EPERM`/`EBUSY` on a directory nothing still
 * wants. `maxRetries`/`retryDelay` are Node's own documented remedy for exactly this class of
 * transient Windows delete failure, but the observed worst case is unbounded enough that no
 * fixed budget can be sized to always win.
 *
 * So this is a best-effort delete, not an all-or-nothing one: what a fixture reseed actually
 * needs is `state.json`/`window-state.json` to hold this run's fresh data, never a byte-clean
 * `userData` directory - a stale, still-locked cache subfolder left behind is harmless (Chromium
 * happily reuses or extends an existing disk cache) and must never fail the whole run. On a
 * still-locked path after the retry budget, this logs a warning and moves on so `mkdirSync` +
 * the two `writeJson` calls right after it can still put the run in a known-good state.
 */
const RM_RETRY_OPTIONS = { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }

function rmDirBestEffort(path) {
  try {
    rmSync(path, RM_RETRY_OPTIONS)
  } catch (error) {
    console.warn(
      `[fixture] could not fully clear ${path} (${error.code ?? error.message}) - a locked ` +
        'leftover (e.g. GPU disk cache) is harmless and the fixture reseed continues regardless.',
    )
  }
}

/** Deletes and rewrites the `populated` variant's userdata + game dirs. */
export function writePopulatedFixture() {
  const userDataDir = variantUserDataDir('populated')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), populatedStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const installIds = [INSTALL_ONE_ID, INSTALL_TWO_ID]
  for (const id of installIds) {
    const baseq2Dir = join(gameRoot(), id, 'baseq2')
    rmDirBestEffort(join(gameRoot(), id))
    mkdirSync(baseq2Dir, { recursive: true })
    if (id === INSTALL_TWO_ID) {
      writeConfigCfg(baseq2Dir)
      writeRestoreConfigCfg(join(gameRoot(), id))
    }
  }

  return {
    userDataDir,
    installations: installIds.length,
    configProfiles: populatedConfigProfiles().length,
  }
}

/** Deletes and rewrites the `empty` variant's userdata (defaults only). */
export function writeEmptyFixture() {
  const userDataDir = variantUserDataDir('empty')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), emptyStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  return { userDataDir, installations: 0, configProfiles: 0 }
}

export function writeFixture(variant) {
  if (variant === 'populated') return writePopulatedFixture()
  if (variant === 'empty') return writeEmptyFixture()
  if (variant === 'controls-seed') return writeControlsSeedFixture()
  throw new Error(`unknown fixture variant: ${variant}`)
}

export const FIXTURE_VARIANTS = ['populated', 'empty', 'controls-seed']
