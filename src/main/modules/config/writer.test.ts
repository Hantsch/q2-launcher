import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Installation } from '@shared/types'
import { pathExists } from '../../lib/fs-utils'
import { OWNERSHIP_MARKER, sentinelLine } from './render'
import { BACKUP_SUFFIX, reconcileOwnedProfileFiles, writeInstallationFiles } from './writer'
import type { WriteInstallationFilesOptions } from './writer'

const PROFILE_FILE = 'q2l-profile-p1.cfg'
const PROFILE_CONTENT = `${OWNERSHIP_MARKER} p1 - generated, do not edit\nset sensitivity "3"\n`
const LOADER_CONTENT = `${OWNERSHIP_MARKER} p1 - generated, do not edit\nexec ${PROFILE_FILE}\n`
const HAND_WRITTEN = 'bind mouse2 "+attack"\nset name "player"\n'

/**
 * Every path below is built from `dir`, a throwaway temp directory created per
 * test - this suite writes real files, so it must never be able to touch a real
 * installation.
 */
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-writer-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'test',
    name: 'Test',
    rootPath: dir,
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

function options(
  overrides: Partial<WriteInstallationFilesOptions> = {},
): WriteInstallationFilesOptions {
  return {
    installation: installation(),
    profileFileName: PROFILE_FILE,
    profileFileContent: PROFILE_CONTENT,
    loaderFileContent: LOADER_CONTENT,
    playedMods: [],
    ...overrides,
  }
}

function read(...segments: string[]): Promise<string> {
  return readFile(join(dir, ...segments), 'latin1')
}

async function seed(relativePath: string, content: string): Promise<void> {
  const target = join(dir, relativePath)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content, 'latin1')
}

function outcomeOf(
  result: Awaited<ReturnType<typeof writeInstallationFiles>>,
  ...segments: string[]
): string | undefined {
  const path = join(dir, ...segments)
  return result.files.find((file) => file.path === path)?.outcome
}

describe('writeInstallationFiles', () => {
  it('writes profile and loader when nothing exists yet', async () => {
    const result = await writeInstallationFiles(options())

    expect(await read('baseq2', PROFILE_FILE)).toBe(PROFILE_CONTENT)
    expect(await read('baseq2', 'autoexec.cfg')).toBe(LOADER_CONTENT)
    expect(result.changed).toBe(true)
    expect(outcomeOf(result, 'baseq2', PROFILE_FILE)).toBe('written')
    expect(outcomeOf(result, 'baseq2', 'autoexec.cfg')).toBe('written')
    expect(result.rejectedMods).toEqual([])
  })

  it("backs up the user's own autoexec.cfg exactly once, ever", async () => {
    await seed('baseq2/autoexec.cfg', HAND_WRITTEN)

    await writeInstallationFiles(options())

    expect(await read('baseq2', `autoexec.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
    expect(await read('baseq2', 'autoexec.cfg')).toBe(LOADER_CONTENT)

    // Second save with different content: the file on disk is now our own
    // output, and overwriting the backup with it would destroy the only copy of
    // what the user actually wrote.
    const secondLoader = `${OWNERSHIP_MARKER} p2 - generated, do not edit\nexec q2l-profile-p2.cfg\n`
    await writeInstallationFiles(options({ loaderFileContent: secondLoader }))

    expect(await read('baseq2', `autoexec.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
    expect(await read('baseq2', 'autoexec.cfg')).toBe(secondLoader)
  })

  it('skips files whose content is already identical', async () => {
    await writeInstallationFiles(options())
    const before = await stat(join(dir, 'baseq2', 'autoexec.cfg'))

    const result = await writeInstallationFiles(options())

    expect(result.changed).toBe(false)
    expect(result.files.every((file) => file.outcome === 'unchanged')).toBe(true)
    // No write happened, so the file was not even touched.
    expect((await stat(join(dir, 'baseq2', 'autoexec.cfg'))).mtimeMs).toBe(before.mtimeMs)
    // A skipped file is not a backed-up file either.
    expect(await pathExists(join(dir, 'baseq2', `autoexec.cfg${BACKUP_SUFFIX}`))).toBe(false)
  })

  it('reports a real change when only one of several targets differs', async () => {
    await writeInstallationFiles(
      options({ playedMods: ['ctf'], installation: installation({ gameDirs: ['baseq2', 'ctf'] }) }),
    )

    const secondLoader = `${OWNERSHIP_MARKER} p2 - generated, do not edit\nexec q2l-profile-p2.cfg\n`
    const result = await writeInstallationFiles(
      options({
        installation: installation({ gameDirs: ['baseq2', 'ctf'] }),
        playedMods: ['ctf'],
        loaderFileContent: secondLoader,
      }),
    )

    expect(result.changed).toBe(true)
    expect(outcomeOf(result, 'baseq2', PROFILE_FILE)).toBe('unchanged')
    expect(outcomeOf(result, 'baseq2', 'autoexec.cfg')).toBe('written')
    expect(outcomeOf(result, 'ctf', 'autoexec.cfg')).toBe('written')
  })

  it('copies the loader into every played mod folder', async () => {
    const result = await writeInstallationFiles(
      options({
        installation: installation({ gameDirs: ['baseq2', 'ctf'] }),
        playedMods: ['ctf'],
      }),
    )

    expect(await read('ctf', 'autoexec.cfg')).toBe(LOADER_CONTENT)
    expect(outcomeOf(result, 'ctf', 'autoexec.cfg')).toBe('written')
    expect(result.rejectedMods).toEqual([])
  })

  it("backs up a mod folder's own hand-written autoexec.cfg independently", async () => {
    await seed('ctf/autoexec.cfg', HAND_WRITTEN)

    await writeInstallationFiles(
      options({
        installation: installation({ gameDirs: ['baseq2', 'ctf'] }),
        playedMods: ['ctf'],
      }),
    )

    expect(await read('ctf', `autoexec.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
    expect(await read('ctf', 'autoexec.cfg')).toBe(LOADER_CONTENT)
    // baseq2 had no user file, so it gets no backup of its own.
    expect(await pathExists(join(dir, 'baseq2', `autoexec.cfg${BACKUP_SUFFIX}`))).toBe(false)
  })

  it('rejects a mod name that is not in gameDirs, without touching the disk', async () => {
    const result = await writeInstallationFiles(options({ playedMods: ['not-a-real-mod'] }))

    expect(result.rejectedMods).toEqual(['not-a-real-mod'])
    expect(result.files.map((file) => file.path)).toEqual([
      join(dir, 'baseq2', PROFILE_FILE),
      join(dir, 'baseq2', 'autoexec.cfg'),
    ])
    expect(await pathExists(join(dir, 'not-a-real-mod'))).toBe(false)
  })

  it('rejects a traversing mod name even when gameDirs itself carries it', async () => {
    // gameDirs is persisted in state.json and parsed forgivingly, so a
    // hand-edited state file must not be enough to escape the installation.
    const result = await writeInstallationFiles(
      options({
        installation: installation({ gameDirs: ['baseq2', '..'] }),
        playedMods: ['..'],
      }),
    )

    expect(result.rejectedMods).toEqual(['..'])
    expect(await pathExists(join(dir, '..', 'autoexec.cfg'))).toBe(false)
  })

  it('never backs up a file we generated ourselves', async () => {
    // Our own output from an earlier save - for a different profile id, which
    // still counts as ours.
    const ours = `${OWNERSHIP_MARKER} p0 - generated, do not edit\nexec q2l-profile-p0.cfg\n`
    await seed('baseq2/autoexec.cfg', ours)

    const result = await writeInstallationFiles(options())

    expect(await read('baseq2', 'autoexec.cfg')).toBe(LOADER_CONTENT)
    expect(await pathExists(join(dir, 'baseq2', `autoexec.cfg${BACKUP_SUFFIX}`))).toBe(false)
    expect(outcomeOf(result, 'baseq2', 'autoexec.cfg')).toBe('written')
  })

  it('writes each target only once when a mod resolves to an existing target', async () => {
    const result = await writeInstallationFiles(
      options({
        installation: installation({ gameDirs: ['baseq2', 'ctf'] }),
        playedMods: ['ctf', 'ctf', 'baseq2'],
      }),
    )

    expect(result.files.map((file) => file.path)).toEqual([
      join(dir, 'baseq2', PROFILE_FILE),
      join(dir, 'baseq2', 'autoexec.cfg'),
      join(dir, 'ctf', 'autoexec.cfg'),
    ])
  })

  it('refuses a profile file name that is not a bare file name', async () => {
    await expect(
      writeInstallationFiles(options({ profileFileName: '../q2l-profile-p1.cfg' })),
    ).rejects.toThrow()
    expect(await pathExists(join(dir, 'baseq2'))).toBe(false)
  })

  it('leaves no temp file behind', async () => {
    await writeInstallationFiles(options())

    expect(await pathExists(join(dir, 'baseq2', 'autoexec.cfg.tmp'))).toBe(false)
    expect(await pathExists(join(dir, 'baseq2', `${PROFILE_FILE}.tmp`))).toBe(false)
  })
})

describe('reconcileOwnedProfileFiles', () => {
  /** Content of a launcher-generated profile file for `profileId`. */
  function owned(profileId: string): string {
    return `${sentinelLine(profileId)}\nset sensitivity "3"\n`
  }

  /** Direct children of `dir/baseq2`, as names. */
  async function baseq2Names(): Promise<string[]> {
    return (await readdir(join(dir, 'baseq2'))).sort()
  }

  it('renames an id-based file to its expected name, and the write pass then skips it', async () => {
    await seed('baseq2/q2l-profile-p1.cfg', owned('p1'))

    await reconcileOwnedProfileFiles(installation(), new Map([['p1', 'Name.cfg']]))

    expect(await baseq2Names()).toEqual(['Name.cfg'])
    expect(await read('baseq2', 'Name.cfg')).toBe(owned('p1'))

    // The rename landed content the write pass recognises as already correct -
    // which is what makes the migration a no-op save rather than a rewrite.
    const result = await writeInstallationFiles(
      options({ profileFileName: 'Name.cfg', profileFileContent: owned('p1') }),
    )

    expect(outcomeOf(result, 'baseq2', 'Name.cfg')).toBe('unchanged')
    expect(await pathExists(join(dir, 'baseq2', `Name.cfg${BACKUP_SUFFIX}`))).toBe(false)
  })

  it("backs up a hand-written file sitting at the rename destination before replacing it", async () => {
    // Review finding: a migrating file's destination name is not guaranteed
    // to be empty - the user may have their own hand-written cfg that happens
    // to share the profile's new name. `rename()` replaces a destination
    // unconditionally, so this must be backed up first, same as a plain write
    // would.
    await seed('baseq2/q2l-profile-p1.cfg', owned('p1'))
    await seed('baseq2/Name.cfg', HAND_WRITTEN)

    await reconcileOwnedProfileFiles(installation(), new Map([['p1', 'Name.cfg']]))

    expect(await read('baseq2', 'Name.cfg')).toBe(owned('p1'))
    expect(await read('baseq2', `Name.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
  })

  it('does not back up a rename destination that is already one of ours', async () => {
    await seed('baseq2/q2l-profile-p1.cfg', owned('p1'))
    await seed('baseq2/Name.cfg', owned('p1'))

    await reconcileOwnedProfileFiles(installation(), new Map([['p1', 'Name.cfg']]))

    expect(await read('baseq2', 'Name.cfg')).toBe(owned('p1'))
    expect(await pathExists(join(dir, 'baseq2', `Name.cfg${BACKUP_SUFFIX}`))).toBe(false)
  })

  it('leaves a file that already carries its expected name alone', async () => {
    await seed('baseq2/Name.cfg', owned('p1'))

    await reconcileOwnedProfileFiles(installation(), new Map([['p1', 'Name.cfg']]))

    expect(await baseq2Names()).toEqual(['Name.cfg'])
    expect(await read('baseq2', 'Name.cfg')).toBe(owned('p1'))
  })

  it('deletes an owned file whose profile is no longer expected here', async () => {
    await seed('baseq2/q2l-profile-gone.cfg', owned('gone'))
    await seed('baseq2/Keep.cfg', owned('keep'))

    await reconcileOwnedProfileFiles(installation(), new Map([['keep', 'Keep.cfg']]))

    expect(await baseq2Names()).toEqual(['Keep.cfg'])
  })

  it("never touches the user's own hand-written cfg", async () => {
    await seed('baseq2/config.cfg', HAND_WRITTEN)

    // Neither an empty map (everything is an orphan) nor a map that happens to
    // want this exact name may reach a file that is not ours.
    await reconcileOwnedProfileFiles(installation(), new Map())
    await reconcileOwnedProfileFiles(installation(), new Map([['p1', 'config.cfg']]))

    expect(await read('baseq2', 'config.cfg')).toBe(HAND_WRITTEN)
  })

  it('never touches a file that starts with the marker but has no parseable id', async () => {
    // Marker prefix, but the next character is not whitespace: a different word,
    // not our sentinel. Guessing an id here is exactly what must not happen.
    const malformed = `${OWNERSHIP_MARKER}s are documented in the manual\nset x "1"\n`
    await seed('baseq2/notes.cfg', malformed)

    await reconcileOwnedProfileFiles(installation(), new Map())

    expect(await read('baseq2', 'notes.cfg')).toBe(malformed)
  })

  it('leaves an existing .q2l-backup untouched', async () => {
    await seed(`baseq2/config.cfg${BACKUP_SUFFIX}`, HAND_WRITTEN)
    // A backup of one of our own files must survive too, orphan id or not.
    await seed(`baseq2/q2l-profile-p1.cfg${BACKUP_SUFFIX}`, owned('p1'))

    await reconcileOwnedProfileFiles(installation(), new Map())

    expect(await read('baseq2', `config.cfg${BACKUP_SUFFIX}`)).toBe(HAND_WRITTEN)
    expect(await read('baseq2', `q2l-profile-p1.cfg${BACKUP_SUFFIX}`)).toBe(owned('p1'))
  })

  it('never renames or deletes the loader autoexec.cfg', async () => {
    // The loader carries a sentinel for whichever profile is the installation's
    // default - an id that says nothing about this file's name.
    await seed('baseq2/autoexec.cfg', LOADER_CONTENT)

    // Neither as an "orphan" (p1 absent)...
    await reconcileOwnedProfileFiles(installation(), new Map())
    expect(await read('baseq2', 'autoexec.cfg')).toBe(LOADER_CONTENT)

    // ...nor as a migration candidate (p1 present, expected under another name).
    await reconcileOwnedProfileFiles(installation(), new Map([['p1', 'Name.cfg']]))
    expect(await read('baseq2', 'autoexec.cfg')).toBe(LOADER_CONTENT)
    expect(await baseq2Names()).toEqual(['autoexec.cfg'])
  })

  it('skips an entry that cannot be read as a file, without throwing', async () => {
    // A directory named like a cfg: not a file, so it is never read and never
    // acted on - the same outcome an unreadable file gets.
    await mkdir(join(dir, 'baseq2', 'weird.cfg'), { recursive: true })
    await seed('baseq2/q2l-profile-p1.cfg', owned('p1'))

    await expect(
      reconcileOwnedProfileFiles(installation(), new Map([['p1', 'Name.cfg']])),
    ).resolves.toBeUndefined()

    // The rest of the directory was still reconciled.
    expect(await baseq2Names()).toEqual(['Name.cfg', 'weird.cfg'])
    expect((await stat(join(dir, 'baseq2', 'weird.cfg'))).isDirectory()).toBe(true)
  })

  it('resolves without throwing when baseq2 does not exist', async () => {
    await expect(
      reconcileOwnedProfileFiles(installation(), new Map([['p1', 'Name.cfg']])),
    ).resolves.toBeUndefined()

    expect(await pathExists(join(dir, 'baseq2'))).toBe(false)
  })

  it('refuses an expected file name that is not a bare file name, before moving anything', async () => {
    await seed('baseq2/q2l-profile-p1.cfg', owned('p1'))

    await expect(
      reconcileOwnedProfileFiles(installation(), new Map([['p1', '../escaped.cfg']])),
    ).rejects.toThrow()

    // Nothing was renamed, nothing appeared next to baseq2.
    expect(await baseq2Names()).toEqual(['q2l-profile-p1.cfg'])
    expect(await readdir(dir)).toEqual(['baseq2'])
  })

  it('writes nothing outside baseq2', async () => {
    await seed('baseq2/q2l-profile-p1.cfg', owned('p1'))
    await seed('baseq2/orphan.cfg', owned('gone'))

    await reconcileOwnedProfileFiles(installation(), new Map([['p1', 'Name.cfg']]))

    // The installation root gained nothing: both actions stayed inside baseq2.
    expect(await readdir(dir)).toEqual(['baseq2'])
    expect(await baseq2Names()).toEqual(['Name.cfg'])
  })
})
