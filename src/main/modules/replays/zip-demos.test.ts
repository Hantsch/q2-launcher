import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDemoHeader } from '@shared/demos/demo-header'
import type { DemoSource, DiscoveredDemo } from '@shared/modules/replays'
import { resolveExtractorPath } from '../downloads/7za-path'
import * as zipEntries from '../../lib/zip-entries'
import { ZIP_ENTRY_MAX_BYTES, type ZipDeps, type ZipEntry } from '../../lib/zip-entries'
import { expandZip } from './zip-demos'

const SOURCE: DemoSource = { kind: 'extraFolder', path: 'C:/demos/pack' }

describe('expandZip (fake listing/reader)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('oversized and encrypted entries are unparsable rows and a broken archive is a source error', async () => {
    vi.spyOn(zipEntries, 'listZipEntries').mockResolvedValue({
      ok: true,
      entries: [
        { path: 'big.dm2', isFolder: false, size: ZIP_ENTRY_MAX_BYTES + 1, modified: null, encrypted: false },
        { path: 'secret.dm2', isFolder: false, size: 10, modified: null, encrypted: true },
        { path: 'null-size.dm2', isFolder: false, size: null, modified: null, encrypted: false },
      ],
    })
    const readSpy = vi.spyOn(zipEntries, 'readZipEntry')

    const result = await expandZip('C:/demos/pack.zip', SOURCE, 0, {} as ZipDeps)
    expect(result.error).toBeNull()
    expect(readSpy).not.toHaveBeenCalled()
    expect(result.rows.map((r) => ({ fileName: r.fileName, unparsableReason: r.unparsableReason }))).toEqual([
      { fileName: 'big.dm2', unparsableReason: 'entry-too-large' },
      { fileName: 'secret.dm2', unparsableReason: 'encrypted' },
      { fileName: 'null-size.dm2', unparsableReason: 'entry-too-large' },
    ])
    for (const row of result.rows) {
      expect(row.archiveEntry).toEqual({ archivePath: 'C:/demos/pack.zip', entryPath: row.fileName })
      expect(row.map).toBeNull()
    }

    vi.spyOn(zipEntries, 'listZipEntries').mockResolvedValue({ ok: false, code: 'archive-unreadable' })
    const errored = await expandZip('C:/demos/broken.zip', SOURCE, 0, {} as ZipDeps)
    expect(errored).toEqual({ rows: [], error: { archivePath: 'C:/demos/broken.zip', code: 'archive-unreadable' } })
  })

  it('a zip inside a zip is never read', async () => {
    const entries: ZipEntry[] = [
      { path: 'inner.zip', isFolder: false, size: 1000, modified: null, encrypted: false },
      { path: 'nested/deep.zip', isFolder: false, size: 1000, modified: null, encrypted: false },
      { path: 'readme.txt', isFolder: false, size: 10, modified: null, encrypted: false },
      { path: 'sub', isFolder: true, size: null, modified: null, encrypted: false },
    ]
    vi.spyOn(zipEntries, 'listZipEntries').mockResolvedValue({ ok: true, entries })
    const readSpy = vi.spyOn(zipEntries, 'readZipEntry')

    const result = await expandZip('C:/demos/pack.zip', SOURCE, 0, {} as ZipDeps)
    expect(result.rows).toEqual([])
    expect(readSpy).not.toHaveBeenCalled()
  })
})

describe('expandZip (real 7za binary)', () => {
  const realBinary = resolveExtractorPath({ isPackaged: false })
  const dm2Fixture = resolve(__dirname, '../../../../docs/fixtures/demos/test.dm2')
  const mvd2Fixture = resolve(
    __dirname,
    '../../../../docs/fixtures/demos/PFAU_20221127-053327_q2dm1.mvd2',
  )

  let dir: string
  let zipPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'q2-launcher-zip-demos-'))
    zipPath = join(dir, 'pack.zip')
    if (!realBinary.exists) return

    const src = join(dir, 'src')
    await mkdir(join(src, 'sub'), { recursive: true })
    await import('node:fs/promises').then(({ copyFile }) => copyFile(dm2Fixture, join(src, 'test.dm2')))
    await import('node:fs/promises').then(({ copyFile }) => copyFile(mvd2Fixture, join(src, 'test.mvd2')))
    await writeFile(join(src, 'test.dm2.gz'), gzipSync(await readFile(dm2Fixture)))
    await writeFile(join(src, 'readme.txt'), Buffer.from('not a demo'))
    await writeFile(join(src, 'sub', '.keep'), Buffer.from(''))

    // A small nested zip: its presence, not its contents, is what matters here.
    const innerSrc = join(dir, 'inner-src')
    await mkdir(innerSrc, { recursive: true })
    await writeFile(join(innerSrc, 'a.dm2'), Buffer.from('nested demo bytes'))
    execFileSync(realBinary.path, ['a', '-tzip', '-y', '-spd', '--', join(src, 'inner.zip'), 'a.dm2'], {
      cwd: innerSrc,
    })

    execFileSync(
      realBinary.path,
      [
        'a',
        '-tzip',
        '-y',
        '-spd',
        '--',
        zipPath,
        'test.dm2',
        'test.mvd2',
        'test.dm2.gz',
        'readme.txt',
        'inner.zip',
        'sub',
      ],
      { cwd: src },
    )
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const deps = (): ZipDeps => ({ extractorPath: realBinary.path, extractorExists: true })

  it.skipIf(!realBinary.exists)(
    'a zip yields one row per dm2, mvd2, dm2.gz and mvd2.gz entry and ignores the rest',
    async () => {
      const result = await expandZip(zipPath, SOURCE, 0, deps())
      expect(result.error).toBeNull()
      expect(result.rows.map((r) => r.fileName).sort()).toEqual([
        'test.dm2',
        'test.dm2.gz',
        'test.mvd2',
      ])
    },
  )

  it.skipIf(!realBinary.exists)(
    'a zipped demo parses to exactly the facts of the same loose file',
    async () => {
      const result = await expandZip(zipPath, SOURCE, 0, deps())
      const zippedPlain = result.rows.find((r) => r.fileName === 'test.dm2')
      const zippedGz = result.rows.find((r) => r.fileName === 'test.dm2.gz')
      expect(zippedPlain).toBeDefined()
      expect(zippedGz).toBeDefined()

      const looseBytes = await readFile(dm2Fixture)
      const looseHeader = parseDemoHeader(looseBytes)

      const expected = looseHeader.ok
        ? { map: looseHeader.map, format: looseHeader.format }
        : { map: null, format: undefined }

      expect({ map: zippedPlain!.map, format: zippedPlain!.format }).toMatchObject(
        looseHeader.ok ? expected : { map: null },
      )
      expect({ map: zippedGz!.map, format: zippedGz!.format }).toMatchObject(
        looseHeader.ok ? expected : { map: null },
      )
      if (!looseHeader.ok) {
        expect(zippedPlain!.unparsableReason).toBe(looseHeader.reason)
        expect(zippedGz!.unparsableReason).toBe(looseHeader.reason)
      } else {
        expect(zippedPlain!.unparsableReason).toBeNull()
        expect(zippedGz!.unparsableReason).toBeNull()
      }
    },
  )

  it('every entry row carries archiveEntry and a loose row does not', async () => {
    if (!realBinary.exists) return
    const result = await expandZip(zipPath, SOURCE, 0, deps())
    expect(result.rows.length).toBeGreaterThan(0)
    for (const row of result.rows) {
      expect(row.archiveEntry).not.toBeNull()
      expect(row.archiveEntry).toEqual({ archivePath: zipPath, entryPath: row.fileName })
    }

    const looseRow: DiscoveredDemo = {
      id: '0'.repeat(16),
      fileName: 'loose.dm2',
      format: 'dm2',
      gzip: false,
      source: SOURCE,
      archiveEntry: null,
      map: null,
      unparsableReason: null,
    }
    expect(looseRow.archiveEntry).toBeNull()
  })
})
