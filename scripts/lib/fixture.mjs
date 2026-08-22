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

function makeInstallation({ id, name, rootPath, writeDirPath, favorite, sortOrder }) {
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
    gameDirs: ['baseq2'],
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
    }),
  ]
}

// --- config.ts ConfigProfile shape ------------------------------------------
// Mirrors src/shared/modules/config.ts:181 (`ConfigProfile`), `:45`
// (`ProfileAssignment`) and `:56` (`UnrecognizedConfigLine`).
// AltLayer mirrors src/shared/config/alt-layers.ts:55 (`AltLayer`).

function populatedConfigProfiles() {
  const plain = {
    id: 'fixture-profile-plain',
    name: 'Plain Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: { sensitivity: '3', crosshair: '0' },
    binds: { MOUSE1: '+attack', SPACE: '+moveup' },
    assignments: [{ installationId: INSTALL_ONE_ID, isDefault: true }],
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
// only, so the config-import/preview flow has something real to read. Not
// used by any current screen; see docs/main/modules/config/core/import-reader.ts
// for how `seta`/`bind` lines are recognized.
//
// - `bind w` appears twice with no `unbind w` in between: import-reader.ts's
//   `applyBind` records that as a duplicate bind (mirrors its own test,
//   "reports a key bound twice with no unbind in between as a duplicate").
// - The `alias` line is not one of the recognized commands
//   (`set`/`seta`/`setu`/`sets`/`bind`/`unbind`/`unbindall`/`exec`), so
//   config-parser.ts preserves it verbatim instead of guessing at it.
const FIXTURE_CONFIG_CFG = `seta sensitivity "5"
seta cl_run "1"
seta name "FixtureUser"
seta cl_particles "1"
bind w "+forward"
bind s "+back"
bind MOUSE1 "+attack"
bind w "+moveup"
alias +fixture_unrecognized "echo hi"
`

// --- writers ----------------------------------------------------------------

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeConfigCfg(baseq2Dir) {
  writeFileSync(join(baseq2Dir, 'config.cfg'), FIXTURE_CONFIG_CFG, 'utf8')
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
    if (id === INSTALL_TWO_ID) writeConfigCfg(baseq2Dir)
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
