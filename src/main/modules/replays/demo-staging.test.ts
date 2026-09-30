import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiscoveredDemo } from '@shared/modules/replays'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ZipDeps } from '../../lib/zip-entries'
import { resolveExtractorPath } from '../downloads/7za-path'
import { removeStagedCopy, stageDemo, stagedFileName, sweepLauncherDirs } from './demo-staging'

const NO_ZIP: ZipDeps = { extractorPath: 'unused', extractorExists: false }
const LOG = { warn: (): void => undefined }
const realBinary = resolveExtractorPath({ isPackaged: false })

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'q2-launcher-staging-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function demo(
  id: string,
  fileName: string,
  archiveEntry: DiscoveredDemo['archiveEntry'] = null,
): DiscoveredDemo {
  return { id, fileName, archiveEntry } as DiscoveredDemo
}

async function loose(name: string, content: string | Buffer): Promise<string> {
  await mkdir(join(dir, 'src'), { recursive: true })
  const path = join(dir, 'src', name)
  await writeFile(path, content)
  return path
}

async function makeZip(zipName: string, files: Record<string, string>): Promise<string> {
  const zipSrc = join(dir, `zip-src-${zipName}`)
  await mkdir(zipSrc, { recursive: true })
  for (const [name, content] of Object.entries(files)) await writeFile(join(zipSrc, name), content)
  const archive = join(dir, zipName)
  execFileSync(realBinary.path, ['a', '-tzip', '-y', '-spd', '--', archive, ...Object.keys(files)], {
    cwd: zipSrc,
  })
  return archive
}

describe('stagedFileName', () => {
  it('keeps the lower-cased demo extension', () => {
    expect(stagedFileName(demo('x', 'A.DM2'))).toBe('x.dm2')
    expect(stagedFileName(demo('x', 'a.mvd2.gz'))).toBe('x.mvd2.gz')
    expect(stagedFileName(demo('x', 'a.b.MVD2'))).toBe('x.mvd2')
    expect(
      stagedFileName(demo('x', 'p.zip', { archivePath: 'p.zip', entryPath: 'd/E.Dm2.GZ' })),
    ).toBe('x.dm2.gz')
  })
})

describe('stageDemo', () => {
  it('a loose demo is copied into _launcher under its id', async () => {
    const src = await loose('match.dm2', 'demo-bytes')
    const demos = join(dir, 'baseq2', 'demos')
    const result = await stageDemo({
      demo: demo('abc', 'match.dm2'),
      absolutePath: src,
      targetDemosDirs: [demos],
      zipDeps: NO_ZIP,
    })
    expect(result).toEqual({
      ok: true,
      value: { copyPath: join(demos, '_launcher', 'abc.dm2'), relativePath: '_launcher/abc.dm2' },
    })
    expect(await readFile(join(demos, '_launcher', 'abc.dm2'), 'utf8')).toBe('demo-bytes')
  })

  it.skipIf(!realBinary.exists)('a zip entry is extracted alone into _launcher', async () => {
    const archive = await makeZip('pack.zip', { 'a.dm2': 'a-bytes', 'b.mvd2': 'b-bytes' })
    const demos = join(dir, 'baseq2', 'demos')
    const result = await stageDemo({
      demo: demo('zid', 'b.mvd2', { archivePath: archive, entryPath: 'b.mvd2' }),
      absolutePath: archive,
      targetDemosDirs: [demos],
      zipDeps: { extractorPath: realBinary.path, extractorExists: true },
    })
    expect(result.ok).toBe(true)
    expect(await readdir(join(demos, '_launcher'))).toEqual(['zid.mvd2'])
    expect(await readFile(join(demos, '_launcher', 'zid.mvd2'), 'utf8')).toBe('b-bytes')
  })

  it('a zip read failure fails with archiveEntry and the code', async () => {
    const result = await stageDemo({
      demo: demo('zid', 'b.dm2', { archivePath: 'x.zip', entryPath: 'b.dm2' }),
      absolutePath: 'x.zip',
      targetDemosDirs: [join(dir, 'demos')],
      zipDeps: NO_ZIP,
    })
    expect(result).toEqual({
      ok: false,
      error: { key: 'replays.play.error.archiveEntry', params: { code: 'extractor-missing' } },
    })
  })

  it('a .gz is copied byte-identical and keeps its .gz name', async () => {
    const bytes = Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3, 255, 0, 128])
    const src = await loose('m.mvd2.gz', bytes)
    const demos = join(dir, 'demos')
    const result = await stageDemo({
      demo: demo('gz1', 'm.mvd2.gz'),
      absolutePath: src,
      targetDemosDirs: [demos],
      zipDeps: NO_ZIP,
    })
    expect(result.ok && result.value.relativePath).toBe('_launcher/gz1.mvd2.gz')
    expect(Buffer.compare(await readFile(join(demos, '_launcher', 'gz1.mvd2.gz')), bytes)).toBe(0)
  })

  it('staging leaves the original file and archive unchanged in bytes and mtime', async () => {
    const src = await loose('m.dm2', 'orig')
    const past = new Date(2020, 1, 2, 3, 4, 5)
    await utimes(src, past, past)
    const before = await stat(src)
    await stageDemo({
      demo: demo('o1', 'm.dm2'),
      absolutePath: src,
      targetDemosDirs: [join(dir, 'demos')],
      zipDeps: NO_ZIP,
    })
    const after = await stat(src)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.size).toBe(before.size)
    expect(await readFile(src, 'utf8')).toBe('orig')

    if (!realBinary.exists) return
    const archive = await makeZip('p.zip', { 'a.dm2': 'zip-bytes' })
    await utimes(archive, past, past)
    const zipBytes = await readFile(archive)
    const zipStat = await stat(archive)
    await stageDemo({
      demo: demo('o2', 'a.dm2', { archivePath: archive, entryPath: 'a.dm2' }),
      absolutePath: archive,
      targetDemosDirs: [join(dir, 'demos')],
      zipDeps: { extractorPath: realBinary.path, extractorExists: true },
    })
    expect(Buffer.compare(await readFile(archive), zipBytes)).toBe(0)
    expect((await stat(archive)).mtimeMs).toBe(zipStat.mtimeMs)
  })

  it('no writable target fails with copyDirNotWritable and writes nothing', async () => {
    const src = await loose('m.dm2', 'x')
    const blockedA = join(dir, 'a', 'demos')
    const blockedB = join(dir, 'b', 'demos')
    for (const d of [blockedA, blockedB]) {
      await mkdir(d, { recursive: true })
      await writeFile(join(d, '_launcher'), 'a file, not a folder')
    }
    const result = await stageDemo({
      demo: demo('n1', 'm.dm2'),
      absolutePath: src,
      targetDemosDirs: [blockedA, blockedB],
      zipDeps: NO_ZIP,
    })
    expect(result).toEqual({
      ok: false,
      error: {
        key: 'replays.play.error.copyDirNotWritable',
        params: { path: join(blockedA, '_launcher') },
      },
    })
    expect(await readFile(join(blockedA, '_launcher'), 'utf8')).toBe('a file, not a folder')
    expect(await readdir(blockedB)).toEqual(['_launcher'])
  })

  it('falls through a first candidate blocked by a file named _launcher', async () => {
    const src = await loose('m.dm2', 'x')
    const blocked = join(dir, 'a', 'demos')
    const good = join(dir, 'b', 'demos')
    await mkdir(blocked, { recursive: true })
    await writeFile(join(blocked, '_launcher'), 'file')
    const result = await stageDemo({
      demo: demo('f1', 'm.dm2'),
      absolutePath: src,
      targetDemosDirs: [blocked, good],
      zipDeps: NO_ZIP,
    })
    expect(result.ok && result.value.copyPath).toBe(join(good, '_launcher', 'f1.dm2'))
  })

  it('same file name from two sources stages to two copies without overwriting', async () => {
    await mkdir(join(dir, 'one'), { recursive: true })
    await mkdir(join(dir, 'two'), { recursive: true })
    const a = join(dir, 'one', 'game.dm2')
    const b = join(dir, 'two', 'game.dm2')
    await writeFile(a, 'AAA')
    await writeFile(b, 'BBB')
    const demos = join(dir, 'demos')
    const stage = (id: string, path: string) =>
      stageDemo({
        demo: demo(id, 'game.dm2'),
        absolutePath: path,
        targetDemosDirs: [demos],
        zipDeps: NO_ZIP,
      })
    await stage('idA', a)
    await stage('idB', b)
    expect(await readFile(join(demos, '_launcher', 'idA.dm2'), 'utf8')).toBe('AAA')
    expect(await readFile(join(demos, '_launcher', 'idB.dm2'), 'utf8')).toBe('BBB')
  })

  it('overwrites an existing staged copy with the same name', async () => {
    const src = await loose('m.dm2', 'new')
    const demos = join(dir, 'demos')
    await mkdir(join(demos, '_launcher'), { recursive: true })
    await writeFile(join(demos, '_launcher', 's1.dm2'), 'old')
    await stageDemo({
      demo: demo('s1', 'm.dm2'),
      absolutePath: src,
      targetDemosDirs: [demos],
      zipDeps: NO_ZIP,
    })
    expect(await readFile(join(demos, '_launcher', 's1.dm2'), 'utf8')).toBe('new')
  })
})

describe('removeStagedCopy', () => {
  it('deletes only files whose parent is _launcher and never throws', async () => {
    const demos = join(dir, 'demos')
    await mkdir(join(demos, '_launcher'), { recursive: true })
    await writeFile(join(demos, '_launcher', 'a.dm2'), 'x')
    await writeFile(join(demos, 'keep.dm2'), 'x')
    await removeStagedCopy(join(demos, 'keep.dm2'))
    await removeStagedCopy(join(demos, '_launcher', 'a.dm2'))
    await removeStagedCopy(join(demos, '_launcher', 'missing.dm2'))
    expect((await readdir(demos)).sort()).toEqual(['_launcher', 'keep.dm2'])
    expect(await readdir(join(demos, '_launcher'))).toEqual([])
  })
})

describe('sweepLauncherDirs', () => {
  it('the sweep empties _launcher and nothing else', async () => {
    const d1 = join(dir, 'a', 'demos')
    const d2 = join(dir, 'b', 'demos')
    await mkdir(join(d1, '_launcher', 'nested'), { recursive: true })
    await mkdir(join(d1, 'sub'), { recursive: true })
    await writeFile(join(d1, '_launcher', 'x.dm2'), 'x')
    await writeFile(join(d1, '_launcher', 'y.mvd2.gz'), 'y')
    await writeFile(join(d1, '_launcher', 'nested', 'z.dm2'), 'z')
    await writeFile(join(d1, 'keep.dm2'), 'k')
    await writeFile(join(d1, 'sub', 'keep2.dm2'), 'k')
    await mkdir(d2, { recursive: true })

    await sweepLauncherDirs([d1, d2, join(dir, 'missing')], LOG)

    expect(await readdir(join(d1, '_launcher'))).toEqual(['nested'])
    expect(await readdir(join(d1, '_launcher', 'nested'))).toEqual(['z.dm2'])
    expect((await readdir(d1)).sort()).toEqual(['_launcher', 'keep.dm2', 'sub'])
    expect(await readdir(join(d1, 'sub'))).toEqual(['keep2.dm2'])
    expect(await readdir(d2)).toEqual([])
  })
})
