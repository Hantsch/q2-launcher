import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderRef } from '@shared/replays/demo-folders'
import { READABLE_DEMO_FACTS, scanExtraFolders } from '../../../test-support/replays-scan'
import { createDemoFolderDelete } from './demo-folder-delete'
import { createPlaybackSessions } from './playback-sessions'
import type { ReplaysScanService } from './scan-service'

let root: string
let dir: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-replays-folder-delete-')))
  dir = join(root, 'demos')
  await mkdir(dir, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function setup(
  files: string[],
  opts: {
    trash?: (path: string) => Promise<void>
    override?: (scan: ReplaysScanService) => Partial<ReplaysScanService>
  } = {},
) {
  for (const name of files) {
    await mkdir(join(dir, name, '..'), { recursive: true })
    await writeFile(join(dir, name), 'x')
  }
  const scan = await scanExtraFolders(
    root,
    [dir],
    vi.fn(async () => READABLE_DEMO_FACTS),
  )
  const sessions = createPlaybackSessions()
  const trashItem = vi.fn(opts.trash ?? (async () => undefined))
  const service = createDemoFolderDelete({
    scan: { ...scan, ...opts.override?.(scan) },
    sessions,
    os: { trashItem },
  })
  const sourceKey = (await scan.readFolders())[0].sourceKey
  const ref = (...path: string[]): FolderRef => ({ sourceKey, path })
  const names = async () => (await scan.read()).map((r) => r.fileName).sort()
  return { scan, sessions, trashItem, ref, names, ...service }
}

describe('folder delete', () => {
  it('a normal folder is trashed and every row below it is dropped', async () => {
    const t = await setup(['a/one.dm2', 'a/b/two.dm2', 'keep.dm2'])
    const result = await t.deleteFolder(t.ref('a'))
    expect(result).toEqual({ ok: true, value: { demoCount: 2 } })
    expect(t.trashItem).toHaveBeenCalledExactlyOnceWith(join(dir, 'a'))
    expect(await t.names()).toEqual(['keep.dm2'])
    expect((await t.scan.readFolders()).map((f) => f.path.join('/'))).toEqual([''])
  })

  it('a refused trash is reported and nothing is removed', async () => {
    const t = await setup(['a/one.dm2'], {
      trash: async () => {
        throw new Error('no trash')
      },
    })
    const result = await t.deleteFolder(t.ref('a'))
    expect(result).toMatchObject({ ok: false, error: { key: 'replays.folder.error.trashFailed' } })
    expect(await t.names()).toEqual(['one.dm2'])
    expect(await readdir(join(dir, 'a'))).toEqual(['one.dm2'])
  })

  it('a folder is not deleted while a scan runs', async () => {
    const t = await setup(['a/one.dm2'], { override: () => ({ isScanning: () => true }) })
    const result = await t.deleteFolder(t.ref('a'))
    expect(result).toMatchObject({ ok: false, error: { key: 'replays.folder.error.scanning' } })
    expect(t.trashItem).not.toHaveBeenCalled()
  })

  it('a root, a zip folder or a folder with a playing demo is refused', async () => {
    const t = await setup(['a/one.dm2'], {
      override: (scan) => ({
        readFolders: async () => {
          const folders = await scan.readFolders()
          return [...folders, { ...folders[0], path: ['z.zip'], archive: true }]
        },
      }),
    })
    expect(await t.deleteFolder(t.ref())).toMatchObject({
      ok: false,
      error: { key: 'replays.folder.error.isRoot' },
    })
    expect(await t.deleteFolder(t.ref('z.zip'))).toMatchObject({
      ok: false,
      error: { key: 'replays.folder.error.archive' },
    })
    const id = (await t.scan.read())[0].id
    vi.spyOn(t.sessions, 'isPlaying').mockImplementation((demoId) => demoId === id)
    expect(await t.deleteFolder(t.ref('a'))).toMatchObject({
      ok: false,
      error: { key: 'replays.folder.error.playing' },
    })
    expect(t.trashItem).not.toHaveBeenCalled()
  })
})
