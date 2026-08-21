import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { renderProfileFile } from '@shared/config/render'
import type { Installation, LaunchState } from '@shared/types'
import type { Logger } from '../../lib/logger'
import { pathExists } from '../../lib/fs-utils'
import { BACKUP_SUFFIX } from './backup'
import { syncProfile } from './sync'
import type { SyncProfileDeps } from './sync'

/**
 * Two throwaway temp dirs per test: `userDataDir` stands in for
 * `app.getPath('userData')` (the canonical file's home), `rootDir` stands in
 * for an installation's `rootPath`. Kept separate, like the real app would
 * have them, rather than nested - so a test asserting "nothing touched the
 * other one" is not accidentally trivially true.
 */
let userDataDir: string
let rootDir: string

beforeEach(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'q2-launcher-sync-userdata-'))
  rootDir = await mkdtemp(join(tmpdir(), 'q2-launcher-sync-root-'))
})

afterEach(async () => {
  await rm(userDataDir, { recursive: true, force: true })
  await rm(rootDir, { recursive: true, force: true })
})

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile One',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: { sensitivity: '3' },
    binds: {},
    assignments: [],
    ...overrides,
  }
}

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'i1',
    name: 'Test',
    rootPath: rootDir,
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

function idleLaunchState(): LaunchState {
  return { phase: 'idle', installationId: null }
}

const noopLog: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
} as unknown as Logger

function deps(overrides: Partial<SyncProfileDeps> = {}): SyncProfileDeps {
  return {
    profile: profile(),
    allProfiles: [profile()],
    installations: { find: () => undefined },
    launchState: idleLaunchState(),
    playedModsFor: () => [],
    canonicalBaseDir: userDataDir,
    pendingWrites: {},
    writeFailures: {},
    log: noopLog,
    ...overrides,
  }
}

function read(...segments: string[]): Promise<string> {
  return readFile(join(...segments), 'latin1')
}

describe('syncProfile', () => {
  it('reports the canonical file as inSync and no installations for an unassigned profile', async () => {
    const p = profile({ assignments: [] })
    const result = await syncProfile(deps({ profile: p, allProfiles: [p] }))

    expect(result.state.own.status).toBe('inSync')
    expect(result.state.own.fileName).toBe('Profile-One.cfg')
    expect(await read(userDataDir, 'Profile-One.cfg')).toBe(renderProfileFile(p))
    expect(result.state.installations).toEqual([])
  })

  it('writes canonical + installation copy + loader, and reports both inSync', async () => {
    const p1 = profile({
      id: 'p1',
      name: 'One',
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const p2 = profile({
      id: 'p2',
      name: 'Two',
      assignments: [{ installationId: 'i1', isDefault: false }],
    })
    const inst = installation()

    const result = await syncProfile(
      deps({
        profile: p1,
        allProfiles: [p1, p2],
        installations: { find: (id) => (id === inst.id ? inst : undefined) },
      }),
    )

    expect(result.state.own.status).toBe('inSync')
    expect(result.state.installations).toHaveLength(1)
    expect(result.state.installations[0]).toMatchObject({
      installationId: 'i1',
      fileName: 'One.cfg',
      status: 'inSync',
    })

    // "write every assigned profile" - p2's own file is on disk too, not just
    // p1 (the one being synced) and the loader.
    expect(await read(rootDir, 'baseq2', 'One.cfg')).toBe(renderProfileFile(p1))
    expect(await read(rootDir, 'baseq2', 'Two.cfg')).toBe(renderProfileFile(p2))
    expect(await read(rootDir, 'baseq2', 'autoexec.cfg')).toContain('exec One.cfg')
  })

  it('marks a running installation pending without writing anything', async () => {
    const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
    const inst = installation()

    const result = await syncProfile(
      deps({
        profile: p,
        allProfiles: [p],
        installations: { find: (id) => (id === inst.id ? inst : undefined) },
        launchState: { phase: 'running', installationId: 'i1' },
      }),
    )

    expect(result.pendingWrites).toEqual({ i1: 'p1' })
    expect(result.state.installations).toEqual([
      {
        installationId: 'i1',
        path: join(rootDir, 'baseq2', 'One.cfg'),
        fileName: 'One.cfg',
        status: 'pending',
        messageKey: 'config.error.installationRunning',
      },
    ])
    await expect(read(rootDir, 'baseq2', 'One.cfg')).rejects.toThrow()
  })

  it('reports error + records a write failure when an installation target cannot be written, then recovers', async () => {
    const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
    const inst = installation()

    // Block the exact path the profile's own file would be written to with a
    // directory, so writing it throws EISDIR and reading it back for the live
    // status also throws EISDIR (not ENOENT) - see writer.test.ts's identical
    // "skips an entry that cannot be read as a file" precedent.
    await mkdir(join(rootDir, 'baseq2', 'One.cfg'), { recursive: true })

    const first = await syncProfile(
      deps({
        profile: p,
        allProfiles: [p],
        installations: { find: (id) => (id === inst.id ? inst : undefined) },
      }),
    )

    expect(first.state.installations[0]).toMatchObject({
      installationId: 'i1',
      status: 'error',
      messageKey: 'config.error.writeFailed',
    })
    expect(first.writeFailures['p1|i1']).toMatchObject({ messageKey: 'config.error.writeFailed' })

    // Fix the target and rerun, feeding the previous run's writeFailures back in.
    await rm(join(rootDir, 'baseq2', 'One.cfg'), { recursive: true, force: true })

    const second = await syncProfile(
      deps({
        profile: p,
        allProfiles: [p],
        installations: { find: (id) => (id === inst.id ? inst : undefined) },
        writeFailures: first.writeFailures,
      }),
    )

    expect(second.state.installations[0]).toMatchObject({ installationId: 'i1', status: 'inSync' })
    expect(second.writeFailures['p1|i1']).toBeUndefined()
  })

  it('reports the canonical file as missing when its directory cannot be created', async () => {
    const blocker = join(userDataDir, 'blocker')
    await writeFile(blocker, 'x', 'latin1')
    // A path nested under a plain file: on Windows this makes both the write
    // (ENOTDIR from the underlying mkdir) and the live read (ENOENT) fail,
    // with no prior file ever having existed - hence 'missing', not 'error'.
    const uncreatableBaseDir = join(blocker, 'sub', 'userData')

    const p = profile({ assignments: [] })
    const result = await syncProfile(
      deps({ profile: p, allProfiles: [p], canonicalBaseDir: uncreatableBaseDir }),
    )

    expect(result.state.own.status).toBe('missing')
    expect(result.writeFailures['p1|own']).toMatchObject({ messageKey: 'config.error.writeFailed' })
  })

  it('attributes a sibling profile’s write failure to the sibling, not to the profile being synced', async () => {
    // Review finding: the write loop used to catch around the WHOLE
    // assigned-profiles loop and attribute any throw to the profile being
    // synced (`p1` here), even when it was actually `p2`'s file that could
    // not be written. Block only p2's target - p1's own copy must still
    // write fine and be reported clean, and the failure must land on p2's
    // own key.
    const p1 = profile({
      id: 'p1',
      name: 'One',
      assignments: [{ installationId: 'i1', isDefault: true }],
    })
    const p2 = profile({
      id: 'p2',
      name: 'Two',
      assignments: [{ installationId: 'i1', isDefault: false }],
    })
    const inst = installation()
    await mkdir(join(rootDir, 'baseq2', 'Two.cfg'), { recursive: true })

    const result = await syncProfile(
      deps({
        profile: p1,
        allProfiles: [p1, p2],
        installations: { find: (id) => (id === inst.id ? inst : undefined) },
      }),
    )

    expect(result.state.installations[0]).toMatchObject({ installationId: 'i1', status: 'inSync' })
    expect(result.writeFailures['p1|i1']).toBeUndefined()
    expect(result.writeFailures['p2|i1']).toMatchObject({ messageKey: 'config.error.writeFailed' })
    expect(await read(rootDir, 'baseq2', 'One.cfg')).toBe(renderProfileFile(p1))
  })

  it('records a write failure instead of silently dropping it when reconciling an installation throws', async () => {
    // Review finding: `reconcileOwnedProfileFiles` used to run outside any
    // try/catch in this function, so a throw from it (a permission error
    // walking baseq2, here simulated by baseq2 itself being a plain file, so
    // `readdir` throws ENOTDIR rather than the swallowed ENOENT) escaped
    // uncaught instead of being recorded like any other sync failure. The
    // live-read-back below reports 'missing' rather than 'error' on this
    // platform (readFile through a blocked ancestor path surfaces as ENOENT
    // on Windows - same precedent as the "canonical file...cannot be created"
    // test above); the point of this test is that the failure is recorded at
    // all, not the exact resulting status.
    const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
    const inst = installation()
    await writeFile(join(rootDir, 'baseq2'), 'not a directory', 'latin1')

    const result = await syncProfile(
      deps({
        profile: p,
        allProfiles: [p],
        installations: { find: (id) => (id === inst.id ? inst : undefined) },
      }),
    )

    expect(result.writeFailures['p1|i1']).toMatchObject({ messageKey: 'config.error.writeFailed' })
    expect(result.state.installations[0].installationId).toBe('i1')
    expect(['error', 'missing']).toContain(result.state.installations[0].status)
  })

  it('renames the profile it displaces instead of overwriting its canonical file', async () => {
    // Confirmed AC-3 bug (review finding): p1 owns `Frag.cfg`, the
    // later-created p2 owns `Duel.cfg`. Renaming p1 to `Duel` makes p1 (the
    // earlier `createdAt`) claim `Duel.cfg` and pushes p2 to `Duel-2.cfg` -
    // syncing only p1 renamed its file straight over p2's canonical file,
    // silently destroying it.
    const p1 = profile({ id: 'p1', name: 'Frag', createdAt: '2026-01-01T00:00:00.000Z' })
    const p2 = profile({ id: 'p2', name: 'Duel', createdAt: '2026-02-01T00:00:00.000Z' })
    await syncProfile(deps({ profile: p1, allProfiles: [p1, p2] }))
    await syncProfile(deps({ profile: p2, allProfiles: [p1, p2] }))
    expect(await read(userDataDir, 'Frag.cfg')).toBe(renderProfileFile(p1))
    expect(await read(userDataDir, 'Duel.cfg')).toBe(renderProfileFile(p2))

    const renamed = { ...p1, name: 'Duel' }
    const result = await syncProfile(deps({ profile: renamed, allProfiles: [renamed, p2] }))

    expect(result.state.own.fileName).toBe('Duel.cfg')
    expect(result.state.own.status).toBe('inSync')
    expect(await read(userDataDir, 'Duel.cfg')).toBe(renderProfileFile(renamed))
    // p2's file survived the collision: renamed to its new resolved name, not
    // overwritten, not deleted, and not left behind as a backup either.
    expect(await read(userDataDir, 'Duel-2.cfg')).toBe(renderProfileFile(p2))
    expect(await pathExists(join(userDataDir, 'Frag.cfg'))).toBe(false)
    expect(await pathExists(join(userDataDir, `Duel.cfg${BACKUP_SUFFIX}`))).toBe(false)
    expect(result.writeFailures).toEqual({})
  })

  it('cascades to a profile promoted into the name the renamed profile vacated', async () => {
    // The other direction of the same cascade: p3 has to wait for p1 to move
    // out of `Frag.cfg` before it can claim it, so ordering by "who can move
    // now" is what keeps this from failing on a still-occupied destination.
    const p1 = profile({ id: 'p1', name: 'Frag', createdAt: '2026-01-01T00:00:00.000Z' })
    const p3 = profile({ id: 'p3', name: 'Frag', createdAt: '2026-03-01T00:00:00.000Z' })
    await syncProfile(deps({ profile: p1, allProfiles: [p1, p3] }))
    await syncProfile(deps({ profile: p3, allProfiles: [p1, p3] }))
    expect(await read(userDataDir, 'Frag-2.cfg')).toBe(renderProfileFile(p3))

    const renamed = { ...p1, name: 'Solo' }
    const result = await syncProfile(deps({ profile: renamed, allProfiles: [renamed, p3] }))

    expect(await read(userDataDir, 'Solo.cfg')).toBe(renderProfileFile(renamed))
    expect(await read(userDataDir, 'Frag.cfg')).toBe(renderProfileFile(p3))
    expect(await pathExists(join(userDataDir, 'Frag-2.cfg'))).toBe(false)
    expect(result.writeFailures).toEqual({})
  })

  it('silently skips an assignment pointing at an installation that no longer exists', async () => {
    const p = profile({ assignments: [{ installationId: 'ghost', isDefault: true }] })

    const result = await syncProfile(
      deps({ profile: p, allProfiles: [p], installations: { find: () => undefined } }),
    )

    expect(result.state.installations).toEqual([])
    expect(result.state.own.status).toBe('inSync')
  })
})
