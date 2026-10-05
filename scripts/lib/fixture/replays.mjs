import { join } from 'node:path'
import { copyFileSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { REPO_ROOT } from '../paths.mjs'
import { execFileSync } from 'node:child_process'
import { variantUserDataDir } from '../harness.mjs'
import {
  FIXED_TIMESTAMP,
  INSTALL_ONE_ID,
  INSTALL_TWO_ID,
  STATE_FILE,
  WINDOW_STATE_FILE,
  emptyStateDocument,
  gameRoot,
  rmDirBestEffort,
  windowStateDocument,
  writeJson,
} from './core.mjs'
import { bootstrapStagingDir, vendoredExtractorExists, vendoredSevenZaPath } from './bootstrap.mjs'
import { writePopulatedFixture } from './populated.mjs'

// --- story 141 D5: the Demos view's discovered-list fixture --------------------------------------
//
// Five real demo files, placeholder bytes only (this story never parses a demo's own contents),
// discoverable by `discoverDemos` (`src/main/modules/replays/discovery.ts`) across two
// installations' game dirs - plus four decoys placed to prove the scanner's own rules (a sidecar
// name, a launcher-temp-copy folder, one-level-only recursion, a wrong extension) rather than merely
// trusting them. Exported so `scripts/flows/replays-discovered-list.mjs` asserts against the exact
// same literals this file writes, never a hand-typed copy that could drift.

/** The extra, non-`baseq2` game dir `INSTALL_TWO_ID` gets above - see that installation's own
 * `gameDirs` doc comment for why 'ctf' specifically. Exported so the flow builds the same
 * `replays.list.source` text this fixture's own data implies. */
export const REPLAYS_FIXTURE_EXTRA_GAME_DIR = 'ctf'

/**
 * Every real demo file this fixture writes, and where `discoverDemos` should find it. Mirrors
 * `DiscoveredDemo.fileName`/`.source` (`src/shared/modules/replays.ts`) closely enough for the flow
 * to build its own expectations straight from this array, rather than a second, hand-typed list.
 */
export const REPLAYS_FIXTURE_DEMOS = [
  {
    fileName: 'duel_q2dm1.dm2',
    installationId: INSTALL_ONE_ID,
    installationName: 'Fixture Favorite Install',
    gameDir: 'baseq2',
  },
  {
    fileName: 'FINAL.DM2',
    installationId: INSTALL_ONE_ID,
    installationName: 'Fixture Favorite Install',
    gameDir: 'baseq2',
  },
  {
    fileName: 'tourney.mvd2.gz',
    installationId: INSTALL_ONE_ID,
    installationName: 'Fixture Favorite Install',
    gameDir: 'baseq2',
  },
  {
    fileName: 'ctf_q2ctf1.dm2.gz',
    installationId: INSTALL_ONE_ID,
    installationName: 'Fixture Favorite Install',
    gameDir: 'baseq2',
  },
  {
    fileName: 'team_q2dm3.mvd2',
    installationId: INSTALL_TWO_ID,
    installationName: 'Fixture WriteDir Install',
    gameDir: REPLAYS_FIXTURE_EXTRA_GAME_DIR,
  },
]

/**
 * Decoy paths written alongside `REPLAYS_FIXTURE_DEMOS`' four `INSTALL_ONE_ID` files, in that same
 * `baseq2/demos/` folder - every one of them must be invisible to `discoverDemos`, each proving a
 * different one of its rules: a `.dm2.json` sidecar (`recogniseDemoFile` matches by exact suffix, a
 * sidecar's name is not one), a subfolder named the way a launcher-owned temp-copy location might be
 * (`_launcher/`) holding a real demo file one level down, a plain nested subfolder (`old/`) holding
 * another, and a wrong extension (`.txt`) at the top level. The middle two both exist purely to prove
 * `scanDemosDir`'s one-level-only, non-recursive listing - not because either name carries meaning to
 * the scanner itself. Paths are `/`-separated, relative to that `demos/` folder; exported so the flow
 * can describe what it does NOT expect to see without a second, hand-typed list.
 */
export const REPLAYS_FIXTURE_DECOYS = [
  'duel_q2dm1.dm2.json',
  '_launcher/leftover.dm2',
  'old/nested.dm2',
  'readme.txt',
]

/** What the loading strip's `data-total` reads once the scan has counted everything: the recursive
 * scan also counts the decoy demo in the `old/` subfolder, not just `REPLAYS_FIXTURE_DEMOS`. */
export const REPLAYS_FIXTURE_SCANNED_TOTAL = REPLAYS_FIXTURE_DEMOS.length + 1

/** Placeholder bytes for a fixture demo file - never real demo content (out of scope for this
 * deliverable), just enough for the file to exist and be recognised by name. */
const REPLAYS_FIXTURE_DEMO_CONTENT = 'q2l-fixture-demo-placeholder\n'

/**
 * Story 142 D5: the real on-disk path of a folder a user could plausibly point `extraFolders.add`
 * at - a sibling of the installations' own game dirs (`<gameRoot>/extra-demos`), deliberately NOT
 * inside either installation's own root, so scanning it as an extra folder is a genuinely separate
 * case from the installation-owned `demos/` folders `writeReplaysDemosFixture()` writes above.
 * Exported so `scripts/flows/replays-extra-folders.mjs` imports the exact path rather than
 * hand-typing a second copy.
 */
export function replaysExtraFolderFixturePath() {
  return join(gameRoot(), 'extra-demos')
}

/** Placeholder bytes for `replaysExtraFolderFixturePath()`'s files - same convention as
 * `REPLAYS_FIXTURE_DEMO_CONTENT` above. */
const REPLAYS_EXTRA_FOLDER_DEMO_CONTENT = 'q2l-fixture-extra-folder-demo-placeholder\n'

/**
 * Writes `replaysExtraFolderFixturePath()`'s contents: two real, top-level demo files
 * (`a.dm2`, `B.MVD2` - mixed case, proving `recogniseDemoFile`'s case-insensitive match) plus three
 * decoys that must never appear in a scan of this folder - a `.dm2.json` sidecar, a nested
 * `sub/deep.dm2` (this scan is top-level-only, same rule `scanDemosDir` enforces everywhere else),
 * and nothing else needed since a wrong extension is already covered by `REPLAYS_FIXTURE_DECOYS`
 * above. Called from `writePopulatedFixture()`, alongside `writeReplaysDemosFixture()` - this
 * folder is written but never itself added to `replaysState().extraFolders`; the flow adds it live
 * through the UI.
 */
export function writeReplaysExtraFolderFixture() {
  const folder = replaysExtraFolderFixturePath()
  rmDirBestEffort(folder)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'a.dm2'), REPLAYS_EXTRA_FOLDER_DEMO_CONTENT, 'utf8')
  writeFileSync(join(folder, 'B.MVD2'), REPLAYS_EXTRA_FOLDER_DEMO_CONTENT, 'utf8')
  writeFileSync(join(folder, 'a.dm2.json'), '{}\n', 'utf8')
  mkdirSync(join(folder, 'sub'), { recursive: true })
  writeFileSync(join(folder, 'sub', 'deep.dm2'), REPLAYS_EXTRA_FOLDER_DEMO_CONTENT, 'utf8')
}

/**
 * Writes `REPLAYS_FIXTURE_DEMOS`' five real files under their installation/game-dir `demos/`
 * folders, plus `REPLAYS_FIXTURE_DECOYS`' four decoys next to the `INSTALL_ONE_ID` ones. Called from
 * `writePopulatedFixture()`, after that function's own install loop has already created both
 * installations' root folders - `mkdirSync(..., { recursive: true })` below only ever adds to what
 * that loop left behind, never clears it.
 *
 * Regression note (sprint S26 gate, following story 143 D4): this function used to also build
 * `pack.zip` (see `writeReplaysZipPackArchive()` below) directly into `oneDemosDir` - i.e. into the
 * shared `INSTALL_ONE_ID`/`baseq2/demos` folder every `writePopulatedFixture()` call (re)creates.
 * Since `gameRoot()` is not variant-scoped, that made the zip's two real demo entries
 * (`test.dm2`/`final.mvd2`) leak into every fixture variant's/flow's view of this folder, not just
 * `scripts/flows/replays-zip-entries.mjs`'s own - in particular `replays-discovered-list.mjs`/
 * `replays-incremental-scan.mjs`, which assert this folder holds exactly `REPLAYS_FIXTURE_DEMOS`'
 * five known files. The zip is now built/removed by `writeReplaysZipPackArchive()`/
 * `removeReplaysZipPackArchive()` below, called only from `replays-zip-entries.mjs`'s own
 * `setup()`/`teardown()` hooks - so it exists on disk only for the duration of that one flow, and
 * every other flow that runs before or after it (including another `npm run ui:seed`) sees the
 * plain five-file folder this function alone produces.
 */
export function writeReplaysDemosFixture() {
  const oneDemosDir = join(gameRoot(), INSTALL_ONE_ID, 'baseq2', 'demos')
  mkdirSync(oneDemosDir, { recursive: true })
  const twoDemosDir = join(gameRoot(), INSTALL_TWO_ID, REPLAYS_FIXTURE_EXTRA_GAME_DIR, 'demos')
  mkdirSync(twoDemosDir, { recursive: true })

  for (const demo of REPLAYS_FIXTURE_DEMOS) {
    const demosDir = demo.installationId === INSTALL_ONE_ID ? oneDemosDir : twoDemosDir
    writeFileSync(join(demosDir, demo.fileName), REPLAYS_FIXTURE_DEMO_CONTENT, 'utf8')
  }

  writeFileSync(join(oneDemosDir, 'duel_q2dm1.dm2.json'), '{}\n', 'utf8')
  mkdirSync(join(oneDemosDir, '_launcher'), { recursive: true })
  writeFileSync(
    join(oneDemosDir, '_launcher', 'leftover.dm2'),
    REPLAYS_FIXTURE_DEMO_CONTENT,
    'utf8',
  )
  mkdirSync(join(oneDemosDir, 'old'), { recursive: true })
  writeFileSync(join(oneDemosDir, 'old', 'nested.dm2'), REPLAYS_FIXTURE_DEMO_CONTENT, 'utf8')
  writeFileSync(join(oneDemosDir, 'readme.txt'), 'not a demo\n', 'utf8')
}

/** The real on-disk path of `writeReplaysZipPackArchive()`'s archive - `INSTALL_ONE_ID`'s own
 * `baseq2/demos/pack.zip`, exported so `replays-zip-entries.mjs` never has to re-derive this join
 * itself. */
export function replaysZipPackArchivePath() {
  return join(gameRoot(), INSTALL_ONE_ID, 'baseq2', 'demos', 'pack.zip')
}

/**
 * Story 143 D4's real zip archive, holding two real demo entries (one nested a level deep) plus a
 * non-demo file, built with the same vendored 7za the app itself spawns - only when that binary was
 * actually vendored locally, same "skip the archive, never crash fixture generation" guard every
 * other zip/extractor-dependent fixture in this file already follows.
 *
 * Deliberately NOT called from `writeReplaysDemosFixture()`/`writePopulatedFixture()` (see the
 * regression note on `writeReplaysDemosFixture()` above) - `scripts/flows/replays-zip-entries.mjs`
 * is the only caller, from its own `setup()` hook, precisely so the archive exists on disk only for
 * that flow's own run and never lingers in the shared `populated` fixture other flows read.
 * `oneDemosDir` (`INSTALL_ONE_ID`'s `baseq2/demos`) must already exist - true after any `populated`-
 * based seed, since `writeReplaysDemosFixture()` above always creates it first.
 */
export function writeReplaysZipPackArchive() {
  if (!vendoredExtractorExists()) return
  const staging = join(bootstrapStagingDir(), 'replays-zip-pack')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(join(staging, 'sub'), { recursive: true })
  copyFileSync(join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'test.dm2'), join(staging, 'test.dm2'))
  copyFileSync(
    join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'PFAU_20221127-053327_q2dm1.mvd2'),
    join(staging, 'sub', 'final.mvd2'),
  )
  writeFileSync(join(staging, 'readme.txt'), 'not a demo\n', 'utf8')

  const archivePath = replaysZipPackArchivePath()
  // `7za a` APPENDS to an existing archive, so a stale one has to go first.
  rmSync(archivePath, { force: true })
  execFileSync(
    vendoredSevenZaPath(),
    ['a', '-tzip', '-mx1', '-bso0', '-bse0', '-bd', archivePath, 'test.dm2', 'sub', 'readme.txt'],
    { cwd: staging, windowsHide: true },
  )
}

/** Undoes `writeReplaysZipPackArchive()` - called from `replays-zip-entries.mjs`'s own `teardown()`
 * hook so the archive never outlives that one flow's run. */
export function removeReplaysZipPackArchive() {
  rmSync(replaysZipPackArchivePath(), { force: true })
}

// --- story 150+ D5: the demos-list rows on a real surface - `replays-rows`/`replays-scale` -------
//
// Both variants are additive and self-contained: no installations at all, one extra demo folder
// registered via `replays.extraFolders`, and - critically - that folder lives under the variant's
// OWN `variantUserDataDir()`, never under `gameRoot()`. `gameRoot()` is not variant-scoped (see the
// regression note on `writeReplaysDemosFixture()` above), so anything written there leaks into
// every other variant/flow that reads the same shared installation folders; a folder under this
// variant's own userData dir cannot leak anywhere else.

/** `replays-rows`'s extra folder id/path, registered in its own `state.json` below. */
const REPLAYS_ROWS_FOLDER_ID = 'fixture-replays-rows-folder'

function replaysRowsFolderPath() {
  return join(variantUserDataDir('replays-rows'), 'demos-fixture')
}

/** File names `scripts/flows/replays-demo-rows.mjs` asserts against - exported so the flow never
 * hand-types a second copy that could drift from what this fixture actually writes. */
export const REPLAYS_ROWS_TDM_DEMO = 'rows-tdm.dm2'

export const REPLAYS_ROWS_DUEL_DEMO = 'rows-duel.dm2'

export const REPLAYS_ROWS_MVD_DEMO = 'rows-mvd.mvd2'

export const REPLAYS_ROWS_BROKEN_DEMO = 'rows-broken.dm2'

export const REPLAYS_ROWS_UNREADABLE_DEMO = 'rows-unreadable.dm2'

export const REPLAYS_ROWS_ZIP_ARCHIVE = 'rows-pack.zip'

/** The demo file name inside `REPLAYS_ROWS_ZIP_ARCHIVE` - a copy of `test.dm2`, same convention as
 * `writeReplaysZipPackArchive()` above. */
export const REPLAYS_ROWS_ZIP_ENTRY_NAME = 'test.dm2'

/** `REPLAYS_ROWS_TDM_DEMO`'s sidecar: a full, valid sidecar with two named team sides, a
 * favourite/rating pair and an explicit `gamemode` - the one row that must show every
 * "reported, not guessed" marker at once, with its gamemode shown plain. */
const REPLAYS_ROWS_TDM_SIDECAR = {
  schemaVersion: 1,
  name: 'Fixture TDM Match',
  gamemode: 'tdm',
  favourite: true,
  rating: 8,
  sides: [
    { team: 'Alpha', players: ['PlayerA1', 'PlayerA2'] },
    { team: 'Bravo', players: ['PlayerB1', 'PlayerB2'] },
  ],
}

/** `REPLAYS_ROWS_DUEL_DEMO`'s sidecar: two single-player sides and no `gamemode` field at all, so
 * `resolveGamemode` (`src/shared/demos/gamemode.ts`) has nothing reported and falls through to its
 * `two-players-duel` heuristic - `source: 'guessed'`, the row shows it like a reported one, with no guessed marker. */
const REPLAYS_ROWS_DUEL_SIDECAR = {
  schemaVersion: 1,
  sides: [{ players: ['Solo1'] }, { players: ['Solo2'] }],
}

/** `REPLAYS_ROWS_BROKEN_DEMO`'s sidecar: deliberately not even a full sidecar document - a bare
 * `{"rating": 99}`, which fails `sidecarFieldsSchema`'s `rating <= 10` bound
 * (`readSidecarDefensively` reports `state: 'error'`, `values: {}`), so the row's effective values
 * still resolve from the demo header/file name rather than from this sidecar. */
const REPLAYS_ROWS_BROKEN_SIDECAR_TEXT = '{"rating": 99}\n'

/** The sidecar file name for a demo file name - mirrors `sidecarFileName()`
 * (`src/shared/replays/sidecar.ts`), duplicated here as a literal for the same reason every other
 * mirrored fact in this file is (see the top-of-file note): this is plain Node ESM outside both TS
 * projects. */
function rowsSidecarFileName(demoFileName) {
  return `${demoFileName}.json`
}

/** Where `replays-rows`'s sidecar for `demoFileName` lives on disk - exported so
 * `scripts/flows/replays-edit-sidecar.mjs` can read back what a real save wrote. */
export function replaysRowsSidecarPath(demoFileName) {
  return join(replaysRowsFolderPath(), rowsSidecarFileName(demoFileName))
}

/**
 * Deletes and rewrites the `replays-rows` variant: an empty `state.json` (no installations - every
 * row here lives under one registered extra folder instead), plus that folder holding:
 * `REPLAYS_ROWS_TDM_DEMO`/`REPLAYS_ROWS_DUEL_DEMO` (both copies of `docs/fixtures/demos/test.dm2`,
 * each with its own sidecar above), `REPLAYS_ROWS_MVD_DEMO` (a copy of the PFAU `.mvd2` fixture, no
 * sidecar at all), `REPLAYS_ROWS_BROKEN_DEMO` (a copy of `test.dm2` paired with the
 * deliberately-invalid sidecar above) and `REPLAYS_ROWS_UNREADABLE_DEMO` (a genuinely empty file -
 * `readDemoHeader`/`demoReadability` report `reason: 'empty'`, `readable: false`, the same fixture
 * shape `scan-service.test.ts`'s own `empty.dm2` uses). `REPLAYS_ROWS_ZIP_ARCHIVE` is only ever
 * written when the vendored extractor is present (mirrors `writeReplaysZipPackArchive()` above), so
 * this fixture never pretends an archive-entry row exists without the real 7za binary that
 * decompresses it.
 */
export function writeReplaysRowsFixture() {
  const userDataDir = variantUserDataDir('replays-rows')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), {
    ...emptyStateDocument(),
    replays: {
      extraFolders: [
        { id: REPLAYS_ROWS_FOLDER_ID, path: replaysRowsFolderPath(), addedAt: FIXED_TIMESTAMP },
      ],
    },
  })
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const folder = replaysRowsFolderPath()
  rmDirBestEffort(folder)
  mkdirSync(folder, { recursive: true })

  const testDm2 = join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'test.dm2')
  const mvd2Fixture = join(
    REPO_ROOT,
    'docs',
    'fixtures',
    'demos',
    'PFAU_20221127-053327_q2dm1.mvd2',
  )

  copyFileSync(testDm2, join(folder, REPLAYS_ROWS_TDM_DEMO))
  writeFileSync(
    join(folder, rowsSidecarFileName(REPLAYS_ROWS_TDM_DEMO)),
    JSON.stringify(REPLAYS_ROWS_TDM_SIDECAR, null, 2) + '\n',
    'utf8',
  )

  copyFileSync(testDm2, join(folder, REPLAYS_ROWS_DUEL_DEMO))
  writeFileSync(
    join(folder, rowsSidecarFileName(REPLAYS_ROWS_DUEL_DEMO)),
    JSON.stringify(REPLAYS_ROWS_DUEL_SIDECAR, null, 2) + '\n',
    'utf8',
  )

  copyFileSync(mvd2Fixture, join(folder, REPLAYS_ROWS_MVD_DEMO))

  copyFileSync(testDm2, join(folder, REPLAYS_ROWS_BROKEN_DEMO))
  writeFileSync(
    join(folder, rowsSidecarFileName(REPLAYS_ROWS_BROKEN_DEMO)),
    REPLAYS_ROWS_BROKEN_SIDECAR_TEXT,
    'utf8',
  )

  writeFileSync(join(folder, REPLAYS_ROWS_UNREADABLE_DEMO), Buffer.alloc(0))

  if (vendoredExtractorExists()) {
    const staging = join(bootstrapStagingDir(), 'replays-rows-pack')
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    copyFileSync(testDm2, join(staging, REPLAYS_ROWS_ZIP_ENTRY_NAME))

    const archivePath = join(folder, REPLAYS_ROWS_ZIP_ARCHIVE)
    rmSync(archivePath, { force: true })
    execFileSync(
      vendoredSevenZaPath(),
      ['a', '-tzip', '-mx1', '-bso0', '-bse0', '-bd', archivePath, REPLAYS_ROWS_ZIP_ENTRY_NAME],
      { cwd: staging, windowsHide: true },
    )
  }

  return { userDataDir, installations: 0, configProfiles: 0 }
}

// --- story 152 D3: the demos list's sort-order e2e fixture ---------------------------------------

/** `replays-sort-order`'s own fixture variant name, exported so the flow imports it rather than
 * hardcoding the string a second time (mirrors `replays-demo-rows.mjs`'s own `variant` import
 * shape - but that flow re-exports its own `variant` constant from the flow file itself; this one
 * exports it from here since the fixture module is the source of truth for the variant name). */
export const REPLAYS_SORT_ORDER_VARIANT = 'replays-sort-order'

/** `replays-sort-order`'s extra folder id/path, registered in its own `state.json` below. */
const REPLAYS_SORT_ORDER_FOLDER_ID = 'fixture-replays-sort-order-folder'

function replaysSortOrderFolderPath() {
  return join(variantUserDataDir(REPLAYS_SORT_ORDER_VARIANT), 'demos-fixture')
}

/** File names `scripts/flows/replays-sort-order.mjs` asserts against - exported so the flow never
 * hand-types a second copy that could drift from what this fixture actually writes. Two favourites
 * (different dates, different maps) and two non-favourites (one newer than both favourites, one
 * older than both) - enough to prove the default order groups favourites first, then falls back
 * to date descending within/outside that group, and that a column sort (e.g. map) never re-pins
 * favourites (AC5). */
export const REPLAYS_SORT_ORDER_FAV_NEWER_DEMO = 'sort-fav-newer.dm2'

export const REPLAYS_SORT_ORDER_FAV_OLDER_DEMO = 'sort-fav-older.dm2'

export const REPLAYS_SORT_ORDER_NONFAV_NEWEST_DEMO = 'sort-nonfav-newest.dm2'

export const REPLAYS_SORT_ORDER_NONFAV_OLDEST_DEMO = 'sort-nonfav-oldest.dm2'

/** Each demo's sidecar `map` override - exported so the flow can assert DOM row order by map text
 * without hand-typing a second copy of these strings that could drift from the sidecars below. */
export const REPLAYS_SORT_ORDER_FAV_NEWER_SIDECAR_MAP = 'q2dm2'

export const REPLAYS_SORT_ORDER_FAV_OLDER_SIDECAR_MAP = 'q2dm10'

export const REPLAYS_SORT_ORDER_NONFAV_NEWEST_SIDECAR_MAP = 'q2dm5'

export const REPLAYS_SORT_ORDER_NONFAV_OLDEST_SIDECAR_MAP = 'q2dm1'

const REPLAYS_SORT_ORDER_FAV_NEWER_SIDECAR = {
  schemaVersion: 1,
  favourite: true,
  map: REPLAYS_SORT_ORDER_FAV_NEWER_SIDECAR_MAP,
  date: '2026-01-10T00:00:00.000Z',
}

const REPLAYS_SORT_ORDER_FAV_OLDER_SIDECAR = {
  schemaVersion: 1,
  favourite: true,
  map: REPLAYS_SORT_ORDER_FAV_OLDER_SIDECAR_MAP,
  date: '2026-01-05T00:00:00.000Z',
}

const REPLAYS_SORT_ORDER_NONFAV_NEWEST_SIDECAR = {
  schemaVersion: 1,
  map: REPLAYS_SORT_ORDER_NONFAV_NEWEST_SIDECAR_MAP,
  date: '2026-01-20T00:00:00.000Z',
}

const REPLAYS_SORT_ORDER_NONFAV_OLDEST_SIDECAR = {
  schemaVersion: 1,
  map: REPLAYS_SORT_ORDER_NONFAV_OLDEST_SIDECAR_MAP,
  date: '2026-01-01T00:00:00.000Z',
}

/** The sidecar file name for a demo file name - mirrors `sidecarFileName()`
 * (`src/shared/replays/sidecar.ts`), same duplication reasoning as `rowsSidecarFileName()` above:
 * this is plain Node ESM outside both TS projects. */
function sortOrderSidecarFileName(demoFileName) {
  return `${demoFileName}.json`
}

/**
 * Deletes and rewrites the `replays-sort-order` variant: an empty `state.json` (no installations -
 * every row lives under one registered extra folder, never under `gameRoot()` - same reasoning as
 * `writeReplaysRowsFixture()`'s own top-of-section comment), plus that folder holding four copies of
 * `docs/fixtures/demos/test.dm2`, each paired with its own sidecar overriding `favourite`/`map`/
 * `date` per the constants above.
 */
export function writeReplaysSortOrderFixture() {
  const userDataDir = variantUserDataDir(REPLAYS_SORT_ORDER_VARIANT)
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), {
    ...emptyStateDocument(),
    replays: {
      extraFolders: [
        {
          id: REPLAYS_SORT_ORDER_FOLDER_ID,
          path: replaysSortOrderFolderPath(),
          addedAt: FIXED_TIMESTAMP,
        },
      ],
    },
  })
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const folder = replaysSortOrderFolderPath()
  rmDirBestEffort(folder)
  mkdirSync(folder, { recursive: true })

  const testDm2 = join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'test.dm2')

  const demos = [
    [REPLAYS_SORT_ORDER_FAV_NEWER_DEMO, REPLAYS_SORT_ORDER_FAV_NEWER_SIDECAR],
    [REPLAYS_SORT_ORDER_FAV_OLDER_DEMO, REPLAYS_SORT_ORDER_FAV_OLDER_SIDECAR],
    [REPLAYS_SORT_ORDER_NONFAV_NEWEST_DEMO, REPLAYS_SORT_ORDER_NONFAV_NEWEST_SIDECAR],
    [REPLAYS_SORT_ORDER_NONFAV_OLDEST_DEMO, REPLAYS_SORT_ORDER_NONFAV_OLDEST_SIDECAR],
  ]
  for (const [fileName, sidecar] of demos) {
    copyFileSync(testDm2, join(folder, fileName))
    writeFileSync(
      join(folder, sortOrderSidecarFileName(fileName)),
      JSON.stringify(sidecar, null, 2) + '\n',
      'utf8',
    )
  }

  return { userDataDir, installations: 0, configProfiles: 0 }
}

// --- story 153 D5: the demo list's filter/search rail's own e2e fixture -------------------------

/** `replays-filter-search`'s own fixture variant name, exported so the flow imports it rather than
 * hardcoding the string a second time (same reasoning as `REPLAYS_SORT_ORDER_VARIANT` above). */
export const REPLAYS_FILTER_VARIANT = 'filter-demos'

/** `replays-filter-search`'s extra folder id/path, registered in its own `state.json` below - one
 * folder scoped to this variant's own `variantUserDataDir()`, never `gameRoot()` (the regression
 * note on `writeReplaysZipPackArchive()` above: writing demo fixtures into the shared installation
 * folders leaks them into every other variant/flow that reads those same folders). */
const REPLAYS_FILTER_FOLDER_ID = 'fixture-replays-filter-folder'

export function replaysFilterFixturePath() {
  return join(variantUserDataDir(REPLAYS_FILTER_VARIANT), 'filter-demos')
}

/** File names `scripts/flows/replays-filter-search.mjs` asserts against - exported so the flow
 * never hand-types a second copy that could drift from what this fixture actually writes. */
export const REPLAYS_FILTER_FAVOURITE_DEMO = 'filter-favourite.mvd2'

export const REPLAYS_FILTER_NONFAV_DEMO = 'filter-nonfav.mvd2'

export const REPLAYS_FILTER_HEADERONLY_DEMO = 'filter-headeronly.dm2'

/** The user-defined `{p1}_vs_{p2}_{map}.mvd2` name template's own match (registered under
 * `replays.nameTemplates` below) - `Zephyr`/`Rook` are its name-fact players. The name-fact `map`
 * capture (`q2ctf5`) is immediately overridden by this same file's own sidecar `map` (below), so
 * its effective map stays deterministic regardless of whatever this real demo's own embedded map
 * happens to be. */
export const REPLAYS_FILTER_NAMEFACT_DEMO = 'Zephyr_vs_Rook_q2ctf5.mvd2'

/** The unique search terms each demo alone matches (AC1). */
export const REPLAYS_FILTER_SIDECAR_NAME = 'CTF Grand Final'

// Deliberately unrelated to `REPLAYS_FILTER_NAMEFACT_PLAYER` ('Zephyr') below - an earlier
// 'zephyrgrove' picked here matched both demos under a substring search, since 'zephyrgrove'
// contains 'zephyr'.
export const REPLAYS_FILTER_DESCRIPTION_WORD = 'moonvale'

export const REPLAYS_FILTER_SIDECAR_PLAYER = 'Tom'

/** `test.dm2`'s own real header player (see `scan-service.test.ts`'s `EXPECTED.players`) - unique
 * across this fixture because `REPLAYS_FILTER_HEADERONLY_DEMO` is the only row copied from
 * `test.dm2`; every other row below copies the PFAU mvd2 fixture instead. */
export const REPLAYS_FILTER_HEADER_PLAYER = 'WallFly'

export const REPLAYS_FILTER_NAMEFACT_PLAYER = 'Zephyr'

export const REPLAYS_FILTER_SHARED_MAP = 'q2ctf5'

export const REPLAYS_FILTER_NONFAV_MAP = 'q2dm4'

export const REPLAYS_FILTER_FAVOURITE_TAG = 'final'

export const REPLAYS_FILTER_LAN_TAG = 'lan'

export const REPLAYS_FILTER_FUN_TAG = 'fun'

/** Known dropdown option sets (AC2) - deterministic from the sidecar overrides below plus the two
 * real fixture files' own confirmed header facts (`zip-demos.test.ts`): both real files' `gameDir`
 * is `'opentdm'`, which every un-overridden row's mod falls back to. The mvd2 copies report exactly
 * two header players, so `resolveGamemode`'s "exactly two players" heuristic guesses `'duel'` for
 * them (ahead of the looser opentdm/`'tdm'` rule - see `GAMEMODE_HEURISTICS`). `test.dm2` has one
 * team player (its other header player is a spectator, which does not count), so it falls to the
 * opentdm rule and guesses `'tdm'`. The header-only demo's own real embedded map (`test.dm2`, never
 * overridden - it has no sidecar) is `'q2rdm2'`. */
export const REPLAYS_FILTER_MOD_OPTIONS = ['ctf', 'opentdm']

export const REPLAYS_FILTER_GAMEMODE_OPTIONS = ['ctf', 'duel', 'tdm']

export const REPLAYS_FILTER_HEADERONLY_MAP = 'q2rdm2'

export const REPLAYS_FILTER_MAP_OPTIONS = [
  REPLAYS_FILTER_SHARED_MAP,
  REPLAYS_FILTER_NONFAV_MAP,
  REPLAYS_FILTER_HEADERONLY_MAP,
].sort((a, b) => a.localeCompare(b))

const REPLAYS_FILTER_FAVOURITE_SIDECAR = {
  schemaVersion: 1,
  name: REPLAYS_FILTER_SIDECAR_NAME,
  favourite: true,
  rating: 9,
  mod: 'ctf',
  gamemode: 'ctf',
  map: REPLAYS_FILTER_SHARED_MAP,
  tags: [REPLAYS_FILTER_FAVOURITE_TAG, REPLAYS_FILTER_LAN_TAG],
  sides: [{ team: 'Tom Team', players: [REPLAYS_FILTER_SIDECAR_PLAYER, 'Ally'] }],
}

const REPLAYS_FILTER_NONFAV_SIDECAR = {
  schemaVersion: 1,
  rating: 5,
  map: REPLAYS_FILTER_NONFAV_MAP,
  tags: [REPLAYS_FILTER_FUN_TAG],
  description: `An epic comeback finish at ${REPLAYS_FILTER_DESCRIPTION_WORD}.`,
}

/** Deliberately just a `map` override - `REPLAYS_FILTER_NAMEFACT_DEMO` still counts as searchable
 * only through its file name's own facts (name/tags/rating/favourite are all absent here), the
 * sidecar's only job is pinning its effective map down for AC2/AC6's determinism. */
const REPLAYS_FILTER_NAMEFACT_SIDECAR = {
  schemaVersion: 1,
  map: REPLAYS_FILTER_SHARED_MAP,
}

/** The sidecar file name for a demo file name - mirrors `sidecarFileName()`
 * (`src/shared/replays/sidecar.ts`), same duplication reasoning as `sortOrderSidecarFileName()`
 * above: this is plain Node ESM outside both TS projects. */
function filterSidecarFileName(demoFileName) {
  return `${demoFileName}.json`
}

/**
 * Deletes and rewrites the `filter-demos` variant: an empty `state.json` (no installations - every
 * row lives under one registered extra folder, same discipline as `writeReplaysSortOrderFixture()`
 * above) carrying a user-defined name template (`{p1}_vs_{p2}_{map}.mvd2`) under
 * `replays.nameTemplates`, so `REPLAYS_FILTER_NAMEFACT_DEMO`'s file name resolves name-fact
 * players - plus that folder holding four demos: `docs/fixtures/demos/
 * PFAU_20221127-053327_q2dm1.mvd2` copied three times (favourite, non-favourite, name-fact) and
 * `docs/fixtures/demos/test.dm2` copied once, alone, as the header-only demo (its real header
 * players, `WallFly[BZZZ]`/`sd.kgm/sauDove`, would stop being unique to that one demo if any other
 * row shared its bytes).
 */
export function writeReplaysFilterFixture() {
  const userDataDir = variantUserDataDir(REPLAYS_FILTER_VARIANT)
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), {
    ...emptyStateDocument(),
    replays: {
      extraFolders: [
        {
          id: REPLAYS_FILTER_FOLDER_ID,
          path: replaysFilterFixturePath(),
          addedAt: FIXED_TIMESTAMP,
        },
      ],
      nameTemplates: {
        entries: [
          {
            id: 'fixture-filter-namefact-template',
            kind: 'user',
            template: '{p1}_vs_{p2}_{map}.mvd2',
          },
        ],
        removedShippedIds: [],
      },
    },
  })
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const folder = replaysFilterFixturePath()
  rmDirBestEffort(folder)
  mkdirSync(folder, { recursive: true })

  const mvd2Fixture = join(
    REPO_ROOT,
    'docs',
    'fixtures',
    'demos',
    'PFAU_20221127-053327_q2dm1.mvd2',
  )
  const dm2Fixture = join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'test.dm2')

  const demos = [
    [REPLAYS_FILTER_FAVOURITE_DEMO, mvd2Fixture, REPLAYS_FILTER_FAVOURITE_SIDECAR],
    [REPLAYS_FILTER_NONFAV_DEMO, mvd2Fixture, REPLAYS_FILTER_NONFAV_SIDECAR],
    [REPLAYS_FILTER_HEADERONLY_DEMO, dm2Fixture, null],
    [REPLAYS_FILTER_NAMEFACT_DEMO, mvd2Fixture, REPLAYS_FILTER_NAMEFACT_SIDECAR],
  ]
  for (const [fileName, source, sidecar] of demos) {
    copyFileSync(source, join(folder, fileName))
    if (sidecar !== null) {
      writeFileSync(
        join(folder, filterSidecarFileName(fileName)),
        JSON.stringify(sidecar, null, 2) + '\n',
        'utf8',
      )
    }
  }

  return { userDataDir, installations: 0, configProfiles: 0 }
}

/** Undoes `writeReplaysFilterFixture()` above - called from `replays-filter-search.mjs`'s own
 * `teardown()` (never from `writePopulatedFixture()` - same discipline as
 * `removeReplaysZipPackArchive()`). */
export function removeReplaysFilterFixture() {
  rmDirBestEffort(variantUserDataDir(REPLAYS_FILTER_VARIANT))
}

// --- the folder view's e2e fixture (story 242) ----------------------------------------------

/** `replays-folders`' own variant: one extra folder (no installations) holding demos nested
 * `a/b/c`, one directly in the folder, and a zip with entries. */
export const REPLAYS_FOLDERS_VARIANT = 'folders-demos'

const REPLAYS_FOLDERS_FOLDER_ID = 'fixture-replays-folders-folder'

export function replaysFoldersFixturePath() {
  return join(variantUserDataDir(REPLAYS_FOLDERS_VARIANT), 'folders-demos')
}

export const REPLAYS_FOLDERS_ROOT_DEMO = 'folders-root.dm2'

export const REPLAYS_FOLDERS_A_DEMO = 'folders-a.dm2'

/** The sidecar beside `REPLAYS_FOLDERS_A_DEMO`: a rating a folder rename must carry along. */
export const REPLAYS_FOLDERS_A_SIDECAR = { schemaVersion: 1, rating: 7 }

export const REPLAYS_FOLDERS_C_DEMO = 'folders-c.dm2'

export const REPLAYS_FOLDERS_ZIP = 'folders-pack.zip'

/** The entry names inside `REPLAYS_FOLDERS_ZIP` that are real demos. */
export const REPLAYS_FOLDERS_ZIP_ENTRIES = ['test.dm2']

export function writeReplaysFoldersFixture() {
  const userDataDir = variantUserDataDir(REPLAYS_FOLDERS_VARIANT)
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })
  writeJson(join(userDataDir, STATE_FILE), {
    ...emptyStateDocument(),
    replays: {
      extraFolders: [
        {
          id: REPLAYS_FOLDERS_FOLDER_ID,
          path: replaysFoldersFixturePath(),
          addedAt: FIXED_TIMESTAMP,
        },
      ],
    },
  })
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const folder = replaysFoldersFixturePath()
  mkdirSync(join(folder, 'a', 'b', 'c'), { recursive: true })
  const dm2 = join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'test.dm2')
  copyFileSync(dm2, join(folder, REPLAYS_FOLDERS_ROOT_DEMO))
  copyFileSync(dm2, join(folder, 'a', REPLAYS_FOLDERS_A_DEMO))
  writeJson(join(folder, 'a', `${REPLAYS_FOLDERS_A_DEMO}.json`), REPLAYS_FOLDERS_A_SIDECAR)
  copyFileSync(dm2, join(folder, 'a', 'b', 'c', REPLAYS_FOLDERS_C_DEMO))

  if (vendoredExtractorExists()) {
    const staging = join(bootstrapStagingDir(), 'replays-folders-zip')
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    copyFileSync(dm2, join(staging, 'test.dm2'))
    writeFileSync(join(staging, 'readme.txt'), 'not a demo\n', 'utf8')
    execFileSync(
      vendoredSevenZaPath(),
      [
        'a',
        '-tzip',
        '-mx1',
        '-bso0',
        '-bse0',
        '-bd',
        join(folder, REPLAYS_FOLDERS_ZIP),
        'test.dm2',
        'readme.txt',
      ],
      { cwd: staging, windowsHide: true },
    )
  }
  return { userDataDir, installations: 0, configProfiles: 0 }
}

export function removeReplaysFoldersFixture() {
  rmDirBestEffort(variantUserDataDir(REPLAYS_FOLDERS_VARIANT))
}

// --- story 154 D5: the demo list's own date filter's e2e fixture --------------------------------

/** `replays-date-filter`'s own fixture variant name - own `state.json`/own extra folder, never
 * shared with `REPLAYS_FILTER_VARIANT`/`REPLAYS_SORT_ORDER_VARIANT` above (same discipline as
 * those two). */
export const REPLAYS_DATE_FILTER_VARIANT = 'date-filter-demos'

const REPLAYS_DATE_FILTER_FOLDER_ID = 'fixture-replays-date-filter-folder'

export function replaysDateFilterFixturePath() {
  return join(variantUserDataDir(REPLAYS_DATE_FILTER_VARIANT), 'date-filter-demos')
}

/** File names `scripts/flows/replays-date-filter.mjs` asserts against - see
 * `writeReplaysDateFilterFixture()`'s own doc comment below for each demo's effective-date source
 * and approximate age. */
export const REPLAYS_DATE_FILTER_TODAY_DEMO = 'date-filter-today.dm2'

export const REPLAYS_DATE_FILTER_RECENT_DEMO = 'date-filter-recent.mvd2'

export const REPLAYS_DATE_FILTER_OLD_DEMO = 'date-filter-old.mvd2'

export const REPLAYS_DATE_FILTER_VERYOLD_DEMO = 'date-filter-veryold.mvd2'

/** `REPLAYS_DATE_FILTER_RECENT_DEMO`'s sidecar `mod` override - the "another 153 filter" criterion
 * the date filter ANDs with in this flow's own combine step. */
export const REPLAYS_DATE_FILTER_RECENT_MOD = 'excessive'

/** The sidecar file name for a demo file name - mirrors `sidecarFileName()`
 * (`src/shared/replays/sidecar.ts`), same duplication reasoning as `filterSidecarFileName()`
 * above: this is plain Node ESM outside both TS projects. */
function dateFilterSidecarFileName(demoFileName) {
  return `${demoFileName}.json`
}

/** Builds a local calendar `Date` `daysAgo` days before `nowMs`'s own calendar day, pinned to
 * 10:00 local time - mirrors `resolveDateRange()`'s (`src/shared/date-range.ts`) own
 * `new Date(y, m, d)` construction, never `nowMs - daysAgo * 86_400_000` (which breaks across a
 * DST transition), so each demo's day lands unambiguously inside/outside a preset's boundary. */
function daysAgoLocal(nowMs, daysAgo) {
  const now = new Date(nowMs)
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 10, 0, 0)
}

/**
 * Deletes and rewrites the `date-filter-demos` variant: an empty `state.json` (no installations -
 * every row lives under one registered extra folder, same discipline as
 * `writeReplaysFilterFixture()` above) plus that folder holding four demos:
 *
 *  - `REPLAYS_DATE_FILTER_TODAY_DEMO` - ~0 days old (today). No sidecar at all, and a plain file
 *    name that matches none of `SHIPPED_NAME_PATTERNS` - its effective date resolves from FILE
 *    TIME ONLY (`resolveEffectiveValues()`'s `date` rung falls through sidecar/name-fact straight
 *    to `file`). The one ≤7-day-old demo required to prove the file-time rung alone.
 *  - `REPLAYS_DATE_FILTER_RECENT_DEMO` - ~3 days old. Carries a sidecar `date` (ISO string, 3 days
 *    before `nowMs`) AND a sidecar `mod` override (`REPLAYS_DATE_FILTER_RECENT_MOD`) - its
 *    effective date resolves from the SIDECAR rung, and its mod is the "combines with another 153
 *    filter" flow step's second criterion.
 *  - `REPLAYS_DATE_FILTER_OLD_DEMO` - ~20 days old. No sidecar - file time only. Outside "last 7
 *    days", inside "last 30 days".
 *  - `REPLAYS_DATE_FILTER_VERYOLD_DEMO` - ~60 days old. No sidecar - file time only. Outside every
 *    preset.
 *
 * Backdated via `fs.utimesSync` (the `writeDownloadsCacheArchives()` idiom above) rather than a
 * sidecar date for the three file-time demos: a copy this script just made has a real (now)
 * `birthtimeMs`, so `effectiveFileTime()` (`src/shared/demos/effective-values.ts`) falls back to
 * the backdated `mtimeMs` since `birthtimeMs > mtimeMs` after backdating.
 */
export function writeReplaysDateFilterFixture(nowMs = Date.now()) {
  const userDataDir = variantUserDataDir(REPLAYS_DATE_FILTER_VARIANT)
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), {
    ...emptyStateDocument(),
    replays: {
      extraFolders: [
        {
          id: REPLAYS_DATE_FILTER_FOLDER_ID,
          path: replaysDateFilterFixturePath(),
          addedAt: FIXED_TIMESTAMP,
        },
      ],
    },
  })
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const folder = replaysDateFilterFixturePath()
  rmDirBestEffort(folder)
  mkdirSync(folder, { recursive: true })

  const mvd2Fixture = join(
    REPO_ROOT,
    'docs',
    'fixtures',
    'demos',
    'PFAU_20221127-053327_q2dm1.mvd2',
  )
  const dm2Fixture = join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'test.dm2')

  const recentSidecarDate = daysAgoLocal(nowMs, 3).toISOString()

  const demos = [
    [REPLAYS_DATE_FILTER_TODAY_DEMO, dm2Fixture, null, daysAgoLocal(nowMs, 0)],
    [
      REPLAYS_DATE_FILTER_RECENT_DEMO,
      mvd2Fixture,
      { schemaVersion: 1, date: recentSidecarDate, mod: REPLAYS_DATE_FILTER_RECENT_MOD },
      daysAgoLocal(nowMs, 3),
    ],
    [REPLAYS_DATE_FILTER_OLD_DEMO, mvd2Fixture, null, daysAgoLocal(nowMs, 20)],
    [REPLAYS_DATE_FILTER_VERYOLD_DEMO, mvd2Fixture, null, daysAgoLocal(nowMs, 60)],
  ]

  for (const [fileName, source, sidecar, mtime] of demos) {
    const target = join(folder, fileName)
    copyFileSync(source, target)
    if (sidecar !== null) {
      writeFileSync(
        join(folder, dateFilterSidecarFileName(fileName)),
        JSON.stringify(sidecar, null, 2) + '\n',
        'utf8',
      )
    }
    utimesSync(target, mtime, mtime)
  }

  return { userDataDir, installations: 0, configProfiles: 0 }
}

/** Undoes `writeReplaysDateFilterFixture()` above - called from `replays-date-filter.mjs`'s own
 * `teardown()`, never from `writePopulatedFixture()` (same discipline as
 * `removeReplaysFilterFixture()` above). */
export function removeReplaysDateFilterFixture() {
  rmDirBestEffort(variantUserDataDir(REPLAYS_DATE_FILTER_VARIANT))
}

/** `replays-scale`'s extra folder id/path, registered in its own `state.json` below. */
const REPLAYS_SCALE_FOLDER_ID = 'fixture-replays-scale-folder'

function replaysScaleFolderPath() {
  return join(variantUserDataDir('replays-scale'), 'demos-fixture')
}

/** How many placeholder `.dm2` files `replays-scale` seeds - exported so
 * `scripts/flows/replays-list-scale.mjs` never hand-types this count a second time. */
export const REPLAYS_SCALE_FILE_COUNT = 3000

/** Base instant for the deterministic per-file mtimes below - comfortably earlier than "now" for as
 * long as this repo runs (see the birthtime note below), and distinct from other fixtures'
 * `FIXED_TIMESTAMP` so nothing here can collide with another variant's files. */
const REPLAYS_SCALE_BASE_TIMESTAMP_MS = Date.parse('2026-01-01T00:00:00.000Z')

/**
 * Regression note (sprint gate fix for story 152, "favourites first, then newest"): this used to be
 * the *highest*-numbered file (`scale-3000.dm2`), which was correct only while the demos list had no
 * default sort and rendered rows in raw scan order - scrolling a plain, unsorted list to the bottom
 * reached whatever was written last. Once 152 shipped the default order (favourites first, then
 * newest by effective date - `src/shared/replays/list-sort.ts`), the *newest* file sorts to the
 * *top* of the list, not the bottom: these placeholder files have neither a sidecar nor a readable
 * header, so their effective date always falls back to file time
 * (`src/shared/demos/effective-values.ts`'s `effectiveFileTime`), and the highest-numbered file was
 * also the most-recently-written one. The file reachable by scrolling to the *end* of the list under
 * 152's "newest first" order is now the *oldest* one - file 1 - which is what this constant (and the
 * flow that imports it) point at.
 *
 * The per-file mtimes below are deliberately backdated to strictly increasing, one-second-apart
 * instants (`fs.utimesSync`, same idiom as `writeDownloadsCacheArchives()` above) rather than left
 * at their incidental real write-time mtimes: writing 3 000 files in a tight loop clusters many of
 * them into the same few-millisecond filesystem-timestamp bucket, which would make "which single
 * file has the unique oldest date" a matter of FS timing rather than a deterministic fixture. Node's
 * `utimesSync` only backdates atime/mtime, never birthtime, so each file's real (recent) birthtime
 * stays later than every one of these synthetic, backdated mtimes - `effectiveFileTime` requires
 * `birthtimeMs <= mtimeMs` to prefer birthtime, so it always falls back to the deterministic mtime
 * set here.
 */
export const REPLAYS_SCALE_LAST_FILE_NAME = 'scale-0001.dm2'

/**
 * Deletes and rewrites the `replays-scale` variant: an empty `state.json` (no installations), plus
 * one registered extra folder holding `REPLAYS_SCALE_FILE_COUNT` placeholder `.dm2` files
 * (`scale-0001.dm2` … `scale-3000.dm2`), each with its own deterministic, strictly increasing mtime
 * (oldest to newest) - purely to prove the list virtualises rather than mounting every row at once.
 * Placeholder bytes only, same convention as `REPLAYS_FIXTURE_DEMO_CONTENT` above - this variant
 * never asserts on any row's parsed content, only on how many `DemoRow`s the DOM holds and whether
 * the one at the bottom of 152's default sort order is reachable by scrolling.
 */
export function writeReplaysScaleFixture() {
  const userDataDir = variantUserDataDir('replays-scale')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), {
    ...emptyStateDocument(),
    replays: {
      extraFolders: [
        { id: REPLAYS_SCALE_FOLDER_ID, path: replaysScaleFolderPath(), addedAt: FIXED_TIMESTAMP },
      ],
    },
  })
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const folder = replaysScaleFolderPath()
  rmDirBestEffort(folder)
  mkdirSync(folder, { recursive: true })

  for (let i = 1; i <= REPLAYS_SCALE_FILE_COUNT; i += 1) {
    const name = `scale-${String(i).padStart(4, '0')}.dm2`
    const filePath = join(folder, name)
    writeFileSync(filePath, REPLAYS_FIXTURE_DEMO_CONTENT, 'utf8')
    const mtime = new Date(REPLAYS_SCALE_BASE_TIMESTAMP_MS + i * 1000)
    utimesSync(filePath, mtime, mtime)
  }

  return { userDataDir, installations: 0, configProfiles: 0 }
}

// --- story 151 D4: the Demos view's own loading/empty/error status-strip screens -----------------

/**
 * Story 151 D4: `replays-list-loading`'s fixture - the plain `populated` install/demo set (so the
 * loading strip's `data-total` is real, non-zero `REPLAYS_FIXTURE_DEMOS.length`), plus the harness's
 * scan-hold seam (`scanHoldMs()`, `src/main/modules/replays/index.ts`) set to `holdMs` so the flow
 * has a real window to assert the loading strip's numbers before the scan finishes on its own.
 */
export function writeReplaysListLoadingFixture({ holdMs = 15000 } = {}) {
  const result = writePopulatedFixture({ variant: 'replays-list-loading' })
  writeFileSync(join(result.userDataDir, 'harness-replays-scan-hold-ms'), String(holdMs), 'utf8')
  return result
}

/**
 * Story 151 D4: `replays-list-error`'s fixture - the plain `populated` install/demo set plus two
 * extra folders registered under `replays.extraFolders`, each engineered to fail discovery in a
 * distinct way (AC "a source failure never hides the rest of the list"):
 *   - `replaysListErrorMissingFolderPath()` - never created, so `scanDemosDir` reports `'missing'`
 *     (ENOENT) for the folder itself.
 *   - `replaysListErrorBrokenArchiveFolderPath()` - a real, readable folder holding one file,
 *     `broken.zip`, that is a few garbage bytes, never a real archive - it fails to expand whether
 *     or not `resources/bin/7za.exe` happens to be vendored locally (`'extractor-missing'` without
 *     it, `'archive-unreadable'` with it - both are one of `replaysSourceErrorReasonSchema`'s three
 *     archive-only codes).
 * Both folders live under THIS variant's own `variantUserDataDir()`, never under `gameRoot()` - the
 * same discipline `writeReplaysRowsFixture()`/`writeReplaysScaleFixture()` follow above, for the
 * same reason: `gameRoot()` is not variant-scoped, so anything written there would leak into every
 * other variant/flow that reads the shared installation folders (see the regression note on
 * `writeReplaysDemosFixture()`).
 */
export function replaysListErrorMissingFolderPath() {
  return join(variantUserDataDir('replays-list-error'), 'missing-demos')
}

export function replaysListErrorBrokenArchiveFolderPath() {
  return join(variantUserDataDir('replays-list-error'), 'broken-archive-demos')
}

export const REPLAYS_LIST_ERROR_BROKEN_ARCHIVE_NAME = 'broken.zip'

export function writeReplaysListErrorFixture() {
  const missingFolder = replaysListErrorMissingFolderPath()
  const brokenArchiveFolder = replaysListErrorBrokenArchiveFolderPath()

  const result = writePopulatedFixture({
    variant: 'replays-list-error',
    stateOverrides: {
      replays: {
        extraFolders: [
          {
            id: 'fixture-replays-list-error-missing',
            path: missingFolder,
            addedAt: FIXED_TIMESTAMP,
          },
          {
            id: 'fixture-replays-list-error-broken-archive',
            path: brokenArchiveFolder,
            addedAt: FIXED_TIMESTAMP,
          },
        ],
      },
    },
  })

  // `missingFolder` is deliberately never created.
  rmDirBestEffort(brokenArchiveFolder)
  mkdirSync(brokenArchiveFolder, { recursive: true })
  writeFileSync(
    join(brokenArchiveFolder, REPLAYS_LIST_ERROR_BROKEN_ARCHIVE_NAME),
    'q2l-fixture-not-a-real-zip\n',
    'utf8',
  )

  return result
}

// --- story 245: the demo detail's players panel e2e fixture -------------------------------------

export const REPLAYS_TEAMS_VARIANT = 'replays-teams'

const REPLAYS_TEAMS_FOLDER_ID = 'fixture-replays-teams-folder'

function replaysTeamsFolderPath() {
  return join(variantUserDataDir(REPLAYS_TEAMS_VARIANT), 'demos-fixture')
}

/** File names `scripts/flows/replays-detail-teams.mjs` asserts against. The example demo carries
 * a Home/Away roster, a POV and spectators in its own bytes; the header demo is `test.dm2`, whose
 * header names no decisive grouping; the sidecar demo is a second copy of the example whose
 * sidecar overrides its sides. */
export const REPLAYS_TEAMS_EXAMPLE_DEMO = 'shad-maq_PFDE3_q2rdm2_20260922-161521.dm2'

export const REPLAYS_TEAMS_HEADER_DEMO = 'teams-header.dm2'

export const REPLAYS_TEAMS_SIDECAR_DEMO = 'teams-sidecar.dm2'

const REPLAYS_TEAMS_SIDECAR = {
  schemaVersion: 1,
  sides: [{ team: 'Wolves', players: ['maq'] }],
}

/**
 * Deletes and rewrites the `replays-teams` variant: an empty `state.json` plus one extra folder under
 * this variant's own userData dir (never `gameRoot()`, which every variant shares) holding the
 * example demo, `test.dm2`, and a sidecar-carrying copy of the example.
 */
export function writeReplaysTeamsFixture() {
  const userDataDir = variantUserDataDir(REPLAYS_TEAMS_VARIANT)
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), {
    ...emptyStateDocument(),
    replays: {
      extraFolders: [
        { id: REPLAYS_TEAMS_FOLDER_ID, path: replaysTeamsFolderPath(), addedAt: FIXED_TIMESTAMP },
      ],
    },
  })
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const folder = replaysTeamsFolderPath()
  rmDirBestEffort(folder)
  mkdirSync(folder, { recursive: true })

  const example = join(REPO_ROOT, 'docs', 'fixtures', 'demos', REPLAYS_TEAMS_EXAMPLE_DEMO)
  copyFileSync(example, join(folder, REPLAYS_TEAMS_EXAMPLE_DEMO))
  copyFileSync(
    join(REPO_ROOT, 'docs', 'fixtures', 'demos', 'test.dm2'),
    join(folder, REPLAYS_TEAMS_HEADER_DEMO),
  )
  copyFileSync(example, join(folder, REPLAYS_TEAMS_SIDECAR_DEMO))
  writeFileSync(
    join(folder, `${REPLAYS_TEAMS_SIDECAR_DEMO}.json`),
    JSON.stringify(REPLAYS_TEAMS_SIDECAR, null, 2) + '\n',
    'utf8',
  )

  return { userDataDir, installations: 0, configProfiles: 0 }
}

export const REPLAYS_FOLDER_SCALE_VARIANT = 'replays-folder-scale'
const REPLAYS_FOLDER_SCALE_FOLDER_ID = 'fixture-replays-folder-scale-folder'

/** Folders per level (4 levels, 200 in all); demos are spread round-robin over every one of them,
 * so the root holds no demo itself and its children's recursive counts sum to the total. */
export const REPLAYS_FOLDER_SCALE_LEVEL_SIZES = [8, 32, 64, 96]
export const REPLAYS_FOLDER_SCALE_FOLDER_COUNT = 200
export const REPLAYS_FOLDER_SCALE_DEMO_COUNT = 5000
/** Top-level folders under the root - the rows the flow reads counts from. */
export const REPLAYS_FOLDER_SCALE_ROOT_CHILDREN = REPLAYS_FOLDER_SCALE_LEVEL_SIZES[0]
/** The root folder's display label (its directory name). */
export const REPLAYS_FOLDER_SCALE_ROOT_LABEL = 'folder-scale'
/** The first top-level folder; it holds the junction loop and is the one the flow opens. */
export const REPLAYS_FOLDER_SCALE_OPEN_FOLDER = 'f1-00'

function replaysFolderScalePath() {
  return join(variantUserDataDir(REPLAYS_FOLDER_SCALE_VARIANT), REPLAYS_FOLDER_SCALE_ROOT_LABEL)
}

export function writeReplaysFolderScaleFixture() {
  const userDataDir = variantUserDataDir(REPLAYS_FOLDER_SCALE_VARIANT)
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })
  const root = replaysFolderScalePath()
  writeJson(join(userDataDir, STATE_FILE), {
    ...emptyStateDocument(),
    replays: {
      extraFolders: [{ id: REPLAYS_FOLDER_SCALE_FOLDER_ID, path: root, addedAt: FIXED_TIMESTAMP }],
    },
  })
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  // Folder i of a level hangs under folder (i % size) of the level above.
  const dirs = []
  let previous = [root]
  REPLAYS_FOLDER_SCALE_LEVEL_SIZES.forEach((size, level) => {
    const current = []
    for (let i = 0; i < size; i += 1) {
      const dir = join(previous[i % previous.length], `f${level + 1}-${String(i).padStart(2, '0')}`)
      mkdirSync(dir, { recursive: true })
      current.push(dir)
    }
    dirs.push(...current)
    previous = current
  })

  for (let i = 0; i < REPLAYS_FOLDER_SCALE_DEMO_COUNT; i += 1) {
    const name = `fs-${String(i).padStart(4, '0')}.dm2`
    writeFileSync(join(dirs[i % dirs.length], name), REPLAYS_FIXTURE_DEMO_CONTENT, 'utf8')
  }

  // A junction pointing at its own parent: a scan that follows it never terminates.
  symlinkSync(root, join(root, REPLAYS_FOLDER_SCALE_OPEN_FOLDER, 'loop'), 'junction')

  return { userDataDir, installations: 0, configProfiles: 0 }
}
