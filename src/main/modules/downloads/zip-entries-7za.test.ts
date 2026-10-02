import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listZipEntries, readZipEntry, type ZipDeps } from '../../lib/zip-entries'
import { resolveExtractorPath } from './7za-path'

describe('real zip (only when the vendored binary is present)', () => {
  const realBinary = resolveExtractorPath({ isPackaged: false })
  const fixture = resolve(__dirname, '../../../../docs/fixtures/demos/test.dm2')
  const entryNames = ['a.dm2', 'sub/a.dm2', '-dash.dm2', 'b [1].DM2']

  let dir: string
  let zipPath: string
  const sources = new Map<string, Buffer>()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q2-launcher-zip-entries-'))
    zipPath = join(dir, 'pack.zip')
    if (!realBinary.exists) return

    const src = join(dir, 'src')
    await mkdir(join(src, 'sub'), { recursive: true })
    await copyFile(fixture, join(src, 'a.dm2'))
    await writeFile(join(src, 'sub', 'a.dm2'), Buffer.from('a different demo in a subfolder'))
    await writeFile(join(src, '-dash.dm2'), Buffer.from('starts with a dash'))
    await writeFile(join(src, 'b [1].DM2'), Buffer.from('brackets are not a wildcard'))
    sources.clear()
    for (const name of entryNames) sources.set(name, await readFile(join(src, name)))

    execFileSync(
      realBinary.path,
      [
        'a',
        '-tzip',
        '-y',
        '-spd',
        '--',
        zipPath,
        // 7za.exe wants native separators; on Linux a backslash is a literal file name.
        ...entryNames.map((n) => (process.platform === 'win32' ? n.replace('/', '\\') : n)),
      ],
      { cwd: src },
    )
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const deps = (): ZipDeps => ({ extractorPath: realBinary.path, extractorExists: true })

  async function readEveryEntry(): Promise<Map<string, Uint8Array>> {
    const listing = await listZipEntries(zipPath, deps())
    expect(listing.ok).toBe(true)
    const out = new Map<string, Uint8Array>()
    if (!listing.ok) return out
    for (const entry of listing.entries.filter((e) => !e.isFolder)) {
      const read = await readZipEntry(zipPath, entry.path, entry.size ?? -1, deps())
      expect(read, entry.path).toMatchObject({ ok: true })
      if (read.ok) out.set(entry.path, read.bytes)
    }
    return out
  }

  it.skipIf(!realBinary.exists)(
    'each entry of a real zip reads back its own exact bytes',
    async () => {
      const listing = await listZipEntries(zipPath, deps())
      expect(listing.ok && listing.entries.map((e) => e.path).sort()).toEqual(
        [...entryNames].sort(),
      )

      const read = await readEveryEntry()
      expect([...read.keys()].sort()).toEqual([...entryNames].sort())
      for (const name of entryNames) {
        expect(
          Buffer.from(read.get(name) ?? new Uint8Array()).equals(
            sources.get(name) ?? Buffer.alloc(1),
          ),
          name,
        ).toBe(true)
      }
    },
  )

  it.skipIf(!realBinary.exists)(
    'a garbage file and a truncated zip are archive-unreadable',
    async () => {
      const garbage = join(dir, 'garbage.zip')
      await writeFile(
        garbage,
        Buffer.from('this is not a zip file at all, just some text'.repeat(20)),
      )
      expect(await listZipEntries(garbage, deps())).toEqual({
        ok: false,
        code: 'archive-unreadable',
      })

      const whole = await readFile(zipPath)
      const truncated = join(dir, 'truncated.zip')
      await writeFile(truncated, whole.subarray(0, Math.floor(whole.length / 2)))
      expect(await listZipEntries(truncated, deps())).toEqual({
        ok: false,
        code: 'archive-unreadable',
      })
    },
  )

  it.skipIf(!realBinary.exists)(
    "listing and reading every entry leaves the archive's size, mtime and content unchanged",
    async () => {
      const sha256 = async (): Promise<string> =>
        createHash('sha256')
          .update(await readFile(zipPath))
          .digest('hex')
      const before = await stat(zipPath)
      const hashBefore = await sha256()

      const read = await readEveryEntry()
      expect(read.size).toBe(entryNames.length)

      const after = await stat(zipPath)
      expect(after.size).toBe(before.size)
      expect(after.mtimeMs).toBe(before.mtimeMs)
      expect(await sha256()).toBe(hashBefore)
    },
  )
})
