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
/** Mirrors src/shared/constants.ts:14 (`STATE_SCHEMA_VERSION`). */
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

/** Deletes and rewrites the `populated` variant's userdata + game dirs. */
export function writePopulatedFixture() {
  const userDataDir = variantUserDataDir('populated')
  rmSync(userDataDir, { recursive: true, force: true })
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), populatedStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const installIds = [INSTALL_ONE_ID, INSTALL_TWO_ID]
  for (const id of installIds) {
    const baseq2Dir = join(gameRoot(), id, 'baseq2')
    rmSync(join(gameRoot(), id), { recursive: true, force: true })
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
  rmSync(userDataDir, { recursive: true, force: true })
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), emptyStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  return { userDataDir, installations: 0, configProfiles: 0 }
}

export function writeFixture(variant) {
  if (variant === 'populated') return writePopulatedFixture()
  if (variant === 'empty') return writeEmptyFixture()
  throw new Error(`unknown fixture variant: ${variant}`)
}

export const FIXTURE_VARIANTS = ['populated', 'empty']
