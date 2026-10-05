import c from '../../../src/shared/fixture-constants.json' with { type: 'json' }
import { join } from 'node:path'
import { UI_VERIFY_ROOT } from '../paths.mjs'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

// --- literals mirrored from src/shared -------------------------------------

// Plain data shared with src/shared (constants.ts, types/settings.ts) via one JSON file.
export const STATE_FILE = c.stateFile

export const WINDOW_STATE_FILE = c.windowStateFile

export const DEFAULT_SETTINGS = c.defaultSettings

/** Deliberately kept far behind the real `STATE_SCHEMA_VERSION` (`src/shared/constants.ts`, now
 * `5`) rather than following it - see the comment block above `CONTROLS_SEED_SCHEMA_VERSION` below
 * for why the `LEGACY_SEED_VARIANTS` need every reseed to run story 052 D6's migration fresh. */
export const LEGACY_SEED_SCHEMA_VERSION = 1

/** Fixed instant used for every fixture timestamp — never `Date.now()` (idempotency). */
export const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z'

/** Root all fixture game directories live under: `.ui-verify/fixture/game/<install>/`. */
export function gameRoot() {
  return join(UI_VERIFY_ROOT, 'fixture', 'game')
}

/**
 * Story 079 D3: the real on-disk path of installation `id`'s copy of a launcher-owned config file -
 * `<gameRoot>/<id>/baseq2/<fileName>`, the same `BASE_GAME_DIR` join `writer.ts`'s
 * `writeInstallationFiles` uses. Exported so a flow that writes/reads an installation's copy of a
 * config profile (`raw-save-cascades.mjs`, `external-edit-cascades.mjs`) builds the identical path
 * this module's own fixture writer would, instead of a second `join()` call that could drift from it.
 */
export function installationConfigFilePath(id, fileName) {
  return join(gameRoot(), id, 'baseq2', fileName)
}

/**
 * Story 092 D8: the real on-disk path of installation `id`'s copy of a file at `relativePath`
 * relative to its ROOT - not necessarily under `baseq2` (`installationConfigFilePath()` above is
 * `baseq2`-only). `engine-update.mjs` needs this for `q2pro64.exe`, which sits at the installation
 * root, alongside the `baseq2/...` engine files `installationConfigFilePath()` already reaches.
 * `relativePath` is always `/`-separated (mirrors `ENGINE_FIXTURE_FILES`' own keys), split here so
 * the join is correct on every platform.
 */
export function installationRootFilePath(id, relativePath) {
  return join(gameRoot(), id, ...relativePath.split('/'))
}

/**
 * Story 094 D4: the real on-disk root of installation `id` - the same join every
 * `populatedInstallations()` entry already builds inline for its own `rootPath`, exported here so
 * `scripts/flows/installation-remove-from-disk.mjs` can assert against the exact path the dialog
 * must show (AC2) without a second, hand-typed `join()` that could drift from the fixture's own.
 */
export function installationRootPath(id) {
  return join(gameRoot(), id)
}

// --- state.ts LauncherStateDocument ("defaults()") shape -------------------
// Mirrors src/main/services/state.ts:16-48 (`LauncherStateDocument`) and its
// `defaults()` (state.ts:50-60).

export function emptyStateDocument() {
  return {
    schemaVersion: LEGACY_SEED_SCHEMA_VERSION,
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

// Story 079 D3: exported (were module-private before) so
// `scripts/flows/raw-save-cascades.mjs`/`scripts/flows/external-edit-cascades.mjs` can build the
// real on-disk `<gameRoot>/<id>/baseq2/<file>` path for each of Plain Profile's two assigned
// installations, rather than duplicating these literals.
export const INSTALL_ONE_ID = 'fixture-install-favorite'

export const INSTALL_TWO_ID = 'fixture-install-writedir'

// --- settings.ts WindowState shape ------------------------------------------
// Mirrors src/shared/types/settings.ts:34-41 (`WindowState`).

export function windowStateDocument() {
  return {
    width: 1280,
    height: 800,
    maximized: false,
    fullScreen: false,
  }
}

export function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
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

/** Empties and recreates a directory the fixture owns outright. Unlike `rmDirBestEffort` it
 * throws on failure: seeding over a half-deleted directory would silently seed a wrong state. */
export function resetOwnedDir(path) {
  rmSync(path, RM_RETRY_OPTIONS)
  mkdirSync(path, { recursive: true })
}

export function rmDirBestEffort(path) {
  try {
    rmSync(path, RM_RETRY_OPTIONS)
  } catch (error) {
    console.warn(
      `[fixture] could not fully clear ${path} (${error.code ?? error.message}) - a locked ` +
        'leftover (e.g. GPU disk cache) is harmless and the fixture reseed continues regardless.',
    )
  }
}
