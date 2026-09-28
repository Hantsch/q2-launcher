import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalizePath } from '../../lib/fs-utils'
import { addExtraFolder, removeExtraFolder } from './extra-folders'

describe('addExtraFolder (story 142 D2)', () => {
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
    const missingPath = join(dir, 'does-not-exist')

    const relative = await addExtraFolder([], 'relative/path', '2026-01-01T00:00:00.000Z', randomUUID())
    expect(relative).toEqual({ ok: false, reason: 'notAbsolute' })

    const file = await addExtraFolder([], filePath, '2026-01-01T00:00:00.000Z', randomUUID())
    expect(file).toEqual({ ok: false, reason: 'notAFolder' })

    const missing = await addExtraFolder([], missingPath, '2026-01-01T00:00:00.000Z', randomUUID())
    expect(missing).toEqual({ ok: false, reason: 'unresolvable' })
  })

  it('a folder already listed under another spelling is rejected as already listed', async () => {
    const now = '2026-01-01T00:00:00.000Z'
    const first = await addExtraFolder([], dir, now, randomUUID())
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('expected ok')

    const trailingSep = `${dir}${dir.endsWith('\\') || dir.endsWith('/') ? '' : '/'}`
    const second = await addExtraFolder(first.folders, trailingSep, now, randomUUID())
    expect(second).toEqual({ ok: false, reason: 'alreadyListed' })
  })

  it('an added folder is stored canonicalized', async () => {
    const now = '2026-01-01T00:00:00.000Z'
    const result = await addExtraFolder([], dir, now, randomUUID())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok')

    const expectedCanonical = await canonicalizePath(dir)
    expect(result.folders[0]?.path).toBe(expectedCanonical)
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
