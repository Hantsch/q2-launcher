import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Installation } from '@shared/types'
import { InstallationsService } from './installations'
import { StateStore } from './state'

/**
 * Story 077 D1: the persisted-failure-record foundation - `setLastFailure`, `findByRootPath` and
 * the clear-on-playable rule `applyInspection` applies. `InstallationsService` needs no `electron`
 * mock (unlike `installation-icons.test.ts`): it only touches the filesystem and `StateStore`.
 */

let dir: string
let userData: string
let state: StateStore
let installations: InstallationsService

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-installations-'))
  userData = join(dir, 'userData')
  await mkdir(userData, { recursive: true })

  state = new StateStore(join(userData, 'state.json'))
  await state.load()

  installations = new InstallationsService({
    state,
    onChange: () => {},
    onSettingsChange: () => {},
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
  return {
    id: INSTALLATION_ID,
    name: 'Fixture',
    rootPath: join(dir, 'game'),
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
 * A root folder `inspectInstallation` reports as playable (`'ok'`/`'warning'`, never
 * `'invalid'`/`'missing'`): a `baseq2` with a pak file, and a root-level `.exe` so `looksExecutable`
 * counts it as the client executable (this test suite runs against the Windows node binary even
 * under WSL, so `.exe` - not "no dot in the name" - is what `looksExecutable` actually requires
 * here).
 */
async function writePlayableRoot(rootPath: string): Promise<void> {
  await mkdir(join(rootPath, 'baseq2'), { recursive: true })
  await writeFile(join(rootPath, 'baseq2', 'pak0.pak'), 'not a real pak, just needs to exist')
  await writeFile(join(rootPath, 'q2pro.exe'), 'stand-in executable')
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
