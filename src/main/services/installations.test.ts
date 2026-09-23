import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, ok, type Installation, type InstallationSource } from '@shared/types'
import { InstallationsService } from './installations'
import { deleteInstallationFolder } from './installation-removal'
import { StateStore } from './state'

/**
 * Story 094 D2: `deleteInstallationFolder` is mocked at the module boundary, the same as
 * `installation-removal.test.ts` mocks `node:fs/promises` for its own layer down - `remove()`'s
 * disk-removal policy (who gets refused, files-before-entry ordering) is this file's concern, not
 * the real filesystem semantics `installation-removal.test.ts` already covers.
 */
vi.mock('./installation-removal', () => ({ deleteInstallationFolder: vi.fn() }))
const deleteInstallationFolderMock = vi.mocked(deleteInstallationFolder)

/**
 * Story 077 D1: the persisted-failure-record foundation - `setLastFailure`, `findByRootPath` and
 * the clear-on-playable rule `applyInspection` applies. `InstallationsService` needs no `electron`
 * mock (unlike `installation-icons.test.ts`): it only touches the filesystem and `StateStore`.
 */

let dir: string
let userData: string
let home: string
let state: StateStore
let installations: InstallationsService
let removedIds: string[]
/** Set by a test to stand in for `InstallationWriteGuard.isBlockedFor` (story 094 D2). */
let runningOverride: ((id: string) => boolean) | undefined

beforeEach(async () => {
  // `realpath` on purpose: the services under test canonicalize the paths they are handed, while
  // these fixtures inject `rootPath` into the state directly, uncanonicalized. On a CI Windows
  // runner `tmpdir()` is an 8.3 short path (`C:\Users\RUNNER~1\...`) that canonicalizing expands,
  // so a fixture path would never compare equal to the canonicalized one.
  dir = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-installations-')))
  userData = join(dir, 'userData')
  home = join(dir, 'home')
  await mkdir(userData, { recursive: true })
  await mkdir(home, { recursive: true })

  state = new StateStore(join(userData, 'state.json'))
  await state.load()

  removedIds = []
  runningOverride = undefined
  deleteInstallationFolderMock.mockReset()

  installations = new InstallationsService({
    state,
    onChange: () => {},
    onSettingsChange: () => {},
    onRemoved: async (id) => {
      removedIds.push(id)
    },
    isRunning: (id) => runningOverride?.(id) ?? false,
    userDataDir: userData,
    homeDir: home,
  })
})

afterEach(async () => {
  // The store writes `state.json` debounced; letting it finish before the temp dir goes away
  // keeps a late flush from failing against a deleted directory.
  await state.settle()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const INSTALLATION_ID = 'fixture-install'

function installation(overrides: Partial<Installation> = {}): Installation {
  // Review fix: `rootPath` derives from `id` (rather than a single fixed path every fixture
  // shares) so two installations built by this helper never collide on `rootPath` - the removal
  // safety fence (`otherInstallationRoots`) treats a shared root as a self-overlap, and a test
  // that wants to prove roots are forwarded correctly needs fixtures that are actually distinct.
  const id = overrides.id ?? INSTALLATION_ID
  return {
    id,
    name: 'Fixture',
    rootPath: join(dir, 'game', id),
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: ['baseq2'],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

/**
 * The stand-in client executable `writePlayableRoot` drops in the root: what `looksExecutable`
 * requires differs per host, so the fixture does too (story 100 D3) - a `.exe` name on Windows,
 * an extension-less file with an execute bit anywhere else.
 */
const PLAYABLE_EXECUTABLE = process.platform === 'win32' ? 'q2pro.exe' : 'q2pro'

/**
 * A root folder `inspectInstallation` reports as playable (`'ok'`/`'warning'`, never
 * `'invalid'`/`'missing'`): a `baseq2` with a pak file, and a root-level executable so
 * `looksExecutable` counts it as the client executable.
 */
async function writePlayableRoot(rootPath: string): Promise<void> {
  await mkdir(join(rootPath, 'baseq2'), { recursive: true })
  await writeFile(join(rootPath, 'baseq2', 'pak0.pak'), 'not a real pak, just needs to exist')
  await writeFile(join(rootPath, PLAYABLE_EXECUTABLE), 'stand-in executable')
  if (process.platform !== 'win32') await chmod(join(rootPath, PLAYABLE_EXECUTABLE), 0o755)
}

/** A root folder `inspectInstallation` reports as `'invalid'`: it exists, but has no `baseq2`. */
async function writeInvalidRoot(rootPath: string): Promise<void> {
  await mkdir(rootPath, { recursive: true })
}

describe('setLastFailure', () => {
  it('AC3: setLastFailure persists a machine-readable record', () => {
    state.setInstallations([installation()])

    const result = installations.setLastFailure(INSTALLATION_ID, {
      errorKey: 'downloads.error.network',
      at: 1234567,
      jobId: 'job-1',
    })

    expect(result.ok).toBe(true)
    expect(installations.find(INSTALLATION_ID)?.lastFailure).toEqual({
      errorKey: 'downloads.error.network',
      at: 1234567,
      jobId: 'job-1',
    })
  })

  it('setLastFailure(id, null) clears the field', () => {
    state.setInstallations([
      installation({ lastFailure: { errorKey: 'downloads.error.network', at: 1, jobId: 'job-1' } }),
    ])

    const result = installations.setLastFailure(INSTALLATION_ID, null)

    expect(result.ok).toBe(true)
    expect(installations.find(INSTALLATION_ID)?.lastFailure).toBeUndefined()
    expect(result.ok === true && 'lastFailure' in result.value).toBe(false)
  })

  it('reports an unknown installation instead of writing anything', () => {
    const result = installations.setLastFailure('nope', {
      errorKey: 'downloads.error.network',
      at: 1,
      jobId: 'job-1',
    })

    expect(result).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
  })
})

describe('setEngineState (story 092 D2)', () => {
  it('round-trips a written engine state and mirrors version onto detectedVersion', () => {
    state.setInstallations([installation()])

    const result = installations.setEngineState(INSTALLATION_ID, {
      version: '2.34',
      packageId: 'q2pro-win64',
    })

    expect(result.ok).toBe(true)
    const found = installations.find(INSTALLATION_ID)
    expect(found?.moduleData?.downloads).toEqual({ version: '2.34', packageId: 'q2pro-win64' })
    expect(found?.detectedVersion).toBe('2.34')
  })

  it('shallow-merges a second patch over the first', () => {
    state.setInstallations([installation()])
    installations.setEngineState(INSTALLATION_ID, { version: '2.34', packageId: 'q2pro-win64' })

    const result = installations.setEngineState(INSTALLATION_ID, { bleedingEdge: true })

    expect(result.ok).toBe(true)
    expect(installations.find(INSTALLATION_ID)?.moduleData?.downloads).toEqual({
      version: '2.34',
      packageId: 'q2pro-win64',
      bleedingEdge: true,
    })
    expect(installations.find(INSTALLATION_ID)?.detectedVersion).toBe('2.34')
  })

  it('parses a garbage moduleData back to "unknown" rather than throwing, and does not set detectedVersion', () => {
    state.setInstallations([
      installation({ moduleData: { downloads: { version: 42, backup: 'nope' } } }),
    ])

    expect(() => installations.setEngineState(INSTALLATION_ID, { bleedingEdge: true })).not.toThrow()

    const found = installations.find(INSTALLATION_ID)
    expect(found?.moduleData?.downloads).toEqual({ bleedingEdge: true })
    expect(found?.detectedVersion).toBeUndefined()
  })

  it('reports an unknown installation instead of writing anything', () => {
    const result = installations.setEngineState('nope', { version: '2.34' })
    expect(result).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
  })
})

describe('AC4: a playable verdict clears the last failure, an invalid one keeps it', () => {
  it('clears lastFailure once validate() sees a playable verdict', async () => {
    const rootPath = join(dir, 'playable')
    await writePlayableRoot(rootPath)
    state.setInstallations([
      installation({
        rootPath,
        status: 'unknown',
        lastFailure: { errorKey: 'downloads.error.network', at: 1, jobId: 'job-1' },
      }),
    ])

    const result = await installations.validate(INSTALLATION_ID)

    expect(result.ok).toBe(true)
    expect(result.ok === true && result.value.status).not.toBe('invalid')
    expect(result.ok === true && result.value.status).not.toBe('missing')
    expect(installations.find(INSTALLATION_ID)?.lastFailure).toBeUndefined()
  })

  it('leaves lastFailure untouched when validate() sees an invalid verdict', async () => {
    const rootPath = join(dir, 'invalid')
    await writeInvalidRoot(rootPath)
    const failure = { errorKey: 'downloads.error.network', at: 1, jobId: 'job-1' }
    state.setInstallations([installation({ rootPath, status: 'unknown', lastFailure: failure })])

    const result = await installations.validate(INSTALLATION_ID)

    expect(result.ok).toBe(true)
    expect(result.ok === true && result.value.status).toBe('invalid')
    expect(installations.find(INSTALLATION_ID)?.lastFailure).toEqual(failure)
  })
})

describe('applyInspection keeps a known engineKind when inspection comes back unknown (review fix, scoped to a failed installation)', () => {
  it('leaves engineKind as q2pro after validate() sees an empty/unrecognizable folder on a failed installation', async () => {
    const rootPath = join(dir, 'emptied')
    await writeInvalidRoot(rootPath)
    state.setInstallations([
      installation({
        rootPath,
        engineKind: 'q2pro',
        // The one field that makes this the case the guard protects (AC1): a bootstrap failure's
        // cleanup emptied this folder, and the installation still carries the record that says so.
        lastFailure: { errorKey: 'downloads.error.network', at: 1, jobId: 'job-1' },
      }),
    ])

    const result = await installations.validate(INSTALLATION_ID)

    expect(result.ok).toBe(true)
    expect(result.ok === true && result.value.status).toBe('invalid')
    expect(installations.find(INSTALLATION_ID)?.engineKind).toBe('q2pro')
  })

  it('AC8: an ordinary installation without a lastFailure still resets to unknown - unchanged from before this story', async () => {
    // The review finding this guards against: the fix above must not touch an installation that
    // never had a bootstrap failure. Same emptied folder, same starting engineKind, only
    // `lastFailure` is absent - which is what "an installation without the new field" (AC8) means
    // for this guard specifically.
    const rootPath = join(dir, 'emptied-no-failure')
    await writeInvalidRoot(rootPath)
    state.setInstallations([installation({ rootPath, engineKind: 'q2pro' })])

    const result = await installations.validate(INSTALLATION_ID)

    expect(result.ok).toBe(true)
    expect(result.ok === true && result.value.status).toBe('invalid')
    expect(installations.find(INSTALLATION_ID)?.engineKind).toBe('unknown')
  })
})

describe('findByRootPath', () => {
  it("matches the same way create()'s duplicate check does - canonicalized, case-insensitive where pathKey is", async () => {
    const rootPath = join(dir, 'Game')
    await mkdir(rootPath, { recursive: true })
    state.setInstallations([installation({ rootPath })])

    const found = await installations.findByRootPath(rootPath)
    expect(found?.id).toBe(INSTALLATION_ID)

    // create()'s duplicate check compares pathKey(canonicalizePath(...)), which lowercases on
    // every platform but Linux - so a differently-cased path only round-trips there too. This
    // still exercises the exact same comparison the duplicate check makes.
    if (process.platform !== 'linux') {
      const differentCase = join(dir, 'gAmE')
      expect((await installations.findByRootPath(differentCase))?.id).toBe(INSTALLATION_ID)
    }
  })

  it('returns undefined for an unrelated path', async () => {
    const rootPath = join(dir, 'game')
    await mkdir(rootPath, { recursive: true })
    state.setInstallations([installation({ rootPath })])

    const unrelated = join(dir, 'somewhere-else')
    await mkdir(unrelated, { recursive: true })

    expect(await installations.findByRootPath(unrelated)).toBeUndefined()
  })
})

describe('recordedEngineKind (story 093 finding fix, AC1)', () => {
  it('addExisting() records the freshly-inspected engine at creation time', async () => {
    const rootPath = join(dir, 'existing')
    await writePlayableRoot(rootPath)

    const result = await installations.addExisting({ rootPath })

    expect(result.ok).toBe(true)
    expect(result.ok === true && result.value.engineKind).toBe('q2pro')
    expect(result.ok === true && result.value.recordedEngineKind).toBe('q2pro')
  })

  it('create() records the caller-chosen engine at creation time', async () => {
    const rootPath = join(dir, 'created')

    const result = await installations.create({ rootPath, name: 'New install', engineKind: 'r1q2' })

    expect(result.ok).toBe(true)
    expect(result.ok === true && result.value.recordedEngineKind).toBe('r1q2')
  })

  it('survives validate() clobbering the live engineKind to unknown once the engine files disappear', async () => {
    const rootPath = join(dir, 'goes-unknown')
    await writePlayableRoot(rootPath)
    const added = await installations.addExisting({ rootPath })
    if (!added.ok) throw new Error(`fixture installation was rejected: ${added.error.key}`)
    expect(added.value.recordedEngineKind).toBe('q2pro')

    await rm(join(rootPath, PLAYABLE_EXECUTABLE))
    const result = await installations.validate(added.value.id)

    expect(result.ok).toBe(true)
    expect(result.ok === true && result.value.engineKind).toBe('unknown')
    expect(result.ok === true && result.value.recordedEngineKind).toBe('q2pro')
  })

  it('setRecordedEngineKind() writes the field directly, for a repair job to refresh it', () => {
    state.setInstallations([installation({ engineKind: 'r1q2' })])

    const result = installations.setRecordedEngineKind(INSTALLATION_ID, 'r1q2')

    expect(result.ok).toBe(true)
    expect(installations.find(INSTALLATION_ID)?.recordedEngineKind).toBe('r1q2')
  })

  it('setRecordedEngineKind() reports an unknown installation instead of writing anything', () => {
    const result = installations.setRecordedEngineKind('nope', 'r1q2')

    expect(result).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
  })
})

describe('update', () => {
  it('update persists steamClient', async () => {
    state.setInstallations([installation()])

    const result = await installations.update({ id: INSTALLATION_ID, steamClient: 4 })

    expect(result.ok).toBe(true)
    expect(result.ok === true && result.value.steamClient).toBe(4)
    expect(installations.find(INSTALLATION_ID)?.steamClient).toBe(4)
  })

  it('relocating a Steam install to a non-Steam folder clears its stale steamAppId', async () => {
    // Story 104 review fix (AC1): the appid is path-derived, so it must not outlive a move out of
    // the Steam library - unlike `executableKind`, it is never kept from a previous inspection.
    const steamappsDir = join(dir, 'library', 'steamapps')
    const steamRoot = join(steamappsDir, 'common', 'Quake 2')
    await writePlayableRoot(steamRoot)
    await writeFile(
      join(steamappsDir, 'appmanifest_2320.acf'),
      '"AppState"\n{\n\t"appid"\t\t"2320"\n\t"installdir"\t\t"Quake 2"\n}\n',
      'utf8',
    )
    state.setInstallations([installation({ rootPath: steamRoot, steamAppId: '2320' })])

    // Sanity: a revalidation that stays inside the Steam library keeps the appid.
    const kept = await installations.validate(INSTALLATION_ID)
    expect(kept.ok === true && kept.value.steamAppId).toBe('2320')

    const plainRoot = join(dir, 'plain', 'Quake 2')
    await writePlayableRoot(plainRoot)

    const result = await installations.update({ id: INSTALLATION_ID, rootPath: plainRoot })

    expect(result.ok).toBe(true)
    expect(result.ok === true && result.value.steamAppId).toBeUndefined()
    expect(installations.find(INSTALLATION_ID)?.steamAppId).toBeUndefined()
  })
})

describe('remove({ deleteFromDisk: true }) (story 094 D2)', () => {
  const STORE_SOURCES: InstallationSource[] = ['steam', 'gog', 'epic', 'bethesda']

  it.each(STORE_SOURCES)(
    'AC4: removal from disk is refused for a %s installation and deletes nothing',
    async (source) => {
      state.setInstallations([installation({ source })])

      const result = await installations.remove({ id: INSTALLATION_ID, deleteFromDisk: true })

      expect(result).toEqual({
        ok: false,
        error: { key: 'installations.error.deleteFromDiskStoreManaged' },
      })
      expect(installations.list().map((i) => i.id)).toEqual([INSTALLATION_ID])
      expect(deleteInstallationFolderMock).not.toHaveBeenCalled()
    },
  )

  it('AC5: removal from disk of a running installation is refused with the running-game reason and deletes nothing', async () => {
    state.setInstallations([installation()])
    runningOverride = (id) => id === INSTALLATION_ID

    const result = await installations.remove({ id: INSTALLATION_ID, deleteFromDisk: true })

    expect(result).toEqual({
      ok: false,
      error: { key: 'installations.error.deleteFromDiskRunning' },
    })
    expect(installations.list().map((i) => i.id)).toEqual([INSTALLATION_ID])
    expect(deleteInstallationFolderMock).not.toHaveBeenCalled()
  })

  it('AC6: a successful disk removal drops the entry, moves the active installation and tears down the icon', async () => {
    const target = installation()
    const other = installation({ id: 'other', sortOrder: 1 })
    // The harness's distinct-per-id rootPath (review fix) is what makes this assertion meaningful:
    // if it were not distinct, the real safety fence would refuse this as a self-overlap.
    expect(other.rootPath).not.toBe(target.rootPath)
    state.setInstallations([target, other])
    state.patchSettings({ activeInstallationId: INSTALLATION_ID })
    deleteInstallationFolderMock.mockResolvedValue(ok(null))

    const result = await installations.remove({ id: INSTALLATION_ID, deleteFromDisk: true })

    expect(result).toEqual({ ok: true, value: null })
    expect(installations.list().map((i) => i.id)).toEqual(['other'])
    expect(state.settings().activeInstallationId).toBe('other')
    expect(removedIds).toEqual([INSTALLATION_ID])
    // Exact match, not `objectContaining`/`expect.any(String)`: proves the RIGHT installation's
    // root was forwarded (not just "a string"), the other installation's real distinct root was
    // listed, and `userDataDir`/`homeDir` were forwarded unchanged - the same two values whose
    // missing-default fail-open the review flagged separately.
    expect(deleteInstallationFolderMock).toHaveBeenCalledWith({
      rootPath: target.rootPath,
      userDataDir: userData,
      homeDir: home,
      otherInstallationRoots: [other.rootPath],
    })
  })

  it('review fix: refuses removal from disk when userDataDir/homeDir were never supplied, without touching the disk deleter', async () => {
    const misconfigured = new InstallationsService({
      state,
      onChange: () => {},
      onSettingsChange: () => {},
      // Deliberately omitting userDataDir/homeDir - the fail-open default this guards against.
    })
    state.setInstallations([installation()])

    const result = await misconfigured.remove({ id: INSTALLATION_ID, deleteFromDisk: true })

    expect(result).toEqual({
      ok: false,
      error: { key: 'installations.error.deleteFromDiskMisconfigured' },
    })
    expect(misconfigured.list().map((i) => i.id)).toEqual([INSTALLATION_ID])
    expect(deleteInstallationFolderMock).not.toHaveBeenCalled()
  })

  it('AC7: a failed folder deletion keeps the entry, the active id and the icon, and returns a readable error key', async () => {
    state.setInstallations([installation()])
    state.patchSettings({ activeInstallationId: INSTALLATION_ID })
    deleteInstallationFolderMock.mockResolvedValue(fail('installations.error.deleteFromDiskFailed'))

    const result = await installations.remove({ id: INSTALLATION_ID, deleteFromDisk: true })

    expect(result).toEqual({
      ok: false,
      error: { key: 'installations.error.deleteFromDiskFailed' },
    })
    expect(installations.list().map((i) => i.id)).toEqual([INSTALLATION_ID])
    expect(state.settings().activeInstallationId).toBe(INSTALLATION_ID)
    expect(removedIds).toEqual([])
  })

  it('deleteFromDisk absent/false behaves exactly as today: entry-only removal, disk deleter never called', async () => {
    state.setInstallations([installation()])

    const result = await installations.remove({ id: INSTALLATION_ID })

    expect(result).toEqual({ ok: true, value: null })
    expect(installations.list()).toEqual([])
    expect(deleteInstallationFolderMock).not.toHaveBeenCalled()
  })

  it('reports an unknown installation before touching the disk-removal policy', async () => {
    const result = await installations.remove({ id: 'nope', deleteFromDisk: true })

    expect(result).toEqual({ ok: false, error: { key: 'installations.error.notFound' } })
    expect(deleteInstallationFolderMock).not.toHaveBeenCalled()
  })
})
