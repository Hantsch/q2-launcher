import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Installation } from '@shared/types'
import { pathExists } from '../../lib/fs-utils'
import { OWNERSHIP_MARKER } from './render'
import { BACKUP_SUFFIX, writeInstallationFiles } from './writer'
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
