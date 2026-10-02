import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refuse } from '@shared/types'
import { canonicalizePath } from '../../lib/fs-utils'
import { appendExtraFolder, removeExtraFolder, resolveExtraFolder } from './extra-folders'

describe('resolveExtraFolder and appendExtraFolder', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q2-launcher-extra-folders-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('a non-absolute path, a file and a missing path are each rejected with their reason', async () => {
    const filePath = join(dir, 'not-a-folder.txt')
    await writeFile(filePath, 'x')

    expect(await resolveExtraFolder('relative/path')).toEqual(
      refuse('replays.extraFolders.error.notAbsolute'),
    )
    expect(await resolveExtraFolder(filePath)).toEqual(
      refuse('replays.extraFolders.error.notAFolder'),
    )
    expect(await resolveExtraFolder(join(dir, 'does-not-exist'))).toEqual(
      refuse('replays.extraFolders.error.unresolvable'),
    )
  })

  it('a folder already listed under another spelling is rejected as already listed', async () => {
    const now = '2026-01-01T00:00:00.000Z'
    const first = await resolveExtraFolder(dir)
    if (!first.ok) throw new Error('expected ok')
    const added = appendExtraFolder([], first.canonical, now, randomUUID())
    if (!added.ok) throw new Error('expected ok')

    const trailingSep = `${dir}${dir.endsWith('\\') || dir.endsWith('/') ? '' : '/'}`
    const second = await resolveExtraFolder(trailingSep)
    if (!second.ok) throw new Error('expected ok')
    expect(appendExtraFolder(added.folders, second.canonical, now, randomUUID())).toEqual(
      refuse('replays.extraFolders.error.alreadyListed'),
    )
  })

  it('a resolved folder is canonicalized and appended without mutating the list', async () => {
    const resolved = await resolveExtraFolder(dir)
    if (!resolved.ok) throw new Error('expected ok')
    expect(resolved.canonical).toBe(await canonicalizePath(dir))

    const current: never[] = []
    const result = appendExtraFolder(current, resolved.canonical, '2026-01-01T00:00:00.000Z', 'id1')
    expect(result).toEqual({
      ok: true,
      folders: [{ id: 'id1', path: resolved.canonical, addedAt: '2026-01-01T00:00:00.000Z' }],
    })
    expect(current).toEqual([])
  })
})

describe('removeExtraFolder (story 142 D2)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q2-launcher-extra-folders-remove-'))
    await writeFile(join(dir, 'demo1.dm2'), 'content-1')
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'demo2.dm2'), 'content-2')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('removing a folder leaves its files on disk untouched', async () => {
    const before = await listing(dir)

    const current = [{ id: 'f1', path: dir, addedAt: '2026-01-01T00:00:00.000Z' }]
    const next = removeExtraFolder(current, 'f1')
    expect(next).toEqual([])

    const after = await listing(dir)
    expect(after).toEqual(before)
  })

  it('an unknown id is a no-op', () => {
    const current = [{ id: 'f1', path: dir, addedAt: '2026-01-01T00:00:00.000Z' }]
    const next = removeExtraFolder(current, 'does-not-exist')
    expect(next).toEqual(current)
  })
})

/** Recursively lists relative file paths under `dir`, sorted, for a cheap before/after comparison. */
async function listing(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
}

describe('refusal keys', () => {
  it('a refused folder carries the full replays.extraFolders.error key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'q2-launcher-extra-folders-keys-'))
    try {
      const filePath = join(dir, 'file.txt')
      await writeFile(filePath, 'x')
      const first = await resolveExtraFolder(dir)
      if (!first.ok) throw new Error('expected ok')
      const listed = appendExtraFolder([], first.canonical, 'now', 'id1')
      if (!listed.ok) throw new Error('expected ok')

      const refusals = [
        await resolveExtraFolder('relative/path'),
        await resolveExtraFolder(join(dir, 'gone')),
        await resolveExtraFolder(filePath),
        appendExtraFolder(listed.folders, first.canonical, 'now', 'id2'),
      ]
      const keys = refusals.map((result) => (result.ok ? null : result.reasonKey))
      expect(keys).toEqual([
        'replays.extraFolders.error.notAbsolute',
        'replays.extraFolders.error.unresolvable',
        'replays.extraFolders.error.notAFolder',
        'replays.extraFolders.error.alreadyListed',
      ])

      const en = JSON.parse(
        readFileSync(join(process.cwd(), 'src/renderer/src/i18n/locales/en.json'), 'utf-8'),
      ) as Record<string, unknown>
      for (const key of keys) {
        const value = (key as string)
          .split('.')
          .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], en)
        expect(typeof value).toBe('string')
      }
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })
})
