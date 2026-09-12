import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isStoreManaged } from '@shared/types'
import { deleteInstallationFolder } from './installation-removal'

/**
 * Story 094 D1 (AC3, part of AC7): the launcher's only recursive delete. Everything here runs
 * against real temp directories rather than a mocked filesystem - a fence that only holds against
 * a fake `fs` is no fence at all. The single exception is the injected-failure test at the bottom,
 * which needs `rm` itself to fail.
 */

const RM_EXPLODES = 'rm-explodes'

const mocked = vi.hoisted(() => ({ failOnPathsContaining: null as string | null }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: async (
      target: Parameters<typeof actual.rm>[0],
      options?: Parameters<typeof actual.rm>[1],
    ) => {
      const marker = mocked.failOnPathsContaining
      if (marker && String(target).includes(marker)) {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
      }
      return actual.rm(target, options)
    },
  }
})

let dir: string
let userData: string
let home: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-removal-'))
  userData = join(dir, 'userData')
  home = join(dir, 'home')
  await mkdir(userData, { recursive: true })
  await mkdir(home, { recursive: true })
})

afterEach(async () => {
  mocked.failOnPathsContaining = null
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/** The two injected directories are the same in every test; only the root under test varies. */
function params(rootPath: string, otherInstallationRoots: string[] = []) {
  return { rootPath, userDataDir: userData, homeDir: home, otherInstallationRoots }
}

/** A folder with nested subdirectories, several files and one read-only file. */
async function writeTree(root: string): Promise<void> {
  await mkdir(join(root, 'baseq2', 'players', 'male'), { recursive: true })
  await mkdir(join(root, 'ctf'), { recursive: true })
  await writeFile(join(root, 'q2pro.exe'), 'stand-in executable')
  await writeFile(join(root, 'baseq2', 'pak0.pak'), 'not a real pak')
  await writeFile(join(root, 'baseq2', 'players', 'male', 'grunt.pcx'), 'skin')
  await writeFile(join(root, 'ctf', 'gamex86.dll'), 'stand-in game library')
  const readOnly = join(root, 'baseq2', 'config.cfg')
  await writeFile(readOnly, 'bind w +forward')
  // Windows honours the read-only attribute through chmod even though it ignores the mode bits;
  // `fs.rm` is expected to clear it rather than fail, on either platform.
  await chmod(readOnly, 0o444)
}

describe('deleteInstallationFolder', () => {
  it('AC3: the installation folder and its contents are gone and nothing outside it is touched', async () => {
    const root = join(dir, 'game')
    await writeTree(root)
    const siblingDir = join(dir, 'other-game')
    const siblingFile = join(dir, 'keep-me.txt')
    await mkdir(join(siblingDir, 'baseq2'), { recursive: true })
    await writeFile(join(siblingDir, 'baseq2', 'pak0.pak'), 'sibling pak')
    await writeFile(siblingFile, 'untouched')

    const result = await deleteInstallationFolder(params(root))

    expect(result).toEqual({ ok: true, value: null })
    expect(existsSync(root)).toBe(false)
    expect(existsSync(join(root, 'baseq2', 'players', 'male', 'grunt.pcx'))).toBe(false)
    expect(existsSync(join(root, 'baseq2', 'config.cfg'))).toBe(false)
    expect(existsSync(join(siblingDir, 'baseq2', 'pak0.pak'))).toBe(true)
    expect(await readFile(siblingFile, 'utf8')).toBe('untouched')
    expect(existsSync(userData)).toBe(true)
    expect(existsSync(home)).toBe(true)
  })

  it('AC3: a root that is a drive root, the userData dir, the home dir or an ancestor of another installation is refused', async () => {
    // A drive/filesystem root, taken from the platform the test actually runs on.
    const driveRoot = parse(dir).root
    const atDriveRoot = await deleteInstallationFolder(params(driveRoot))
    expect(atDriveRoot.ok === false && atDriveRoot.error.key).toBe(
      'installations.error.deleteFromDiskRoot',
    )
    expect(existsSync(driveRoot)).toBe(true)

    // One segment below it - refused on shape, before existence is even considered.
    const oneSegment = join(driveRoot, 'q2-launcher-single-segment-must-not-be-deleted')
    const shallow = await deleteInstallationFolder(params(oneSegment))
    expect(shallow.ok).toBe(false)
    expect(shallow.ok === false && shallow.error.key).toBe('installations.error.deleteFromDiskRoot')
    expect(existsSync(oneSegment)).toBe(false)

    // The launcher's own data directory.
    await writeFile(join(userData, 'state.json'), '{}')
    const atUserData = await deleteInstallationFolder(params(userData))
    expect(atUserData.ok === false && atUserData.error.key).toBe(
      'installations.error.deleteFromDiskUserData',
    )
    expect(existsSync(join(userData, 'state.json'))).toBe(true)

    // A folder that *holds* the launcher's data directory is just as fatal.
    const holdsUserData = await deleteInstallationFolder(params(dir))
    expect(holdsUserData.ok === false && holdsUserData.error.key).toBe(
      'installations.error.deleteFromDiskUserData',
    )
    expect(existsSync(dir)).toBe(true)

    // The user's home directory.
    await writeFile(join(home, 'important.txt'), 'mine')
    const atHome = await deleteInstallationFolder(params(home))
    expect(atHome.ok === false && atHome.error.key).toBe('installations.error.deleteFromDiskHome')
    expect(await readFile(join(home, 'important.txt'), 'utf8')).toBe('mine')

    // An ancestor of another registered installation.
    const parent = join(dir, 'parent')
    const nested = join(parent, 'nested-installation')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, 'pak0.pak'), 'other installation')
    const overlaps = await deleteInstallationFolder(params(parent, [nested]))
    expect(overlaps.ok === false && overlaps.error.key).toBe(
      'installations.error.deleteFromDiskOverlapsInstallation',
    )
    expect(existsSync(parent)).toBe(true)
    expect(existsSync(join(nested, 'pak0.pak'))).toBe(true)
  })

  it('AC3: a missing path is refused instead of reported as a silent success', async () => {
    const missing = join(dir, 'games', 'never-existed')

    const result = await deleteInstallationFolder(params(missing))

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.key).toBe(
      'installations.error.deleteFromDiskMissing',
    )
  })

  it('AC3: a link inside the folder is unlinked, its target outside the folder survives', async () => {
    const root = join(dir, 'game')
    await writeTree(root)
    const outsideDir = join(dir, 'shared-assets')
    const outsideFile = join(outsideDir, 'pak1.pak')
    await mkdir(outsideDir, { recursive: true })
    await writeFile(outsideFile, 'shared pak that must survive')

    const linkPath = join(root, 'baseq2', 'linked')
    let linkKind: 'file symlink' | 'directory junction'
    try {
      await symlink(outsideFile, linkPath, 'file')
      linkKind = 'file symlink'
    } catch (error) {
      // Windows needs Developer Mode or elevation for symlinks, but never for a junction - which
      // exercises the same "do not descend into a link" property.
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
      console.warn('symlink() returned EPERM; falling back to a directory junction')
      await symlink(outsideDir, linkPath, 'junction')
      linkKind = 'directory junction'
    }
    expect(existsSync(linkPath)).toBe(true)

    const result = await deleteInstallationFolder(params(root))

    expect(result).toEqual({ ok: true, value: null })
    expect(existsSync(root), `${linkKind}: the tree is gone`).toBe(false)
    expect(await readFile(outsideFile, 'utf8')).toBe('shared pak that must survive')
    expect(existsSync(outsideDir)).toBe(true)
  })

  it('AC3: a failing delete surfaces as a failure instead of a silent success', async () => {
    const root = join(dir, RM_EXPLODES)
    await writeTree(root)
    mocked.failOnPathsContaining = RM_EXPLODES

    const result = await deleteInstallationFolder(params(root))

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.key).toBe('installations.error.deleteFromDiskFailed')
    expect(existsSync(root)).toBe(true)
  })

  it('an injected home directory, not the real one, is what the fence compares against', async () => {
    // On Windows the temp tree sits inside the real home directory (`AppData\Local\Temp`), so a
    // function reaching for `os.homedir()` instead of the injected value would refuse this delete -
    // and every other delete a user makes below their home directory with it.
    const root = join(dir, 'game')
    await writeTree(root)

    expect(await deleteInstallationFolder(params(root))).toEqual({ ok: true, value: null })
  })
})

/**
 * `src/shared/types/installation.ts` has no test file of its own and a one-line predicate does not
 * warrant one; it lives here because story 094's delete flow is what introduced it.
 */
describe('isStoreManaged', () => {
  it('is true for the store sources and false for every other one', () => {
    expect(['steam', 'gog', 'epic', 'bethesda'].map((s) => isStoreManaged(s as never))).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(
      ['manual', 'retail', 'created', 'unknown'].map((s) => isStoreManaged(s as never)),
    ).toEqual([false, false, false, false])
  })
})
