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
import { hashCanonicalFileContent } from './file-source'
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

  it('writes a running installation exactly like a stopped one', async () => {
    const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
    const inst = installation()

    const running = await syncProfile(
      deps({
        profile: p,
        allProfiles: [p],
        installations: { find: (id) => (id === inst.id ? inst : undefined) },
        launchState: { phase: 'running', installationId: 'i1' },
      }),
    )

    // Story 079 D4: the engine only reads a config at `exec` time and holds no handle on it
    // afterwards, so a running installation is written immediately - no `pending`, no deferral.
    expect(running.state.installations).toEqual([
      {
        installationId: 'i1',
        path: join(rootDir, 'baseq2', 'One.cfg'),
        fileName: 'One.cfg',
        status: 'inSync',
      },
    ])
    expect(await read(rootDir, 'baseq2', 'One.cfg')).toBe(renderProfileFile(p))
    expect(await read(rootDir, 'baseq2', 'autoexec.cfg')).toContain('exec One.cfg')
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

  /**
   * Story 043 D4: `canonicalWriteAllowed` - "is this profile's canonical file ours to write on this
   * pass?". Answering `false` has to hold on BOTH sides at once: the canonical file is left exactly
   * as it is, and the installation copies are written from that file rather than from the profile in
   * memory. Asserting only the first half would pass while unsaved edits leaked into the
   * installation, which is the copy the engine actually loads.
   */
  describe('canonicalWriteAllowed (story 043 D4)', () => {
    it('leaves the canonical file alone and writes the installation copy from its bytes', async () => {
      const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
      const inst = installation()
      // Saved once, the normal way, so there is a canonical file with known content.
      await syncProfile(
        deps({
          profile: p,
          allProfiles: [p],
          installations: { find: (id) => (id === inst.id ? inst : undefined) },
        }),
      )
      const onDisk = await read(userDataDir, 'One.cfg')
      const edited = { ...p, cvars: { sensitivity: '99' } }
      expect(renderProfileFile(edited)).not.toBe(onDisk)

      const result = await syncProfile(
        deps({
          profile: edited,
          allProfiles: [edited],
          installations: { find: (id) => (id === inst.id ? inst : undefined) },
          canonicalWriteAllowed: () => false,
        }),
      )

      expect(await read(userDataDir, 'One.cfg')).toBe(onDisk)
      expect(await read(rootDir, 'baseq2', 'One.cfg')).toBe(onDisk)
      expect(await read(rootDir, 'baseq2', 'One.cfg')).not.toBe(renderProfileFile(edited))
      // The canonical row reads `outOfSync` - the file does not say what the profile says, which is
      // the story's "no sixth sync state" decision - while the installation row is `inSync`, since
      // it holds exactly what the canonical file authorises.
      expect(result.state.own.status).toBe('outOfSync')
      expect(result.state.installations[0]!.status).toBe('inSync')
      // Nothing failed, so nothing is recorded as a failure, and no hash baseline is claimed for a
      // file whose bytes were never confirmed to match the profile.
      expect(result.writeFailures).toEqual({})
      expect(result.canonicalHashes).toEqual({})
    })

    it('writes nothing at all - not even the installation copy - when there is no canonical file to write from', async () => {
      const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
      const inst = installation()

      const result = await syncProfile(
        deps({
          profile: p,
          allProfiles: [p],
          installations: { find: (id) => (id === inst.id ? inst : undefined) },
          canonicalWriteAllowed: () => false,
        }),
      )

      // A canonical file that is missing while the profile carries unsaved edits is the story's
      // "file missing" error state, awaiting the user's decision - sync neither resurrects it nor
      // invents an installation copy out of the unsaved profile.
      expect(await pathExists(join(userDataDir, 'One.cfg'))).toBe(false)
      expect(await pathExists(join(rootDir, 'baseq2', 'One.cfg'))).toBe(false)
      // Documented consequence: the loader is written per assigned profile, so an installation whose
      // ONLY assigned profile is skipped gets no loader either on this pass.
      expect(await pathExists(join(rootDir, 'baseq2', 'autoexec.cfg'))).toBe(false)
      expect(result.state.own.status).toBe('missing')
      expect(result.state.installations[0]!.status).toBe('missing')
      // Not a write failure: nothing was attempted and nothing went wrong.
      expect(result.writeFailures).toEqual({})
    })

    it('is asked per profile: a clean profile still writes while a dirty sibling does not', async () => {
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
      const find = (id: string): Installation | undefined => (id === inst.id ? inst : undefined)
      await syncProfile(deps({ profile: p2, allProfiles: [p1, p2], installations: { find } }))
      const siblingOnDisk = await read(userDataDir, 'Two.cfg')
      const dirtySibling = { ...p2, cvars: { sensitivity: '99' }, dirty: true }

      const result = await syncProfile(
        deps({
          profile: p1,
          allProfiles: [p1, dirtySibling],
          installations: { find },
          canonicalWriteAllowed: (candidate) => candidate.dirty !== true,
        }),
      )

      // The profile being synced is clean, so its own file is written as always...
      expect(await read(userDataDir, 'One.cfg')).toBe(renderProfileFile(p1))
      expect(await read(rootDir, 'baseq2', 'One.cfg')).toBe(renderProfileFile(p1))
      expect(result.canonicalHashes['p1']).toBeTypeOf('string')
      // ...while the sibling, which this pass also writes into the installation, contributes its
      // FILE, not its unsaved edits.
      expect(await read(userDataDir, 'Two.cfg')).toBe(siblingOnDisk)
      expect(await read(rootDir, 'baseq2', 'Two.cfg')).toBe(siblingOnDisk)
      expect(await read(rootDir, 'baseq2', 'Two.cfg')).not.toBe(renderProfileFile(dirtySibling))
    })

    it('follows the ownership sentinel, so a renamed-but-unsaved profile is still read from its old file', async () => {
      const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
      const inst = installation()
      const find = (id: string): Installation | undefined => (id === inst.id ? inst : undefined)
      await syncProfile(deps({ profile: p, allProfiles: [p], installations: { find } }))
      const onDisk = await read(userDataDir, 'One.cfg')

      // Renamed in the UI but not saved: the file is still `One.cfg`, while the profile now resolves
      // to `Two.cfg`. Reading the resolved name would find nothing and leave the installation with
      // no content at all.
      const renamed = { ...p, name: 'Two', dirty: true }
      const result = await syncProfile(
        deps({
          profile: renamed,
          allProfiles: [renamed],
          installations: { find },
          canonicalWriteAllowed: (candidate) => candidate.dirty !== true,
        }),
      )

      expect(await read(userDataDir, 'One.cfg')).toBe(onDisk)
      expect(await pathExists(join(userDataDir, 'Two.cfg'))).toBe(false)
      // The installation copy lands under the name the profile resolves to now (the file-name
      // reconcile is not part of the content decision) and carries the canonical file's bytes.
      expect(await read(rootDir, 'baseq2', 'Two.cfg')).toBe(onDisk)
      expect(result.state.installations[0]!.status).toBe('inSync')
    })

    it('confirms a hash for every profile whose canonical file it read back byte-for-byte', async () => {
      const p = profile({ name: 'One', assignments: [] })

      const result = await syncProfile(deps({ profile: p, allProfiles: [p] }))

      expect(result.state.own.status).toBe('inSync')
      expect(result.canonicalHashes).toEqual({
        p1: hashCanonicalFileContent(renderProfileFile(p)),
      })
    })
  })

  describe('installation copies mirror the canonical file’s bytes (story 079 D2)', () => {
    /**
     * `index.ts`'s own `canonicalWriteAllowed` rule (`syncAndPersist`), mirrored here so these
     * tests exercise the predicate production actually passes in. `overwriteProfileId` is the
     * caller-side licence that `save` (and `tidyUpApply`, after its own read-before-write check)
     * passes for the ONE profile it just mutated - without it a content write is only allowed over
     * an absent file, a profile with no baseline, or bytes that already are our own render.
     *
     * Note what is deliberately NOT here: `onDisk.hash === candidate.fileHash`. Bytes the launcher
     * itself wrote are not necessarily `renderProfileFile`'s output - a raw save (story 057) keeps
     * hand-typed formatting as exactly that confirmed baseline - so allowing the write on the hash
     * alone would reformat them on the next non-save trigger.
     */
    const indexRule = (
      overwriteProfileId?: string,
    ): NonNullable<SyncProfileDeps['canonicalWriteAllowed']> => {
      return (candidate, onDisk) => {
        if (candidate.dirty === true) return false
        if (candidate.id === overwriteProfileId) return true
        if (onDisk.content === null) return true
        if (typeof candidate.fileHash !== 'string') return true
        return onDisk.content === renderProfileFile(candidate)
      }
    }

    /**
     * `index.ts`'s `canonicalMoveAllowed` - the LOCATION half the hash DOES satisfy (story 079
     * review, finding 1): a move preserves every byte, so a file whose bytes the launcher has read
     * is still ours to put under the name the profile resolves to now.
     */
    const indexMoveRule: NonNullable<SyncProfileDeps['canonicalMoveAllowed']> = (
      candidate,
      onDisk,
    ) => {
      if (candidate.dirty === true) return false
      if (onDisk.content === null) return false
      if (typeof candidate.fileHash !== 'string') return true
      return onDisk.hash === candidate.fileHash || onDisk.content === renderProfileFile(candidate)
    }

    it('writes a CLEAN profile’s copy from its hand-formatted canonical file, not from the render', async () => {
      const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
      const inst = installation()
      const find = (id: string): Installation | undefined => (id === inst.id ? inst : undefined)
      await syncProfile(deps({ profile: p, allProfiles: [p], installations: { find } }))
      // A raw save (story 057) or an adopted external edit: the file holds bytes the launcher has
      // read - its hash is the profile's baseline - but that are not a render fixed point.
      const handFormatted = `${await read(userDataDir, 'One.cfg')}\tset q2l_hand "1"   \n`
      await writeFile(join(userDataDir, 'One.cfg'), handFormatted, 'latin1')
      const clean = { ...p, fileHash: hashCanonicalFileContent(handFormatted) }
      expect(renderProfileFile(clean)).not.toBe(handFormatted)

      // The cascade after such an adopt leaves the canonical file alone (it IS the truth) and only
      // publishes it.
      const result = await syncProfile(
        deps({
          profile: clean,
          allProfiles: [clean],
          installations: { find },
          canonicalWriteAllowed: () => false,
        }),
      )

      expect(await read(userDataDir, 'One.cfg')).toBe(handFormatted)
      expect(await read(rootDir, 'baseq2', 'One.cfg')).toBe(handFormatted)
      expect(result.state.installations[0]!.status).toBe('inSync')
      expect(result.writeFailures).toEqual({})
    })

    it('publishes the render when there is no canonical file yet - it is what the run writes first', async () => {
      // A stale baseline with no file behind it (the file was deleted outside the launcher, say):
      // absent means "nothing there to lose", so the run writes the canonical file and the copy
      // from the same render.
      const p = profile({
        name: 'One',
        assignments: [{ installationId: 'i1', isDefault: true }],
        fileHash: 'stale-baseline',
      })
      const inst = installation()
      const find = (id: string): Installation | undefined => (id === inst.id ? inst : undefined)

      const result = await syncProfile(
        deps({
          profile: p,
          allProfiles: [p],
          installations: { find },
          canonicalWriteAllowed: indexRule(),
          canonicalMoveAllowed: indexMoveRule,
        }),
      )

      expect(await read(userDataDir, 'One.cfg')).toBe(renderProfileFile(p))
      expect(await read(rootDir, 'baseq2', 'One.cfg')).toBe(renderProfileFile(p))
      expect(result.state.own.status).toBe('inSync')
      expect(result.state.installations[0]!.status).toBe('inSync')
    })

    it('publishes nothing and reads outOfSync when the canonical file moved underneath the launcher', async () => {
      const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
      const inst = installation()
      const find = (id: string): Installation | undefined => (id === inst.id ? inst : undefined)
      await syncProfile(deps({ profile: p, allProfiles: [p], installations: { find } }))
      const written = await read(userDataDir, 'One.cfg')
      const clean = { ...p, fileHash: hashCanonicalFileContent(written) }
      // An external edit nobody has read yet: hash ≠ `fileHash`, and not what we would render.
      const external = `${written}set external_edit "1"\n`
      await writeFile(join(userDataDir, 'One.cfg'), external, 'latin1')

      const result = await syncProfile(
        deps({
          profile: clean,
          allProfiles: [clean],
          installations: { find },
          canonicalWriteAllowed: indexRule(),
          canonicalMoveAllowed: indexMoveRule,
        }),
      )

      // Neither overwritten (story 043 D10) nor published (079 D2): the copy keeps the bytes of the
      // last run, which happen to equal the render - and it still reads `outOfSync`, because there
      // is nothing it is in sync WITH until the user reloads or saves.
      expect(await read(userDataDir, 'One.cfg')).toBe(external)
      expect(await read(rootDir, 'baseq2', 'One.cfg')).toBe(written)
      expect(await read(rootDir, 'baseq2', 'One.cfg')).toBe(renderProfileFile(clean))
      expect(result.state.own.status).toBe('outOfSync')
      expect(result.state.installations[0]!.status).toBe('outOfSync')
      // Nothing failed and nothing was confirmed.
      expect(result.writeFailures).toEqual({})
      expect(result.canonicalHashes).toEqual({})
    })

    it('a save still reaches the installation in one pass: the copy carries the bytes just written', async () => {
      const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
      const inst = installation()
      const find = (id: string): Installation | undefined => (id === inst.id ? inst : undefined)
      await syncProfile(deps({ profile: p, allProfiles: [p], installations: { find } }))
      const before = await read(userDataDir, 'One.cfg')
      // The save's run: the profile's baseline is the OLD file's hash (the caller reseeds it from
      // `canonicalHashes` afterwards), the canonical write goes first, and the copy must say what
      // the file says NOW - not the bytes the write decision was made from.
      const saved = { ...p, cvars: { sensitivity: '42' }, fileHash: hashCanonicalFileContent(before) }

      const result = await syncProfile(
        deps({
          profile: saved,
          allProfiles: [saved],
          installations: { find },
          // What `save` actually passes (`index.ts`: `overwriteProfileId: profile.id`, and
          // unconditionally so): the general rule alone would REFUSE this write, since the file's
          // hash still matches the stale baseline and its bytes are not the new render. `save` is
          // the one caller licensed to publish genuinely new content over such a file, and that
          // licence - not the baseline hash - is what makes a save reach the installation.
          canonicalWriteAllowed: indexRule(saved.id),
          canonicalMoveAllowed: indexMoveRule,
        }),
      )

      expect(await read(userDataDir, 'One.cfg')).toBe(renderProfileFile(saved))
      expect(await read(rootDir, 'baseq2', 'One.cfg')).toBe(renderProfileFile(saved))
      expect(result.state.own.status).toBe('inSync')
      expect(result.state.installations[0]!.status).toBe('inSync')
      expect(result.canonicalHashes['p1']).toBe(hashCanonicalFileContent(renderProfileFile(saved)))
    })

    it('without that licence the same run publishes nothing new: only a save may re-render a hand-formatted file', async () => {
      // The mirror image of the test above, and the reason `indexRule` no longer allows the write
      // on `onDisk.hash === fileHash` alone: every non-save trigger (`assign`, `setDefault`, the
      // startup retry sweep, "Sync now") runs the SAME predicate without `overwriteProfileId`, and
      // must leave a raw save's hand-typed formatting exactly as the user typed it (story 057).
      const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
      const inst = installation()
      const find = (id: string): Installation | undefined => (id === inst.id ? inst : undefined)
      await syncProfile(deps({ profile: p, allProfiles: [p], installations: { find } }))
      const handFormatted = `${await read(userDataDir, 'One.cfg')}\tset q2l_hand "1"   \n`
      await writeFile(join(userDataDir, 'One.cfg'), handFormatted, 'latin1')
      const clean = { ...p, fileHash: hashCanonicalFileContent(handFormatted) }
      expect(renderProfileFile(clean)).not.toBe(handFormatted)

      await syncProfile(
        deps({
          profile: clean,
          allProfiles: [clean],
          installations: { find },
          canonicalWriteAllowed: indexRule(),
          canonicalMoveAllowed: indexMoveRule,
        }),
      )

      expect(await read(userDataDir, 'One.cfg')).toBe(handFormatted)
      expect(await read(rootDir, 'baseq2', 'One.cfg')).toBe(handFormatted)
    })

    it('still MOVES such a file out of a name another profile’s rename claimed, so that save can land', async () => {
      // Story 079 review (finding 1). Refusing to re-render a hand-formatted file must not also
      // refuse to move it: `writeCanonicalProfileFile` throws rather than destroy a live profile's
      // canonical file, so a displaced profile that never vacates its old name makes the renamed
      // profile's save fail on this and every future retry.
      const p1 = profile({ id: 'p1', name: 'One' })
      const p2 = profile({ id: 'p2', name: 'Two' })
      await syncProfile(deps({ profile: p1, allProfiles: [p1, p2] }))
      await syncProfile(deps({ profile: p2, allProfiles: [p1, p2] }))
      // p2 was raw-saved with hand formatting: clean, baseline = those exact bytes, not a render
      // fixed point.
      const handFormatted = `${await read(userDataDir, 'Two.cfg')}\tset q2l_hand "1"   \n`
      await writeFile(join(userDataDir, 'Two.cfg'), handFormatted, 'latin1')
      const cleanP2 = { ...p2, fileHash: hashCanonicalFileContent(handFormatted) }
      // p1 is renamed to "Two" and saved. Both profiles share `createdAt`, so `p1` wins the tie on
      // id and claims `Two.cfg`; p2 is displaced to `Two-2.cfg`.
      const renamed = { ...p1, name: 'Two', fileHash: hashCanonicalFileContent(await read(userDataDir, 'One.cfg')) }

      const result = await syncProfile(
        deps({
          profile: renamed,
          allProfiles: [renamed, cleanP2],
          canonicalWriteAllowed: indexRule(renamed.id),
          canonicalMoveAllowed: indexMoveRule,
        }),
      )

      // p2's file moved, byte-for-byte - it was never re-rendered on the way...
      expect(await read(userDataDir, 'Two-2.cfg')).toBe(handFormatted)
      // ...which is what let p1's own save actually land under the name it now claims.
      expect(await read(userDataDir, 'Two.cfg')).toBe(renderProfileFile(renamed))
      expect(await pathExists(join(userDataDir, 'One.cfg'))).toBe(false)
      expect(result.state.own.status).toBe('inSync')
      expect(result.writeFailures).toEqual({})
    })
  })

  /**
   * Story 007's loader chain, re-covered here after story 079 D4 deleted the legacy
   * `writeProfileToAssignedInstallations` (and, with it, these three tests) - `switchBindFor` is
   * still live, and `sync.ts`'s per-installation write is the path that consumes it now.
   */
  describe('switchBindFor and the loader chain (story 007)', () => {
    it('a 2-profile installation with a switchBindFor key produces a loader containing the chain', async () => {
      const duel = profile({
        id: 'p-duel',
        name: 'Duel',
        assignments: [{ installationId: 'i1', isDefault: true }],
      })
      const ctf = profile({
        id: 'p-ctf',
        name: 'CTF',
        assignments: [{ installationId: 'i1', isDefault: false }],
      })
      const inst = installation()

      await syncProfile(
        deps({
          profile: duel,
          allProfiles: [duel, ctf],
          installations: { find: (id) => (id === inst.id ? inst : undefined) },
          switchBindFor: () => 'F9',
        }),
      )

      const loader = await read(rootDir, 'baseq2', 'autoexec.cfg')
      expect(loader).toContain('q2l_switch')
      expect(loader).toContain('exec Duel.cfg')
      expect(loader).toContain('exec CTF.cfg')
      expect(loader).toContain('bind F9 q2l_switch')
    })

    it('with switchBindFor returning undefined, the loader is byte-identical to a run with no switchBindFor at all', async () => {
      const p = profile({ name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] })
      const inst = installation()
      const find = (id: string): Installation | undefined => (id === inst.id ? inst : undefined)

      await syncProfile(deps({ profile: p, allProfiles: [p], installations: { find } }))
      const withoutSwitchBindFor = await read(rootDir, 'baseq2', 'autoexec.cfg')

      await syncProfile(
        deps({
          profile: p,
          allProfiles: [p],
          installations: { find },
          switchBindFor: () => undefined,
        }),
      )
      const withUndefinedSwitchBindFor = await read(rootDir, 'baseq2', 'autoexec.cfg')

      expect(withUndefinedSwitchBindFor).toBe(withoutSwitchBindFor)
      expect(withoutSwitchBindFor).not.toContain('q2l_switch')
    })

    it("never changes any assignment's isDefault, switch bind or not", async () => {
      const duel = profile({
        id: 'p-duel',
        name: 'Duel',
        assignments: [{ installationId: 'i1', isDefault: true }],
      })
      const ctf = profile({
        id: 'p-ctf',
        name: 'CTF',
        assignments: [{ installationId: 'i1', isDefault: false }],
      })
      const inst = installation()
      const before = JSON.parse(JSON.stringify([duel, ctf].map((p) => p.assignments)))

      await syncProfile(
        deps({
          profile: duel,
          allProfiles: [duel, ctf],
          installations: { find: (id) => (id === inst.id ? inst : undefined) },
          switchBindFor: () => 'F9',
        }),
      )

      expect([duel, ctf].map((p) => p.assignments)).toEqual(before)
    })
  })
})
