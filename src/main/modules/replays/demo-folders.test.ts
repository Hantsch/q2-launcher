import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderRef } from '@shared/replays/demo-folders'
import type { Outcome } from '@shared/types/common'
import {
  canLinkDirectories,
  READABLE_DEMO_FACTS,
  rescan,
  scanExtraFolders,
} from '../../../test-support/replays-scan'
import { createDemoFolders } from './demo-folders'
import { createPlaybackSessions } from './playback-sessions'
import type { ReplaysScanService } from './scan-service'

/** Folder create/rename over real files: a temp demo folder scanned by the real scan service as an
 * extra folder. */

let root: string
let dir: string

beforeEach(async () => {
  // Canonical: scan ids hash the realpath, and a Windows runner's tmpdir() is an 8.3 short path.
  root = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-replays-folders-')))
  dir = join(root, 'demos')
  await mkdir(dir, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function setup(
  files: Record<string, string>,
  opts: { override?: (scan: ReplaysScanService) => Partial<ReplaysScanService> } = {},
) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true })
    if (!name.endsWith('/')) await writeFile(join(dir, name), content)
  }
  const parse = vi.fn(async () => READABLE_DEMO_FACTS)
  const scan = await scanExtraFolders(root, [dir], parse)
  const sessions = createPlaybackSessions()
  const service = createDemoFolders({
    scan: { ...scan, ...opts.override?.(scan) },
    sessions,
  })
  const sourceKey = (await scan.readFolders())[0].sourceKey
  const ref = (...path: string[]): FolderRef => ({ sourceKey, path })
  const rows = async () => (await scan.read()).map((r) => ({ name: r.fileName, folder: r.folder }))
  const folderPaths = async () => (await scan.readFolders()).map((f) => f.path.join('/')).sort()
  const idOf = async (fileName: string): Promise<string> => {
    const row = (await scan.read()).find((r) => r.fileName === fileName)
    if (!row) throw new Error(`no row for ${fileName}`)
    return row.id
  }
  return { scan, parse, sessions, ref, rows, folderPaths, idOf, ...service }
}

const list = async (...path: string[]): Promise<string[]> =>
  (await readdir(join(dir, ...path))).sort()

function errorKey(outcome: Outcome<unknown>): string | undefined {
  return outcome.ok ? undefined : outcome.error.key
}

describe('folder rename', () => {
  it('rename moves the sidecars with their demos', async () => {
    const t = await setup({
      'a/x.dm2': 'demo',
      'a/x.dm2.json': '{"name":"X"}',
      'a/deep/z.dm2': 'z',
    })
    const oldId = await t.idOf('x.dm2')

    const outcome = await t.rename(t.ref('a'), 'b')

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(await list()).toEqual(['b'])
    expect(await list('b')).toEqual(['deep', 'x.dm2', 'x.dm2.json'])
    expect((await t.rows()).sort((p, q) => p.name.localeCompare(q.name))).toEqual([
      { name: 'x.dm2', folder: ['b'] },
      { name: 'z.dm2', folder: ['b', 'deep'] },
    ])
    expect(await t.folderPaths()).toEqual(['', 'b', 'b/deep'])
    const newId = outcome.value.ids.find((m) => m.from === oldId)?.to
    expect(newId).toBe(await t.idOf('x.dm2'))
    expect(t.scan.resolveFile(oldId)).toBeUndefined()
    expect(t.scan.resolveFile(newId!)?.absolutePath).toBe(join(dir, 'b', 'x.dm2'))
  })

  it('rename keeps parsed facts without re-parsing', async () => {
    const t = await setup({ 'a/x.dm2': 'demo', 'a/deep/z.dm2': 'z' })
    const parsedBefore = t.parse.mock.calls.length

    const outcome = await t.rename(t.ref('a'), 'b')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const renamedIds = outcome.value.ids.map((m) => m.to).sort()

    await rescan(t.scan)

    expect(t.parse.mock.calls.length).toBe(parsedBefore)
    expect((await t.scan.read()).map((r) => r.id).sort()).toEqual(renamedIds)
    expect((await t.scan.read()).every((r) => r.map === 'q2dm1')).toBe(true)
  })

  it('a sibling sharing the name as a prefix is left alone', async () => {
    const t = await setup({ 'a/x.dm2': 'x', 'ab/y.dm2': 'y', 'a.dm2': 'top' })
    const siblingId = await t.idOf('y.dm2')
    const topId = await t.idOf('a.dm2')
    const movedId = await t.idOf('x.dm2')

    const outcome = await t.rename(t.ref('a'), 'c')

    expect(outcome.ok && outcome.value.ids.map((m) => m.from)).toEqual([movedId])
    expect(await t.idOf('y.dm2')).toBe(siblingId)
    expect(await t.idOf('a.dm2')).toBe(topId)
    expect(t.scan.resolveFile(siblingId)?.absolutePath).toBe(join(dir, 'ab', 'y.dm2'))
    expect(await t.folderPaths()).toEqual(['', 'ab', 'c'])
    expect(await list()).toEqual(['a.dm2', 'ab', 'c'])
  })

  it('a case-only rename is not a clash', async () => {
    const t = await setup({ 'duels/x.dm2': 'demo' })
    const parsedBefore = t.parse.mock.calls.length

    const outcome = await t.rename(t.ref('duels'), 'Duels')

    expect(outcome.ok).toBe(true)
    expect(await list()).toEqual(['Duels'])
    expect(await t.rows()).toEqual([{ name: 'x.dm2', folder: ['Duels'] }])
    expect(await t.folderPaths()).toEqual(['', 'Duels'])
    await rescan(t.scan)
    expect(t.parse.mock.calls.length).toBe(parsedBefore)
  })

  it('a root cannot be renamed', async () => {
    const t = await setup({ 'x.dm2': 'demo' })

    expect(errorKey(await t.rename(t.ref(), 'other'))).toBe('replays.folder.error.root')
    expect(await list()).toEqual(['x.dm2'])
  })

  it('a folder with a playing demo is not renamed', async () => {
    const t = await setup({ 'a/deep/x.dm2': 'demo' })
    t.sessions.begin(await t.idOf('x.dm2'))

    expect(errorKey(await t.rename(t.ref('a'), 'b'))).toBe('replays.folder.error.playing')
    expect(await list()).toEqual(['a'])
  })

  it('an existing name is refused', async () => {
    const t = await setup({ 'a/x.dm2': 'demo', 'b/y.dm2': 'other' })

    expect(errorKey(await t.rename(t.ref('a'), 'b'))).toBe('replays.folder.error.exists')
    expect(await list('a')).toEqual(['x.dm2'])
    expect(await list('b')).toEqual(['y.dm2'])
  })

  it('an invalid name is refused with its rule', async () => {
    const t = await setup({ 'a/x.dm2': 'demo' })

    expect(errorKey(await t.rename(t.ref('a'), '..'))).toBe('replays.folder.error.dotDot')
    expect(await list()).toEqual(['a'])
  })

  it('nothing is renamed while a scan is running', async () => {
    const t = await setup({ 'a/x.dm2': 'demo' }, { override: () => ({ isScanning: () => true }) })

    expect(errorKey(await t.rename(t.ref('a'), 'b'))).toBe('replays.folder.error.scanning')
    expect(await list()).toEqual(['a'])
  })
})

describe('folder create', () => {
  it('a new folder is listed without a rescan', async () => {
    const t = await setup({ 'a/x.dm2': 'demo' })

    const outcome = await t.create(t.ref('a'), 'new')

    expect(outcome.ok && outcome.value.folder).toEqual(t.ref('a', 'new'))
    expect(await list('a')).toEqual(['new', 'x.dm2'])
    expect(await t.folderPaths()).toEqual(['', 'a', 'a/new'])
  })

  it('a folder is created in a root that has no demo at all', async () => {
    const t = await setup({})

    const created = await t.create(t.ref(), 'first')
    expect(created.ok).toBe(true)
    const nested = await t.create(t.ref('first'), 'second')

    expect(nested.ok).toBe(true)
    expect(await list('first')).toEqual(['second'])
    expect(await t.rename(t.ref('first'), 'renamed')).toEqual({ ok: true, value: { ids: [] } })
    expect(await t.folderPaths()).toEqual(['', 'renamed', 'renamed/second'])
  })

  it('an existing folder is refused', async () => {
    const t = await setup({ 'a/x.dm2': 'demo' })

    expect(errorKey(await t.create(t.ref(), 'a'))).toBe('replays.folder.error.exists')
  })

  it('create in an archive is refused', async () => {
    const t = await setup(
      { 'x.dm2': 'demo' },
      {
        override: (scan) => ({
          readFolders: async () => [
            ...(await scan.readFolders()),
            {
              sourceKey: (await scan.readFolders())[0].sourceKey,
              path: ['pack.zip'],
              archive: true,
            },
          ],
        }),
      },
    )

    expect(errorKey(await t.create(t.ref('pack.zip'), 'inner'))).toBe(
      'replays.folder.error.archive',
    )
    expect(errorKey(await t.rename(t.ref('pack.zip'), 'other.zip'))).toBe(
      'replays.folder.error.archive',
    )
  })
})

const canLink = await canLinkDirectories()

describe('folder containment', () => {
  it.skipIf(!canLink)('a symlinked folder outside the root is refused', async () => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    const t = await setup({ 'x.dm2': 'demo' })
    await symlink(outside, join(dir, 'link'), 'junction')
    await rescan(t.scan)

    expect(errorKey(await t.create(t.ref('link'), 'inner'))).toBe(
      'replays.folder.error.outsideSource',
    )
    expect(errorKey(await t.rename(t.ref('link'), 'renamed'))).toBe(
      'replays.folder.error.outsideSource',
    )
    expect(await readdir(outside)).toEqual([])
    expect(await list()).toEqual(['link', 'x.dm2'])
  })
})
