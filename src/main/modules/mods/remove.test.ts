import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModInstallFile } from '@shared/modules/mods'
import { RemovalRefusedError, planRemoval, removeRecordedFiles } from './remove'

/**
 * Story 191 D1. These delete real files, so every path is built from `dir`, a throwaway temp
 * directory per test - this suite must never be able to touch a real installation.
 *
 * `unlink` is wrapped (passing through by default) only so one test can make a delete fail.
 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, unlink: vi.fn(actual.unlink) }
})

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

/** A directory link that needs no privilege: a junction on Windows, a symlink elsewhere. */
const canLinkDirs = await (async () => {
  const probe = await mkdtemp(join(tmpdir(), 'q2-launcher-remove-probe-'))
  try {
    await mkdir(join(probe, 'target'))
    await symlink(join(probe, 'target'), join(probe, 'link'), 'junction')
    return true
  } catch {
    return false
  } finally {
    await rm(probe, { recursive: true, force: true })
  }
})()

let dir: string
let root: string
let gameDirPath: string

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-mods-remove-')))
  root = join(dir, 'quake2')
  gameDirPath = join(root, 'rogue')
  await mkdir(gameDirPath, { recursive: true })
  await mkdir(join(root, 'baseq2'))
  await writeFile(join(root, 'baseq2', 'pak0.pak'), 'the base game')
})

afterEach(async () => {
  vi.mocked(unlink).mockImplementation(actualFs.unlink)
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Writes `rel` under the game dir and returns its record row, as story 190 would have. */
async function installed(rel: string, content = `bytes of ${rel}`): Promise<ModInstallFile> {
  const path = join(gameDirPath, ...rel.split('/'))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
  return { path: rel, sizeBytes: Buffer.byteLength(content), sha256: sha256(content) }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

describe('removeRecordedFiles', () => {
  it('every recorded file is deleted', async () => {
    const files = [
      await installed('pak0.pak'),
      await installed('maps/x.bsp'),
      await installed('gamex86.dll'),
    ]

    const result = await removeRecordedFiles(root, 'rogue', { files }, { changedFiles: 'keep' })

    expect(result).toEqual({
      deleted: ['pak0.pak', 'maps/x.bsp', 'gamex86.dll'],
      kept: [],
      failed: [],
      folderRemoved: true,
    })
    for (const file of files) expect(await exists(join(gameDirPath, file.path))).toBe(false)
    expect(await exists(join(root, 'baseq2', 'pak0.pak'))).toBe(true)
  })

  it('an unrecorded file survives', async () => {
    const files = [await installed('pak0.pak')]
    await mkdir(join(gameDirPath, 'demos'))
    await writeFile(join(gameDirPath, 'demos', 'mine.dm2'), 'my demo')

    const result = await removeRecordedFiles(root, 'rogue', { files }, { changedFiles: 'delete' })

    expect(result.deleted).toEqual(['pak0.pak'])
    expect(await readFile(join(gameDirPath, 'demos', 'mine.dm2'), 'utf8')).toBe('my demo')
    expect(result.folderRemoved).toBe(false)
  })

  it('the gamedir is removed when empty and kept when not', async () => {
    const files = [await installed('maps/x.bsp')]
    const emptied = await removeRecordedFiles(root, 'rogue', { files }, { changedFiles: 'keep' })
    expect(emptied.folderRemoved).toBe(true)
    expect(await exists(gameDirPath)).toBe(false)

    const again = [await installed('maps/x.bsp')]
    await writeFile(join(gameDirPath, 'config.cfg'), 'bind x +attack')
    const kept = await removeRecordedFiles(
      root,
      'rogue',
      { files: again },
      { changedFiles: 'keep' },
    )
    expect(kept.folderRemoved).toBe(false)
    expect(await exists(join(gameDirPath, 'maps'))).toBe(false)
    expect(await exists(join(gameDirPath, 'config.cfg'))).toBe(true)
  })

  it('a changed file is listed and kept on keep, deleted on delete', async () => {
    const record = async () => ({
      files: [
        await installed('a.pak', 'aaaa'),
        await installed('b.pak', 'bbbb'),
        await installed('c.pak', 'cccc'),
      ],
    })
    const change = async () => {
      await writeFile(join(gameDirPath, 'a.pak'), 'a different size') // size differs
      await writeFile(join(gameDirPath, 'b.pak'), 'BBBB') // same size, other bytes
    }

    const first = await record()
    await change()
    expect(await planRemoval(root, 'rogue', first)).toEqual({
      changed: ['a.pak', 'b.pak'],
      missing: [],
    })
    const onKeep = await removeRecordedFiles(root, 'rogue', first, { changedFiles: 'keep' })
    expect(onKeep).toMatchObject({
      deleted: ['c.pak'],
      kept: ['a.pak', 'b.pak'],
      failed: [],
      folderRemoved: false,
    })
    expect(await readFile(join(gameDirPath, 'b.pak'), 'utf8')).toBe('BBBB')

    const second = await record()
    await change()
    const onDelete = await removeRecordedFiles(root, 'rogue', second, { changedFiles: 'delete' })
    expect(onDelete).toEqual({
      deleted: ['a.pak', 'b.pak', 'c.pak'],
      kept: [],
      failed: [],
      folderRemoved: true,
    })
  })

  it('a missing recorded file is already gone, not an error', async () => {
    const present = await installed('pak0.pak')
    const gone: ModInstallFile = { path: 'pak1.pak', sizeBytes: 4, sha256: sha256('gone') }
    const goneNested: ModInstallFile = {
      path: 'maps/gone.bsp',
      sizeBytes: 4,
      sha256: sha256('gone'),
    }
    const record = { files: [present, gone, goneNested] }

    expect(await planRemoval(root, 'rogue', record)).toEqual({
      changed: [],
      missing: ['pak1.pak', 'maps/gone.bsp'],
    })
    const result = await removeRecordedFiles(root, 'rogue', record, { changedFiles: 'keep' })
    expect(result).toEqual({ deleted: ['pak0.pak'], kept: [], failed: [], folderRemoved: true })
  })

  it('a record path outside the gamedir refuses the removal and deletes nothing', async () => {
    const inside = await installed('pak0.pak')
    const escapes: ModInstallFile = {
      path: '../baseq2/pak0.pak',
      sizeBytes: 13,
      sha256: sha256('the base game'),
    }
    const absolute: ModInstallFile = {
      path: join(root, 'baseq2', 'pak0.pak').replace(/\\/g, '/'),
      sizeBytes: 13,
      sha256: sha256('the base game'),
    }

    for (const bad of [escapes, absolute]) {
      const record = { files: [inside, bad] }
      await expect(
        removeRecordedFiles(root, 'rogue', record, { changedFiles: 'delete' }),
      ).rejects.toThrow(RemovalRefusedError)
      await expect(planRemoval(root, 'rogue', record)).rejects.toThrow(
        'mods.remove.refused.unsafePath',
      )
    }
    for (const gameDir of ['..', 'baseq2', '']) {
      await expect(
        removeRecordedFiles(root, gameDir, { files: [] }, { changedFiles: 'delete' }),
      ).rejects.toBeInstanceOf(RemovalRefusedError)
    }
    expect(await exists(join(gameDirPath, 'pak0.pak'))).toBe(true)
    expect(await readFile(join(root, 'baseq2', 'pak0.pak'), 'utf8')).toBe('the base game')
  })

  it.skipIf(!canLinkDirs)('a symlinked subdirectory pointing outside is not followed', async () => {
    const inside = await installed('pak0.pak')
    const outside = join(dir, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'x.bsp'), 'not the mod')
    await symlink(outside, join(gameDirPath, 'maps'), 'junction')
    const viaLink: ModInstallFile = {
      path: 'maps/x.bsp',
      sizeBytes: 11,
      sha256: sha256('not the mod'),
    }

    await expect(
      removeRecordedFiles(root, 'rogue', { files: [inside, viaLink] }, { changedFiles: 'delete' }),
    ).rejects.toBeInstanceOf(RemovalRefusedError)
    expect(await readFile(join(outside, 'x.bsp'), 'utf8')).toBe('not the mod')
    expect(await exists(join(gameDirPath, 'pak0.pak'))).toBe(true)
  })

  it('a failed delete is reported and the rest still deleted', async () => {
    const files = [await installed('a.pak'), await installed('b.pak'), await installed('c.pak')]
    vi.mocked(unlink).mockImplementation(async (path) => {
      if (String(path).endsWith('b.pak')) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      return actualFs.unlink(path)
    })

    const result = await removeRecordedFiles(root, 'rogue', { files }, { changedFiles: 'delete' })

    expect(result).toEqual({
      deleted: ['a.pak', 'c.pak'],
      kept: [],
      failed: [{ path: 'b.pak', code: 'EBUSY' }],
      folderRemoved: false,
    })
    expect(await exists(join(gameDirPath, 'b.pak'))).toBe(true)
  })
})
