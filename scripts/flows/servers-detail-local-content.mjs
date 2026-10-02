// Story 192 D3: the server detail says whether the active installation has the server's mod and map.
//
// Story 192 D4: Install from the detail, into the active installation, through story 190's install job.
//
// Fixture: story 190's mods-install fixture (offline content server with the `fixturemod` catalog entry
// and its packages). Its r1q2 installation is the active one and gets `baseq2/maps/q2dm1.bsp` (loose) and
// `opentdm/pak0.pak` holding `maps/tdm1.bsp` (a minimal valid PACK written here), so its game dirs
// are baseq2 + opentdm. Five loopback responders (manual servers, every master source disabled):
//   A base game q2dm1 / B gamedir opentdm map tdm1 / C gamedir zzunknown map nomap / D gamedir ../evil map q2dm1
//   / E gamedir fixturemod (in the catalog, not on disk). The catalog is loaded, so C and D prove "no
//   Install without a catalog entry / for an unsafe name" with a catalog present.
//
// Selectors: servers-row-<address>, servers-detail, servers-detail-local-content,
// servers-detail-mod-status / -map-status (data-state), servers-detail-mod-install (must be absent).
import { createSocket } from 'node:dgram'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  MODS_INSTALL_R1Q2_ID,
  MODS_INSTALL_R1Q2_NAME,
  SERVERS_DISABLED_SOURCES,
  installationRootFilePath,
  modsFixtureFiles,
  startBootstrapFixtureServer,
  vendoredExtractorExists,
  writeModsInstallFixture,
} from '../lib/fixture.mjs'

export const variant = 'servers-detail-local-content'

const TIMEOUT_MS = 8_000
const SCAN_SETTLE_TIMEOUT_MS = 15_000
const JOB_TIMEOUT_MS = 60_000
const OOB_PREFIX = Buffer.from([0xff, 0xff, 0xff, 0xff])
const FIXED_ADDED_AT = '2026-01-01T00:00:00.000Z'

function encodeLatin1(text) {
  const bytes = Buffer.alloc(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

function buildInfoReplyBytes(serverinfoLine) {
  const parts = serverinfoLine.split('\\').slice(1)
  const kv = {}
  for (let i = 0; i + 1 < parts.length; i += 2) kv[parts[i]] = parts[i + 1]
  const count = (value) => (/^\d+$/.test(value ?? '') ? value : '0')
  const line =
    `${(kv.hostname ?? '').padStart(16)} ${(kv.mapname ?? '').padStart(8)} ` +
    `${count(kv.clients).padStart(2)}/${count(kv.maxclients).padStart(2)}\n`
  return Buffer.concat([OOB_PREFIX, encodeLatin1(`info\n${line}`)])
}

function buildStatusReplyBytes(serverinfoLine) {
  return Buffer.concat([OOB_PREFIX, encodeLatin1(`print\n${serverinfoLine}\n`)])
}

async function bindResponder(infoLine) {
  const socket = createSocket('udp4')
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const address = `127.0.0.1:${socket.address().port}`
  socket.on('message', (message, rinfo) => {
    const text = message.subarray(4).toString('latin1')
    if (text.startsWith('info'))
      socket.send(buildInfoReplyBytes(infoLine), rinfo.port, rinfo.address)
    else if (text.startsWith('status'))
      socket.send(buildStatusReplyBytes(infoLine), rinfo.port, rinfo.address)
  })
  return { socket, address, closed: false }
}

function serverInfo(name, map, modKey) {
  return (
    `${modKey}\\hostname\\${name}\\mapname\\${map}\\clients\\0\\maxclients\\16` +
    '\\protocol\\35\\deathmatch\\1\\version\\3.20'
  )
}

/** A minimal valid PACK: header, 4 data bytes, then one 64-byte directory entry. */
function buildPack(entryName) {
  const data = Buffer.from('BSP!')
  const header = Buffer.alloc(12)
  header.write('PACK', 0, 'latin1')
  header.writeInt32LE(12 + data.length, 4)
  header.writeInt32LE(64, 8)
  const entry = Buffer.alloc(64)
  entry.write(entryName, 0, 'latin1')
  entry.writeInt32LE(12, 56)
  entry.writeInt32LE(data.length, 60)
  return Buffer.concat([header, data, entry])
}

function writeFileDeep(path, bytes) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

let catalogServer = null
let servers = {}
let responders = []

export async function setup() {
  if (!vendoredExtractorExists()) {
    throw new Error('resources/bin/7za.exe is missing - run `npm run fetch:7za` first.')
  }
  catalogServer = await startBootstrapFixtureServer({ includeR1q2: true, modsInstall: true })
  servers = {
    A: await bindResponder(serverInfo('Fixture Server A', 'q2dm1', '\\gamename\\baseq2')),
    B: await bindResponder(serverInfo('Fixture Server B', 'tdm1', '\\gamename\\opentdm')),
    C: await bindResponder(serverInfo('Fixture Server C', 'nomap', '\\gamename\\zzunknown')),
    D: await bindResponder(serverInfo('Fixture Server D', 'q2dm1', '\\gamename\\../evil')),
    E: await bindResponder(serverInfo('Fixture Server E', 'fm1', '\\gamename\\fixturemod')),
  }
  responders = Object.values(servers)

  writeModsInstallFixture({
    variant,
    stateOverrides: {
      servers: {
        sources: SERVERS_DISABLED_SOURCES,
        favourites: [],
        manualServers: responders.map((r) => ({
          address: r.address,
          origin: 'manual',
          addedAt: FIXED_ADDED_AT,
        })),
        history: [],
        scan: {
          concurrency: 4,
          timeoutMs: 500,
          retries: 0,
          minSpacingMs: 0,
          autoScanOnOpen: false,
          autoRefreshEnabled: false,
          autoRefreshIntervalMs: 60_000,
        },
      },
    },
  })

  // The active installation's real files (written after the fixture reseeded its root).
  writeFileDeep(
    installationRootFilePath(MODS_INSTALL_R1Q2_ID, 'baseq2/maps/q2dm1.bsp'),
    Buffer.from('BSP!'),
  )
  writeFileDeep(
    installationRootFilePath(MODS_INSTALL_R1Q2_ID, 'opentdm/pak0.pak'),
    buildPack('maps/tdm1.bsp'),
  )

  return { env: { Q2L_UI_CONTENT_REPO_BASE: catalogServer.baseUrl } }
}

export async function teardown() {
  await Promise.all(
    responders.map(
      (r) =>
        !r.closed && ((r.closed = true), new Promise((resolve) => r.socket.close(() => resolve()))),
    ),
  )
  await catalogServer?.close()
}

async function runScan(page, testId) {
  const status = page.getByTestId('servers-scan-status')
  const before = (await status.getAttribute('data-finished-at')) ?? ''
  await page.getByTestId(testId).click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (previous) => {
      const el = document.querySelector('[data-testid="servers-scan-status"]')
      const at = el?.getAttribute('data-finished-at') ?? ''
      return el?.getAttribute('data-running') === 'false' && at !== '' && at !== previous
    },
    before,
    { timeout: SCAN_SETTLE_TIMEOUT_MS },
  )
}

/** Selects a server, then scopes a refresh to it: the mod (`gamename`) only arrives with the
 * stage-2 `status` reply, which a scan sends for the selected server alone. */
async function selectServer(page, key) {
  await page.getByTestId(`servers-row-${servers[key].address}`).click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (name) =>
      document.querySelector('[data-testid="servers-detail-field-name"]')?.textContent === name,
    `Fixture Server ${key}`,
    { timeout: TIMEOUT_MS },
  )
  await runScan(page, 'servers-refresh-selected')
}

async function expectState(page, testId, state, text) {
  const el = page.getByTestId(testId)
  await el.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const actual = await el.getAttribute('data-state')
  const actualText = (await el.textContent())?.trim()
  if (actual !== state || actualText !== text) {
    throw new Error(
      `${testId}: expected ${state} / ${JSON.stringify(text)}, got ${actual} / ${JSON.stringify(actualText)}`,
    )
  }
}

export default async function serversDetailLocalContent({ page, step, shot }) {
  await page
    .getByRole('button', { name: MODS_INSTALL_R1Q2_NAME, exact: true })
    .click({ timeout: TIMEOUT_MS })
  await page.getByTestId('nav-servers').click({ timeout: TIMEOUT_MS })
  const refreshAll = page.getByTestId('servers-refresh')
  await refreshAll.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  const before =
    (await page.getByTestId('servers-scan-status').getAttribute('data-finished-at')) ?? ''
  await refreshAll.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    (previous) => {
      const el = document.querySelector('[data-testid="servers-scan-status"]')
      const at = el?.getAttribute('data-finished-at') ?? ''
      return el?.getAttribute('data-running') === 'false' && at !== '' && at !== previous
    },
    before,
    { timeout: SCAN_SETTLE_TIMEOUT_MS },
  )

  step(
    'server B on opentdm says mod installed, server C on an unknown mod says mod missing, base-game server A shows no mod statement',
  )
  await selectServer(page, 'B')
  await expectState(page, 'servers-detail-mod-status', 'installed', 'Mod installed')
  await shot('detail-server-b-mod-installed')
  await selectServer(page, 'C')
  await expectState(page, 'servers-detail-mod-status', 'missing', 'Mod missing')
  await shot('detail-server-c-mod-missing')
  await selectServer(page, 'A')
  await page.getByTestId('servers-detail-local-content').waitFor({ timeout: TIMEOUT_MS })
  if ((await page.getByTestId('servers-detail-mod-status').count()) !== 0) {
    throw new Error('base-game server A must show no mod statement')
  }

  step(
    "a loose baseq2 map and a map inside the mod's pak read map available, an absent map reads map missing — the server will send it",
  )
  await expectState(page, 'servers-detail-map-status', 'available', 'Map available')
  await selectServer(page, 'B')
  await expectState(page, 'servers-detail-map-status', 'available', 'Map available')
  await selectServer(page, 'C')
  await expectState(
    page,
    'servers-detail-map-status',
    'missing',
    'Map missing — the server will send it',
  )

  step('an unsafe gamedir is shown as text, says mod missing and offers no Install')
  await selectServer(page, 'D')
  await expectState(page, 'servers-detail-mod-status', 'missing', 'Mod missing')
  const modField = (await page.getByTestId('servers-detail-field-mod').textContent())?.trim()
  if (modField !== '../evil') {
    throw new Error(`expected the unsafe gamedir shown as text, got ${JSON.stringify(modField)}`)
  }
  if ((await page.getByTestId('servers-detail-mod-install').count()) !== 0) {
    throw new Error('an unsafe gamedir must offer no Install')
  }
  await shot('detail-server-d-unsafe-gamedir')

  step('a missing mod with no catalog entry shows no Install button and keeps the statement')
  await selectServer(page, 'C')
  await expectState(page, 'servers-detail-mod-status', 'missing', 'Mod missing')
  if ((await page.getByTestId('servers-detail-mod-install').count()) !== 0) {
    throw new Error('a mod with no catalog entry must offer no Install')
  }

  step(
    'a missing catalog mod offers Install and clicking it starts the install job into the active installation',
  )
  await selectServer(page, 'E')
  await expectState(page, 'servers-detail-mod-status', 'missing', 'Mod missing')
  const install = page.getByTestId('servers-detail-mod-install')
  await install.waitFor({ state: 'visible', timeout: TIMEOUT_MS })
  if ((await install.textContent())?.trim() !== 'Install')
    throw new Error('expected an Install button')
  await shot('detail-server-e-install')
  await install.click({ timeout: TIMEOUT_MS })
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="servers-detail-mod-install"]')
      return (
        el instanceof HTMLButtonElement && el.disabled && el.textContent?.trim() === 'Installing…'
      )
    },
    undefined,
    { timeout: TIMEOUT_MS },
  )
  await shot('detail-server-e-installing')

  step(
    'after the install job finishes the statement reads mod installed without reopening the detail',
  )
  await page
    .getByTestId('servers-detail-mod-install')
    .waitFor({ state: 'detached', timeout: JOB_TIMEOUT_MS })
  await expectState(page, 'servers-detail-mod-status', 'installed', 'Mod installed')
  for (const [name, expected] of Object.entries(modsFixtureFiles)) {
    const actual = readFileSync(
      installationRootFilePath(MODS_INSTALL_R1Q2_ID, `fixturemod/${name}`),
    )
    if (!actual.equals(expected))
      throw new Error(`fixturemod/${name} differs from the package bytes`)
  }
  await shot('detail-server-e-installed')

  console.log(
    'servers-detail-local-content: mod installed/missing/none and map available/missing statements ' +
      'render from the installation; an unsafe gamedir is text only.',
  )
}
