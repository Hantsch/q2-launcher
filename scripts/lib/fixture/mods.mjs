import { dirname, join } from 'node:path'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import {
  BOOTSTRAP_ENGINE_FIXTURE_ID,
  R1Q2_FIXTURE_ENGINE_ID,
  RETAIL_PAK_SIZES,
  buildFixturePackage,
  filler,
  writeFileIn,
  writeSizedFile,
} from './bootstrap.mjs'
import { writePopulatedFixture } from './populated.mjs'
import {
  FIXED_TIMESTAMP,
  STATE_FILE,
  gameRoot,
  installationRootFilePath,
  rmDirBestEffort,
  writeJson,
} from './core.mjs'
import { makeInstallation } from './installations.mjs'
import { REPLAYS_PLAY_MISSING_MOD, writeReplaysPlayFixture } from './replays-play.mjs'

// --- story 190 D7: the mods-install fixture ------------------------------------------------------

/** Expected bytes per gamedir-relative path - what `fixturemod`'s win32/x86 library variant (and, for
 * `pak0.pak`, its content-only variant) must put on disk. */
export const modsFixtureFiles = {
  'gamex86.dll': filler(24 * 1024, 0x6d),
  'pak0.pak': filler(8 * 1024, 0x70),
}

/** The content-only variant ships only a pak0.pak, with its own bytes. */
export const modsFixtureContentOnlyFiles = { 'pak0.pak': filler(6 * 1024, 0x63) }

export const MODS_INSTALL_R1Q2_ID = 'fixture-install-mods-r1q2'

export const MODS_INSTALL_R1Q2_NAME = 'Fixture Mods R1Q2 Install'

export const MODS_INSTALL_Q2PRO_ID = 'fixture-install-mods-q2pro'

export const MODS_INSTALL_Q2PRO_NAME = 'Fixture Mods Q2PRO Install'

export function buildModsInstallPackages() {
  const zip = (fileName, files) =>
    buildFixturePackage({
      fileName,
      stagingName: fileName.replace(/\.zip$/, ''),
      entries: Object.keys(files),
      build: (staging) => {
        for (const [name, bytes] of Object.entries(files)) writeFileIn(staging, name, bytes)
      },
    })
  const library = zip('fixturemod-win32-x86.zip', modsFixtureFiles)
  const content = zip('fixturemod-content.zip', modsFixtureContentOnlyFiles)
  const bad = zip('fixturebad-content.zip', modsFixtureContentOnlyFiles)
  return {
    library,
    content,
    bad,
    packages: [library, content, { ...bad, corrupt: true }],
  }
}

export function modsInstallManifestEntries({ library, content, bad }, baseUrl) {
  const pkg = (id, info) => ({
    id,
    version: 'v1.0.0',
    // Never routed: answers 404, then the mirror serves.
    url: `${baseUrl}/modpkg/${info.fileName}`,
    mirrors: [`${baseUrl}/mirror/${info.fileName}`],
    sizeBytes: info.sizeBytes,
    sha256: info.sha256,
    contents: [{ from: '.', to: 'gamedir' }],
  })
  const entry = (gamedir, name, packages) => ({
    id: gamedir,
    gamedir,
    name,
    description: `Fixture description: ${name}.`,
    license: 'GPL-2.0',
    projectUrl: `https://example.invalid/${gamedir}`,
    sourceUrl: `https://example.invalid/${gamedir}/src`,
    pinned: 'v1.0.0',
    versions: [{ version: 'v1.0.0', prerelease: false, ...packages }],
  })
  return [
    entry('fixturemod', 'Fixture Install Mod', {
      variants: [
        { platform: 'win32', arch: 'x86', packages: [pkg('fixturemod-win32-x86', library)] },
      ],
      contentOnly: { packages: [pkg('fixturemod-content', content)] },
    }),
    entry('fixturebad', 'Fixture Bad Checksum Mod', {
      variants: [],
      contentOnly: { packages: [pkg('fixturebad-content', bad)] },
    }),
  ]
}

/**
 * Reseeds `populated` and adds two real, temp-rooted installations - an r1q2 (manifest arch `x86`) and
 * a q2pro (`x86_64`) - each recording its fixture engine `packageId` under `moduleData.downloads`, so
 * the engine arch comes from the manifest and not from an (empty, non-PE) executable. Written into
 * `state.json` here rather than into `populatedInstallations()`, so no other flow's counts move.
 */
export function writeModsInstallFixture({ variant = 'populated', stateOverrides = {} } = {}) {
  const { userDataDir } = writePopulatedFixture({ variant, stateOverrides })
  const make = (id, name, engineKind, exe, packageId, sortOrder) => {
    const root = join(gameRoot(), id)
    rmDirBestEffort(root)
    mkdirSync(join(root, 'baseq2'), { recursive: true })
    writeFileSync(join(root, exe), '')
    for (const pak of ['pak0.pak', 'pak1.pak', 'pak2.pak']) {
      writeSizedFile(join(root, 'baseq2', pak), RETAIL_PAK_SIZES[pak])
    }
    return makeInstallation({
      id,
      name,
      rootPath: root,
      engineKind,
      favorite: false,
      sortOrder,
      moduleData: { downloads: { version: 'fixture-mods', packageId } },
    })
  }
  const statePath = join(userDataDir, STATE_FILE)
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  state.installations.push(
    make(
      MODS_INSTALL_R1Q2_ID,
      MODS_INSTALL_R1Q2_NAME,
      'r1q2',
      'r1q2.exe',
      R1Q2_FIXTURE_ENGINE_ID,
      90,
    ),
    make(
      MODS_INSTALL_Q2PRO_ID,
      MODS_INSTALL_Q2PRO_NAME,
      'q2pro',
      'q2pro.exe',
      BOOTSTRAP_ENGINE_FIXTURE_ID,
      91,
    ),
  )
  writeJson(statePath, state)
  return { userDataDir }
}

// --- story 193 D2: the replays mod-install fixture ----------------------------------------------

/** One hash-correct zip whose single `pak0.pak` lands in the mod's game dir (`contents: . -> gamedir`);
 * the pak makes the inspector's `isGameDir` hold, so `opentdm` is listed once installed. */
export function buildModsReplaysPackage() {
  return buildFixturePackage({
    fileName: 'opentdm-replays-fixture.zip',
    stagingName: 'opentdm-replays-fixture',
    entries: ['pak0.pak'],
    build: (staging) => writeFileIn(staging, 'pak0.pak', filler(4 * 1024, 0x6f)),
  })
}

/** `action` is always listed; `opentdm` only with `withOpentdm`. Each entry carries a library variant
 * for this host (both arches, so the stub engine's header decides nothing) plus a content-only set. */
export function modsReplaysManifestEntries(info, baseUrl, withOpentdm) {
  const platform = process.platform === 'win32' ? 'win32' : 'linux'
  const pkg = (id) => ({
    id,
    version: 'v1.0.0',
    url: `${baseUrl}/modpkg/${info.fileName}`,
    mirrors: [`${baseUrl}/mirror/${info.fileName}`],
    sizeBytes: info.sizeBytes,
    sha256: info.sha256,
    contents: [{ from: '.', to: 'gamedir' }],
  })
  const entry = (gamedir, name) => ({
    id: gamedir,
    gamedir,
    name,
    description: `Fixture description: ${name}.`,
    license: 'GPL-2.0',
    projectUrl: `https://example.invalid/${gamedir}`,
    sourceUrl: `https://example.invalid/${gamedir}/src`,
    pinned: 'v1.0.0',
    versions: [
      {
        version: 'v1.0.0',
        prerelease: false,
        variants: ['x86', 'x64'].map((arch) => ({
          platform,
          arch,
          packages: [pkg(`${gamedir}-${platform}-${arch}`)],
        })),
        contentOnly: { packages: [pkg(`${gamedir}-content`)] },
      },
    ],
  })
  return [entry('action', 'Action Quake II'), ...(withOpentdm ? [entry('opentdm', 'OpenTDM')] : [])]
}

/**
 * The `replays-play` install (stub q2pro, demo `play-tdm.dm2` needing the missing `opentdm`) for the
 * install-offer flow. The catalog is served separately - start `startBootstrapFixtureServer({
 * modsReplays: { withOpentdm: true } })` and hand its `baseUrl` over as `Q2L_UI_CONTENT_REPO_BASE`.
 */
export function writeReplaysModInstallFixture() {
  const result = writeReplaysPlayFixture(REPLAYS_MOD_INSTALL_VARIANT)
  // The play fixture pre-creates an empty `opentdm` dir for "play anyway"; here the mod is truly absent,
  // else the install would stop at 190's "folder already exists" decision.
  rmDirBestEffort(join(result.installRoot, REPLAYS_PLAY_MISSING_MOD))
  return result
}

export const REPLAYS_MOD_INSTALL_VARIANT = 'replays-mod-install'

// --- story 191 D3: the mods-remove fixture ------------------------------------------------------

export const INSTALL_MODS_REMOVE_ID = 'fixture-install-mods-remove'

export const INSTALL_MODS_REMOVE_NAME = 'Fixture Mods Remove Install'

/** Bytes the launcher "installed" per game dir; every record below carries their size and sha256. */
export const modsRemoveFiles = {
  ctf: {
    'gamex86.dll': filler(12 * 1024, 0x31),
    'pak0.pak': filler(4 * 1024, 0x32),
  },
  opentdm: {
    'gamex86.dll': filler(10 * 1024, 0x33),
    'maps/tdm1.bsp': filler(3 * 1024, 0x34),
    'opentdm.cfg': Buffer.from('set tdm_original 1\n'),
  },
}

/** What `opentdm/opentdm.cfg` holds on disk: the user changed it after the "install". */
export const MODS_REMOVE_EDITED_CFG = Buffer.from('set tdm_original 0 // my own tuning\n')

/** A file the user put into `opentdm/` themselves - never in a record, so removal keeps it. */
export const MODS_REMOVE_DEMO_PATH = 'demos/mine.dm2'

/**
 * Reseeds `populated` and adds one installation with two catalog-installed mods (`ctf`, `opentdm`) as
 * story 190's records describe them. `ctf` is the active game directory; `opentdm`'s cfg was edited.
 */
export function writeModsRemoveFixture() {
  const { userDataDir } = writePopulatedFixture()
  const root = join(gameRoot(), INSTALL_MODS_REMOVE_ID)
  rmDirBestEffort(root)
  mkdirSync(join(root, 'baseq2'), { recursive: true })
  writeFileSync(join(root, 'r1q2.exe'), '')
  for (const pak of ['pak0.pak', 'pak1.pak', 'pak2.pak']) {
    writeSizedFile(join(root, 'baseq2', pak), RETAIL_PAK_SIZES[pak])
  }
  const records = []
  for (const [gameDir, files] of Object.entries(modsRemoveFiles)) {
    for (const [name, bytes] of Object.entries(files)) {
      const onDisk =
        gameDir === 'opentdm' && name === 'opentdm.cfg' ? MODS_REMOVE_EDITED_CFG : bytes
      writeMods191File(join(root, gameDir, name), onDisk)
    }
    records.push({
      catalogId: gameDir,
      gameDir,
      version: 'v1.0.0',
      variantId: `${gameDir}-win32-x86`,
      engineKind: 'r1q2',
      arch: 'x86',
      platform: 'win32',
      contentOnly: false,
      installedAt: Date.parse(FIXED_TIMESTAMP),
      files: Object.entries(files).map(([path, bytes]) => ({
        path,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })),
    })
  }
  writeMods191File(join(root, 'opentdm', MODS_REMOVE_DEMO_PATH), Buffer.from('my demo'))
  const statePath = join(userDataDir, STATE_FILE)
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  state.installations.push({
    ...makeInstallation({
      id: INSTALL_MODS_REMOVE_ID,
      name: INSTALL_MODS_REMOVE_NAME,
      rootPath: root,
      engineKind: 'r1q2',
      favorite: false,
      sortOrder: 92,
      gameDirs: ['baseq2', 'ctf', 'opentdm'],
      moduleData: { mods: { records } },
    }),
    activeGameDir: 'ctf',
  })
  writeJson(statePath, state)
  return { userDataDir }
}

function writeMods191File(path, bytes) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

// --- story 194 D4: the mods-update fixture ------------------------------------------------------

export const INSTALL_MODS_UPDATE_ID = 'fixture-install-mods-update'

export const INSTALL_MODS_UPDATE_NAME = 'Fixture Mods Update Install'

export const MODS_UPDATE_USER_FILE = 'demos/mine.dm2'

export const MODS_UPDATE_USER_BYTES = Buffer.from('my own demo')

/** What the OLD (v1.0.0) records say is on disk, and what the NEW (v1.1.0) opentdm package ships. */
export const modsUpdateOldFiles = {
  opentdm: {
    'gamex86.dll': filler(10 * 1024, 0x41),
    'pak0.pak': filler(2 * 1024, 0x42),
    'old-only.txt': Buffer.from('only in the old version\n'),
  },
  action: {
    'gamex86.dll': filler(9 * 1024, 0x51),
    'pak0.pak': filler(2 * 1024, 0x52),
  },
}

export const modsUpdateNewOpentdmFiles = {
  'gamex86.dll': filler(11 * 1024, 0x61),
  'pak0.pak': filler(2 * 1024, 0x42),
  'new-only.txt': Buffer.from('only in the new version\n'),
}

export const modsUpdateNewActionFiles = {
  'gamex86.dll': filler(9 * 1024, 0x71),
  'pak0.pak': filler(2 * 1024, 0x72),
}

export const modsUpdateManualFiles = {
  'gamex86.dll': filler(8 * 1024, 0x81),
  'pak0.pak': filler(2 * 1024, 0x82),
}

export function buildModsUpdatePackages() {
  const zip = (fileName, files) =>
    buildFixturePackage({
      fileName,
      stagingName: fileName.replace(/\.zip$/, ''),
      entries: Object.keys(files),
      build: (staging) => {
        for (const [name, bytes] of Object.entries(files)) writeFileIn(staging, name, bytes)
      },
    })
  return {
    opentdm: zip('opentdm-update-win32-x86.zip', modsUpdateNewOpentdmFiles),
    action: zip('action-update-win32-x86.zip', modsUpdateNewActionFiles),
  }
}

export function modsUpdateManifestEntries(mods, baseUrl) {
  const pkg = (id, info, wrongSha) => ({
    id,
    version: 'v1.1.0',
    url: `${baseUrl}/modpkg/${info.fileName}`,
    mirrors: [`${baseUrl}/mirror/${info.fileName}`],
    sizeBytes: info.sizeBytes,
    sha256: wrongSha ? createHash('sha256').update('not the package').digest('hex') : info.sha256,
    contents: [{ from: '.', to: 'gamedir' }],
  })
  const entry = (gamedir, name, info, wrongSha) => ({
    id: gamedir,
    gamedir,
    name,
    description: `Fixture description: ${name}.`,
    license: 'GPL-2.0',
    projectUrl: `https://example.invalid/${gamedir}`,
    sourceUrl: `https://example.invalid/${gamedir}/src`,
    pinned: 'v1.1.0',
    versions: [
      { version: 'v1.0.0', prerelease: false, variants: [], contentOnly: { packages: [] } },
      {
        version: 'v1.1.0',
        prerelease: false,
        variants: [
          {
            platform: 'win32',
            arch: 'x86',
            packages: [pkg(`${gamedir}-win32-x86`, info, wrongSha)],
          },
        ],
        contentOnly: { packages: [] },
      },
    ],
  })
  return [
    entry('opentdm', 'Fixture OpenTDM', mods.opentdm, false),
    entry('action', 'Fixture Action Quake', mods.action, true),
    entry('ctf', 'Fixture Capture The Flag', mods.opentdm, false),
  ]
}

/**
 * Reseeds `populated` and adds one r1q2 installation with `opentdm` and `action` installed at v1.0.0 from
 * the catalog (records written like story 190's install, real sha256/size of the bytes on disk), a user
 * file `opentdm/demos/mine.dm2` in no record, and a hand-made `ctf` folder with no record.
 */
export function writeModsUpdateFixture() {
  const { userDataDir } = writePopulatedFixture()
  const root = join(gameRoot(), INSTALL_MODS_UPDATE_ID)
  rmDirBestEffort(root)
  mkdirSync(join(root, 'baseq2'), { recursive: true })
  writeFileSync(join(root, 'r1q2.exe'), '')
  for (const pak of ['pak0.pak', 'pak1.pak', 'pak2.pak']) {
    writeSizedFile(join(root, 'baseq2', pak), RETAIL_PAK_SIZES[pak])
  }
  const records = []
  for (const [gameDir, files] of Object.entries(modsUpdateOldFiles)) {
    for (const [name, bytes] of Object.entries(files))
      writeMods191File(join(root, gameDir, name), bytes)
    records.push({
      catalogId: gameDir,
      gameDir,
      version: 'v1.0.0',
      variantId: `${gameDir}-win32-x86`,
      engineKind: 'r1q2',
      arch: 'x86',
      platform: 'win32',
      contentOnly: false,
      installedAt: Date.parse(FIXED_TIMESTAMP),
      files: Object.entries(files).map(([path, bytes]) => ({
        path,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })),
    })
  }
  writeMods191File(join(root, 'opentdm', MODS_UPDATE_USER_FILE), MODS_UPDATE_USER_BYTES)
  for (const [name, bytes] of Object.entries(modsUpdateManualFiles))
    writeMods191File(join(root, 'ctf', name), bytes)
  const statePath = join(userDataDir, STATE_FILE)
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  state.installations.push(
    makeInstallation({
      id: INSTALL_MODS_UPDATE_ID,
      name: INSTALL_MODS_UPDATE_NAME,
      rootPath: root,
      engineKind: 'r1q2',
      favorite: false,
      sortOrder: 93,
      gameDirs: ['baseq2', 'ctf', 'opentdm', 'action'],
      moduleData: {
        downloads: { version: 'fixture-mods', packageId: R1Q2_FIXTURE_ENGINE_ID },
        mods: { records },
      },
    }),
  )
  writeJson(statePath, state)
  return { userDataDir }
}

/**
 * Story 190 D8: seeds `<root>/<gamedir>/<relativePath>` of installation `id` with `bytes`, as a
 * folder the user made by hand (no install record). Returns the file's path.
 */
export function writeManualGamedirFile(id, gamedir, relativePath, bytes) {
  const path = installationRootFilePath(id, `${gamedir}/${relativePath}`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
  return path
}

/**
 * Story 100 D8 (AC7): the "no engine for this platform" host process never actually runs on
 * (`process.platform` is always `'win32'`, `'linux'` or `'darwin'` - see `manifest-parse.ts`'s
 * `packagePlatforms()`) - a literal that can never equal the running host's own platform, on any
 * machine this flow runs on (a dev box or either CI leg), so the fixture manifest below is honest
 * everywhere rather than only off one specific host.
 */
const NO_ENGINE_FOR_PLATFORM_PLATFORM = 'q2l-fixture-unsupported-platform'

/**
 * Story 189 D4: the mod catalog fixture - three entries (action, opentdm, ctf) with distinctive
 * names/descriptions so the Mods flow can tell catalog text from folder names. Passes the D2
 * parser (`src/main/modules/mods/catalog-schema.ts`). Exported so the flow can also seed the
 * catalog cache file with the same entries.
 */
export function modsCatalogFixtureEntries() {
  const entry = (gamedir, name, description) => ({
    id: gamedir,
    gamedir,
    name,
    description,
    license: 'GPL-2.0',
    projectUrl: `https://example.invalid/${gamedir}`,
    sourceUrl: `https://example.invalid/${gamedir}/src`,
    pinned: 'v1.0.0',
    versions: [
      ['v1.0.0', false],
      ['v1.1.0-rc1', true],
    ].map(([version, prerelease]) => ({
      version,
      prerelease,
      variants: [],
      contentOnly: {
        packages: [
          {
            id: `${gamedir}-fixture-content`,
            version,
            url: `https://example.invalid/${gamedir}.zip`,
            mirrors: [],
            sizeBytes: 1024,
            sha256: createHash('sha256').update(`${gamedir}-fixture`).digest('hex'),
            contents: [{ from: '.', to: 'gamedir' }],
          },
        ],
      },
    })),
  })
  return [
    entry(
      'action',
      'Fixture Action Quake',
      'Fixture description: realistic teamplay with bandaging.',
    ),
    entry('opentdm', 'Fixture OpenTDM', 'Fixture description: organised team deathmatch matches.'),
    entry('ctf', 'Fixture Capture The Flag', 'Fixture description: steal the enemy flag.'),
  ]
}

/**
 * Story 189 D4: serves `/mods/manifest.json` in one of four modes - `ok`, `bad-row` (one invalid
 * entry between two good ones), `bad-envelope` (refused whole) and `down` (HTTP 500). The mode is
 * switchable at runtime, but the flow launches one app per mode (the app's 15-minute freshness
 * window would mask a mid-session switch).
 */
export async function startModsCatalogFixtureServer({ mode = 'ok' } = {}) {
  const requested = []
  let currentMode = mode

  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    requested.push(path)
    if (path !== '/mods/manifest.json') {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }
    if (currentMode === 'down') {
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end('down')
      return
    }
    const [action, opentdm, ctf] = modsCatalogFixtureEntries()
    let body
    if (currentMode === 'bad-envelope') body = { entries: 'not-a-list' }
    else if (currentMode === 'bad-row') {
      body = {
        schemaVersion: 1,
        entries: [action, { id: 'broken', gamedir: '../escape', name: 'Broken Row' }, opentdm],
      }
    } else body = { schemaVersion: 1, entries: [action, opentdm, ctf] }
    const bytes = Buffer.from(JSON.stringify(body), 'utf8')
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': bytes.byteLength,
    })
    response.end(bytes)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requested,
    setMode: (next) => {
      currentMode = next
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

/**
 * Story 100 D8 (AC7): a second, much smaller fixture server than `startBootstrapFixtureServer()`
 * above, for `scripts/flows/bootstrap-no-engine-for-platform.mjs` - the D7/D8 "manifest pins
 * something, just not for this host" case (`bootstrapEngineOptions`'s `emptyReason:
 * 'none-for-platform'`, `src/main/modules/downloads/index.ts`).
 *
 * `engines/manifest.json` pins Q2PRO, but only for `NO_ENGINE_FOR_PLATFORM_PLATFORM` above - a
 * platform no real host ever reports as - so `hasAnyPin` is true (the manifest DOES configure a
 * pin) while `pinnedEnginePackage()` resolves nothing for the running host, which is exactly what
 * turns an empty `options` array into `'none-for-platform'` rather than `'none-pinned'`
 * (`manifest-parse.ts`'s `resolvePinned`/`packageRunsOnPlatform`). `gamedata/manifest.json` carries
 * no packages and no pins at all - `ManifestService.fetchAndMerge()` needs both files to parse, but
 * nothing about this flow ever reaches a package download, so it only has to be a well-formed,
 * empty envelope.
 *
 * Unlike `startBootstrapFixtureServer()`, no archive is staged and no `/packages/...` route is
 * registered at all: the flow never gets past the engine step's empty state, so a request there
 * would be this fixture's own bug, not something to serve.
 */
export async function startNoEngineForPlatformFixtureServer() {
  const routes = new Map()
  const requested = []

  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    requested.push(path)
    const route = routes.get(path)
    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }
    route(response)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`

  const jsonRoute = (body) => (response) => {
    const bytes = Buffer.from(JSON.stringify(body), 'utf8')
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': bytes.byteLength,
    })
    response.end(bytes)
  }

  const packageId = 'q2pro-fixture-unsupported-platform'
  routes.set(
    '/engines/manifest.json',
    jsonRoute({
      schemaVersion: 1,
      packages: [
        {
          id: packageId,
          version: 'fixture-unsupported-1',
          sizeBytes: 1024,
          sha256: createHash('sha256').update(packageId).digest('hex'),
          url: `${baseUrl}/packages/${packageId}.zip`,
          mirrors: [`${baseUrl}/mirror/${packageId}.zip`],
          contents: [{ from: '.', to: 'root' }],
          kind: 'engine',
          engine: 'q2pro',
          platforms: [NO_ENGINE_FOR_PLATFORM_PLATFORM],
        },
      ],
      pinned: { q2pro: { [NO_ENGINE_FOR_PLATFORM_PLATFORM]: packageId } },
    }),
  )
  routes.set('/gamedata/manifest.json', jsonRoute({ schemaVersion: 1, packages: [] }))

  return {
    baseUrl,
    requested,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

/**
 * Every entry in `targetPath`, one level deep, as `{ dirs, files }`. Read from Node rather than
 * scraped off the UI, because AC8 is a statement about the filesystem, not about a rendered list.
 */
export function readTargetTree(targetPath) {
  const dirs = []
  const files = []
  for (const name of readdirSync(targetPath)) {
    if (statSync(join(targetPath, name)).isDirectory()) dirs.push(name)
    else files.push(name)
  }
  return { dirs: dirs.sort(), files: files.sort() }
}
