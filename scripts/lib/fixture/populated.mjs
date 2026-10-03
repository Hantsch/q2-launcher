import { populatedDownloadFailures } from '../download-failures.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { variantUserDataDir } from '../harness.mjs'
import {
  DEFAULT_SETTINGS,
  FIXED_TIMESTAMP,
  INSTALL_ONE_ID,
  INSTALL_TWO_ID,
  LEGACY_SEED_SCHEMA_VERSION,
  STATE_FILE,
  WINDOW_STATE_FILE,
  emptyStateDocument,
  gameRoot,
  rmDirBestEffort,
  windowStateDocument,
  writeJson,
} from './core.mjs'
import {
  CUSTOM_ICON_PNG_BASE64,
  ENGINE_FIXTURE_FILES,
  ENGINE_INSTALLED_RELATIVE,
  ENGINE_UPDATE_OLD_FILL_BYTE,
  INSTALL_DEMO_UPGRADE_ID,
  INSTALL_ENGINE_UPDATE_ID,
  INSTALL_FAILED_ID,
  INSTALL_REMOVE_DISK_ID,
  INSTALL_REMOVE_DISK_SIBLING_SENTINEL_CONTENT,
  INSTALL_REMOVE_STORE_ID,
  INSTALL_REPAIR_ENGINE_ID,
  INSTALL_REPAIR_POINT_RELEASE_ID,
  INSTALL_REPAIR_RETAIL_ID,
  INSTALL_REPAIR_UNREPAIRABLE_ID,
  INSTALL_REPAIR_WRITEDIR_ID,
  INSTALL_UNKNOWN_ENGINE_ID,
  RESTORE_GAME_DIR,
  RETAIL_UPGRADE_MARKER_CONTENT,
  RETAIL_UPGRADE_MARKER_FILE,
  installRemoveDiskSiblingSentinelPath,
  populatedInstallations,
} from './installations.mjs'
import {
  FIXTURE_CONFIG_CFG,
  FIXTURE_RESTORE_CONFIG_CFG,
  populatedConfigProfiles,
} from './controls.mjs'
import { DOWNLOADS_SETTINGS_SEED, writeDownloadsCacheArchives } from './downloads.mjs'
import { NEWS_FIXTURE_SLIDES, writeNewsFeedCache } from './news.mjs'
import { writeReplaysDemosFixture, writeReplaysExtraFolderFixture } from './replays.mjs'
import {
  RETAIL_PAK_SIZES,
  UNVERIFIED_PAK0_BYTES,
  filler,
  writeFileIn,
  writeSizedFile,
} from './bootstrap.mjs'

/**
 * `overrides` is merged onto the base document with a plain shallow spread - a top-level key
 * present in `overrides` replaces that key wholesale (never deep-merged), which is exactly what
 * the `servers-scan` variant needs (a whole `servers` key, built from scratch) and cheap enough not
 * to need anything fancier. No caller today overrides more than one top-level key at a time.
 */
function populatedStateDocument(overrides = {}) {
  return {
    schemaVersion: LEGACY_SEED_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, activeInstallationId: INSTALL_ONE_ID },
    installations: populatedInstallations(),
    configProfiles: populatedConfigProfiles(),
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
    // Story 072 D6: non-default downloads settings (mirrors src/shared/modules/downloads.ts's
    // `downloads` state.json key, see `DOWNLOADS_SETTINGS_SEED` above).
    downloads: { ...DOWNLOADS_SETTINGS_SEED },
    // Story 075 D7: two static failure-log entries, one with diagnostics and one without (AC8).
    downloadFailures: populatedDownloadFailures(),
    // Story 086 D3: a gapped, non-default dashboard arrangement (mirrors
    // src/shared/modules/home.ts's `TilePlacement`/`HomeLayout` shape exactly - this file is plain
    // JS with no type import). Deliberately different from `DEFAULT_HOME_LAYOUT`'s `{0,0,6,5}`/
    // `{6,0,6,5}` pair: both tiles stay within the 12-column grid, neither overlaps the other, both
    // clear the 2x2 minimum, and there is visible empty space around and between them - proof that
    // `home-dashboard`'s screenshot renders the *stored* cells, gap intact, not a compacted layout.
    homeLayout: {
      tiles: [
        { moduleId: 'playtime', x: 1, y: 0, w: 4, h: 4 },
        { moduleId: 'configProfiles', x: 7, y: 2, w: 4, h: 5 },
      ],
    },
    ...overrides,
  }
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
 * Story 067 D5: writes the custom-icon PNG an `icon: { kind: 'custom' }` installation's file lives
 * at - `userData/installation-icons/<installationId>.png` (mirrors `InstallationIcon`'s own doc
 * comment, `src/shared/types/installation.ts`), which is what `installations:iconDataUrl` (D4)
 * reads back as a `data:` URL.
 */
function writeCustomIconFile(userDataDir, installationId) {
  const dir = join(userDataDir, 'installation-icons')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${installationId}.png`), Buffer.from(CUSTOM_ICON_PNG_BASE64, 'base64'))
}

/**
 * Deletes and rewrites the `populated` variant's userdata + game dirs - or, when `variant`/
 * `stateOverrides` are passed, a different variant that needs every one of those same side effects
 * (installations, config profiles, news cache, download-cache archives) but a different top-level
 * `state.json` key or two on top of the base document. `writeFixture('servers-scan')` below is the
 * one caller that passes both, rather than this function being duplicated near-verbatim for one
 * extra `servers` key.
 */
export function writePopulatedFixture({ variant = 'populated', stateOverrides = {} } = {}) {
  const userDataDir = variantUserDataDir(variant)
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), populatedStateDocument(stateOverrides))
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())
  writeDownloadsCacheArchives(userDataDir)
  // Story 083 D6: a fresh, successful feed cache - the `home-hero` screen's filled state.
  writeNewsFeedCache(userDataDir, {
    slides: NEWS_FIXTURE_SLIDES,
    retrievedAt: FIXED_TIMESTAMP,
    lastRefreshFailed: false,
  })

  const installIds = [
    INSTALL_ONE_ID,
    INSTALL_TWO_ID,
    INSTALL_UNKNOWN_ENGINE_ID,
    INSTALL_REMOVE_STORE_ID,
    INSTALL_REMOVE_DISK_ID,
  ]
  for (const id of installIds) {
    const baseq2Dir = join(gameRoot(), id, 'baseq2')
    rmDirBestEffort(join(gameRoot(), id))
    mkdirSync(baseq2Dir, { recursive: true })
    if (id === INSTALL_TWO_ID) {
      writeConfigCfg(baseq2Dir)
      writeRestoreConfigCfg(join(gameRoot(), id))
      // Story 067 D5: this is also the installation seeded with `icon: { kind: 'custom' }`.
      writeCustomIconFile(userDataDir, id)
    }
  }

  // Story 141 D5: the Demos view's discovered-list fixture - both installations' roots were just
  // (re)created by the loop above, so this only ever adds to them.
  writeReplaysDemosFixture()
  writeReplaysExtraFolderFixture()

  // Story 094 D4: a sentinel file in a directory NEXT TO `INSTALL_REMOVE_DISK_ID`'s own root
  // (created just above, in the loop) - not inside it. `installation-remove-from-disk.mjs` deletes
  // that installation's root and then reads this file back untouched to prove AC3's "nothing
  // outside that folder is touched".
  {
    const sentinelPath = installRemoveDiskSiblingSentinelPath()
    rmDirBestEffort(dirname(sentinelPath))
    mkdirSync(dirname(sentinelPath), { recursive: true })
    writeFileSync(sentinelPath, INSTALL_REMOVE_DISK_SIBLING_SENTINEL_CONTENT, 'utf8')
  }

  // Story 077 D5: `INSTALL_FAILED_ID`'s root, deliberately WITHOUT a `baseq2` subfolder - unlike
  // every id in the loop above. A folder that exists but holds nothing is exactly what
  // `bootstrap/job.ts`'s failure cleanup leaves behind (see that installation's own doc comment in
  // `populatedInstallations()`), and it is what makes the real app's own startup `validateAll()`
  // re-derive `status: 'invalid'` here rather than disagreeing with the value already seeded above.
  rmDirBestEffort(join(gameRoot(), INSTALL_FAILED_ID))
  mkdirSync(join(gameRoot(), INSTALL_FAILED_ID), { recursive: true })

  // Story 090 D6: `INSTALL_DEMO_UPGRADE_ID`'s real files - see that constant's own doc comment for
  // why each one is there. `writeSizedFile`/`UNVERIFIED_PAK0_BYTES` are declared further down this
  // file (story 088's own retail-fixture section) but are plain module-level bindings, already
  // initialised by the time any exported function here actually runs.
  {
    const demoRoot = join(gameRoot(), INSTALL_DEMO_UPGRADE_ID)
    const demoBaseq2 = join(demoRoot, 'baseq2')
    rmDirBestEffort(demoRoot)
    mkdirSync(demoBaseq2, { recursive: true })
    // An empty file is enough: `classifyEngine`/`rankExecutables` (src/main/services/inspector.ts)
    // only look at the file name, never its contents.
    writeFileSync(join(demoRoot, 'r1q2.exe'), '')
    writeSizedFile(join(demoBaseq2, 'pak0.pak'), UNVERIFIED_PAK0_BYTES)
    writeFileSync(
      join(demoBaseq2, RETAIL_UPGRADE_MARKER_FILE),
      RETAIL_UPGRADE_MARKER_CONTENT,
      'utf8',
    )
  }

  // Story 092 D8: `INSTALL_ENGINE_UPDATE_ID`'s real files - an already-playable Q2PRO installation
  // whose three engine files start on `ENGINE_UPDATE_OLD_FILL_BYTE`, distinct from every fill byte
  // the REAL fixture archive extracts onto those same paths - so `engine-update.mjs` can tell "still
  // the old build" apart from "the update/rollback job touched this file" with a plain byte
  // comparison. Written under `ENGINE_INSTALLED_RELATIVE`'s spelling (the executable as `q2pro.exe`,
  // not the archive's own `q2pro64.exe` - see that constant's own doc comment for why the rename
  // matters: `update-job.ts`'s allowlist would never find or back up a `q2pro64.exe` on disk).
  // Retail-sized paks (`writeSizedFile`, `RETAIL_PAK_SIZES`, both declared further down this file -
  // see the comment on the demo-upgrade block above for why forward references to them are safe)
  // keep this installation reading as a plain, working `ok` install with no demo-data check, unlike
  // `INSTALL_DEMO_UPGRADE_ID` above.
  {
    const engineRoot = join(gameRoot(), INSTALL_ENGINE_UPDATE_ID)
    const engineBaseq2 = join(engineRoot, 'baseq2')
    rmDirBestEffort(engineRoot)
    mkdirSync(engineBaseq2, { recursive: true })
    for (const [archiveRelative, { sizeBytes }] of Object.entries(ENGINE_FIXTURE_FILES)) {
      const segments = ENGINE_INSTALLED_RELATIVE[archiveRelative].split('/')
      const fileName = segments.pop()
      writeFileIn(
        join(engineRoot, ...segments),
        fileName,
        filler(sizeBytes, ENGINE_UPDATE_OLD_FILL_BYTE),
      )
    }
    writeSizedFile(join(engineBaseq2, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
    writeSizedFile(join(engineBaseq2, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
    writeSizedFile(join(engineBaseq2, 'pak2.pak'), RETAIL_PAK_SIZES['pak2.pak'])
  }

  // Story 093 D7: the five additive repair-flow installations - see the block comment above
  // `INSTALL_REPAIR_ENGINE_ID` for what each finding is and why. `writeSizedFile`/`RETAIL_PAK_SIZES`
  // are declared further down this file, forward-referenced exactly as the demo/engine-update
  // blocks above already do (module-level bindings, initialised before any exported function runs).
  {
    // AC1: `r1q2ded.exe` is the only executable on disk (an r1q2 marker AND, being the sole `.exe`,
    // the fallback executable `inspectInstallation` picks) - the recorded `executablePath` above
    // names a `r1q2.exe` that does not exist, so the two disagree (`validation.executableMissing`).
    // `baseq2` exists but holds no pak file at all (`validation.pak0Missing`, error - what makes the
    // action bar's Repair button exist to click).
    const root = join(gameRoot(), INSTALL_REPAIR_ENGINE_ID)
    rmDirBestEffort(root)
    mkdirSync(join(root, 'baseq2'), { recursive: true })
    writeFileSync(join(root, 'r1q2ded.exe'), '')
  }
  {
    // AC2: a real executable (no engine finding), retail-sized pak0/pak1, no pak2.pak at all ->
    // `validation.pointReleaseMissing` (warn).
    const root = join(gameRoot(), INSTALL_REPAIR_POINT_RELEASE_ID)
    const baseq2 = join(root, 'baseq2')
    rmDirBestEffort(root)
    mkdirSync(baseq2, { recursive: true })
    writeFileSync(join(root, 'r1q2.exe'), '')
    writeSizedFile(join(baseq2, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
    writeSizedFile(join(baseq2, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
  }
  {
    // AC4: a real executable, `baseq2` present but entirely empty -> `validation.pak0Missing`
    // (error), offering `retail-copy`.
    const root = join(gameRoot(), INSTALL_REPAIR_RETAIL_ID)
    rmDirBestEffort(root)
    mkdirSync(join(root, 'baseq2'), { recursive: true })
    writeFileSync(join(root, 'r1q2.exe'), '')
  }
  {
    // AC5: same shape as the retail-pak-less installation above (so the action bar reaches it too),
    // plus a `writeDirPath` (set on the installation record itself, above) that is never created.
    const root = join(gameRoot(), INSTALL_REPAIR_WRITEDIR_ID)
    rmDirBestEffort(root)
    mkdirSync(join(root, 'baseq2'), { recursive: true })
    writeFileSync(join(root, 'r1q2.exe'), '')
  }
  {
    // AC6: no executable anywhere, but a fully valid, fully retail `baseq2` - the only finding is
    // `validation.noExecutable`, and it offers nothing (see the block comment above).
    const root = join(gameRoot(), INSTALL_REPAIR_UNREPAIRABLE_ID)
    const baseq2 = join(root, 'baseq2')
    rmDirBestEffort(root)
    mkdirSync(baseq2, { recursive: true })
    writeSizedFile(join(baseq2, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
    writeSizedFile(join(baseq2, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
    writeSizedFile(join(baseq2, 'pak2.pak'), RETAIL_PAK_SIZES['pak2.pak'])
  }

  return {
    userDataDir,
    // + INSTALL_FAILED_ID + INSTALL_DEMO_UPGRADE_ID + INSTALL_ENGINE_UPDATE_ID + the five 093 D7
    // repair installations
    installations: installIds.length + 3 + 5,
    configProfiles: populatedConfigProfiles().length,
  }
}

/** Deletes and rewrites the `empty` variant's userdata (defaults only).
 *
 * Deliberately writes no `news-feed.json` at all - "no cache file exists" is exactly the
 * `home-hero-welcome` screen's precondition (story 083 D6): `feedState()` reads an empty `slides`
 * array as `'welcome'` regardless of `lastRefreshFailed`, and `NewsFeedCache.read()` already answers
 * `undefined` for a missing file, so this variant needs no news-specific writer of its own. */
export function writeEmptyFixture() {
  const userDataDir = variantUserDataDir('empty')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), emptyStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  return { userDataDir, installations: 0, configProfiles: 0 }
}
