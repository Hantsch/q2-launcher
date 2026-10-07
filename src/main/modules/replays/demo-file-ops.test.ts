import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BulkOutcome } from '@shared/replays/bulk'
import type { Outcome } from '@shared/types/common'
import { scanExtraFolders } from '../../../test-support/replays-scan'
import { createDemoFileOps } from './demo-file-ops'
import { nodeNoOverwriteFs, type NoOverwriteFs } from './fs-steps'
import { createPlaybackSessions } from './playback-sessions'
import type { ReplaysScanService } from './scan-service'

/** Bulk delete and move over real files: a temp demo folder scanned by the real scan service, a
 * stand-in OS trash that moves files into a temp dir, and an injected `fs` only where one specific
 * call must fail. */

let root: string
let dir: string
let sub: string
let trashDir: string

beforeEach(async () => {
  // Canonical: scan ids hash the realpath, and a Windows runner's tmpdir() is an 8.3 short path.
  root = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-replays-file-ops-')))
  dir = join(root, 'demos')
  sub = join(dir, 'sub')
  trashDir = join(root, 'trash')
  await mkdir(sub, { recursive: true })
  await mkdir(trashDir)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

/** A filesystem that behaves like the real one except where `fail` throws for a call. */
function failingFs(fail: {
  [K in keyof NoOverwriteFs]?: (...args: string[]) => void
}): NoOverwriteFs {
  const wrap = <K extends keyof NoOverwriteFs>(key: K) =>
    (async (...args: string[]) => {
      fail[key]?.(...args)
      return (nodeNoOverwriteFs[key] as (...a: unknown[]) => Promise<unknown>)(...args)
    }) as unknown as NoOverwriteFs[K]
  return {
    stat: wrap('stat'),
    link: wrap('link'),
    unlink: wrap('unlink'),
    copyFile: wrap('copyFile'),
    utimes: wrap('utimes'),
  }
}

async function setup(
  files: Record<string, string>,
  opts: { fs?: NoOverwriteFs; trash?: (path: string) => Promise<void> } = {},
) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true })
    await writeFile(join(dir, name), content)
  }
  const scan = await scanExtraFolders(root, [dir])
  const sessions = createPlaybackSessions()
  const trashed: string[] = []
  const trashItem = vi.fn(
    opts.trash ??
      (async (path: string) => {
        await rename(path, join(trashDir, `${trashed.length}-${basename(path)}`))
        trashed.push(path)
      }),
  )
  const ops = createDemoFileOps({ scan, sessions, os: { trashItem }, fs: opts.fs })
  const idOf = async (fileName: string): Promise<string> => {
    const row = (await scan.read()).find((r) => r.fileName === fileName)
    if (row === undefined) throw new Error(`no row for ${fileName}`)
    return row.id
  }
  return { scan, sessions, ops, trashItem, trashed, idOf }
}

function items(outcome: Outcome<BulkOutcome>): BulkOutcome['items'] {
  if (!outcome.ok) throw new Error(`refused: ${outcome.error.key}`)
  return outcome.value.items
}

async function listed(scan: ReplaysScanService): Promise<string[]> {
  return (await scan.read()).map((r) => [...r.folder, r.fileName].join('/')).sort()
}

describe('demo delete', () => {
  it('delete trashes each demo and its sidecar', async () => {
    const { ops, scan, trashed, idOf } = await setup({
      'a.dm2': 'demo a',
      'a.dm2.json': '{"notes":"a"}',
      'b.dm2': 'demo b',
      'keep.dm2': 'keep',
    })
    const result = items(await ops.delete([await idOf('a.dm2'), await idOf('b.dm2')]))

    expect(result.map((i) => i.status)).toEqual(['done', 'done'])
    expect(trashed.sort()).toEqual(
      [join(dir, 'a.dm2'), join(dir, 'a.dm2.json'), join(dir, 'b.dm2')].sort(),
    )
    expect((await readdir(dir)).sort()).toEqual(['keep.dm2', 'sub'])
    const inTrash = await readdir(trashDir)
    expect(inTrash).toHaveLength(3)
    const sidecarCopy = inTrash.find((n) => n.endsWith('a.dm2.json'))
    expect(await readFile(join(trashDir, sidecarCopy ?? ''), 'utf8')).toBe('{"notes":"a"}')
    expect(await listed(scan)).toEqual(['keep.dm2'])
  })

  it('a trash failure is reported and nothing is removed permanently', async () => {
    const unlinked: string[] = []
    const fs = failingFs({ unlink: (p) => void unlinked.push(p) })
    const { ops, scan, idOf } = await setup(
      { 'a.dm2': 'demo a', 'a.dm2.json': 'notes' },
      { fs, trash: async () => Promise.reject(new Error('Failed to move item to trash')) },
    )
    const result = items(await ops.delete([await idOf('a.dm2')]))

    expect(result).toEqual([
      expect.objectContaining({ status: 'failed', reasonKey: 'replays.bulk.reason.trashFailed' }),
    ])
    expect(await readFile(join(dir, 'a.dm2'), 'utf8')).toBe('demo a')
    expect(await readFile(join(dir, 'a.dm2.json'), 'utf8')).toBe('notes')
    expect(unlinked).toEqual([])
    expect(await listed(scan)).toEqual(['a.dm2'])
  })
})

describe('demo move', () => {
  it('a name clash in the target is reported and never overwritten', async () => {
    const { ops, idOf, scan } = await setup({
      'a.dm2': 'mine',
      'sub/a.dm2': 'theirs',
      'b.dm2': 'mine b',
      'sub/b.dm2.json': 'their notes',
      'c.dm2': 'mine c',
    })
    const ids = [await idOf('b.dm2'), await idOf('c.dm2')]
    const aId = (await scan.read()).find((r) => r.fileName === 'a.dm2' && r.folder.length === 0)?.id
    const result = items(await ops.move([aId ?? '', ...ids], sub))

    expect(result.map((i) => [i.status, i.reasonKey])).toEqual([
      ['failed', 'replays.bulk.reason.exists'],
      ['failed', 'replays.bulk.reason.sidecarExists'],
      ['done', null],
    ])
    expect(await readFile(join(dir, 'a.dm2'), 'utf8')).toBe('mine')
    expect(await readFile(join(sub, 'a.dm2'), 'utf8')).toBe('theirs')
    expect(await readFile(join(dir, 'b.dm2'), 'utf8')).toBe('mine b')
    expect(await readFile(join(sub, 'b.dm2.json'), 'utf8')).toBe('their notes')
    expect(await readFile(join(sub, 'c.dm2'), 'utf8')).toBe('mine c')
  })

  it('a clash that appears after the check is still never overwritten', async () => {
    // The target file shows up between the existence check and the move: stat says it is free.
    const fs = failingFs({
      stat: (p) => {
        if (p === join(sub, 'a.dm2')) throw errno('ENOENT')
      },
    })
    const { ops, idOf } = await setup({ 'a.dm2': 'mine', 'sub/x.dm2': 'x' }, { fs })
    const id = await idOf('a.dm2')
    await writeFile(join(sub, 'a.dm2'), 'theirs')
    const result = items(await ops.move([id], sub))

    expect(result[0]).toMatchObject({ status: 'failed', reasonKey: 'replays.bulk.reason.exists' })
    expect(await readFile(join(sub, 'a.dm2'), 'utf8')).toBe('theirs')
    expect(await readFile(join(dir, 'a.dm2'), 'utf8')).toBe('mine')
  })

  it('a sidecar failure moves the demo back', async () => {
    const fs = failingFs({
      link: (from) => {
        if (from.endsWith('.json')) throw errno('EACCES')
      },
    })
    const { ops, idOf, scan } = await setup({ 'a.dm2': 'demo', 'a.dm2.json': 'notes' }, { fs })
    const result = items(await ops.move([await idOf('a.dm2')], sub))

    expect(result[0].status).toBe('failed')
    expect(await readFile(join(dir, 'a.dm2'), 'utf8')).toBe('demo')
    expect(await readFile(join(dir, 'a.dm2.json'), 'utf8')).toBe('notes')
    expect(await readdir(sub)).toEqual([])
    expect(await listed(scan)).toEqual(['a.dm2'])
  })

  it('a failed undo names where the demo and its sidecar now are', async () => {
    const fs = failingFs({
      link: (from, to) => {
        if (from.endsWith('.json') || to === join(dir, 'a.dm2')) throw errno('EACCES')
      },
    })
    const { ops, idOf, scan } = await setup({ 'a.dm2': 'demo', 'a.dm2.json': 'notes' }, { fs })
    const result = items(await ops.move([await idOf('a.dm2')], sub))

    expect(result[0]).toMatchObject({
      status: 'failed',
      reasonKey: 'replays.bulk.reason.rollbackFailed',
      params: { demo: join(sub, 'a.dm2'), sidecar: join(dir, 'a.dm2.json') },
    })
    expect(await readFile(join(sub, 'a.dm2'), 'utf8')).toBe('demo')
    expect(await readFile(join(dir, 'a.dm2.json'), 'utf8')).toBe('notes')
    expect(await listed(scan)).toEqual(['sub/a.dm2'])
  })

  it('a link refused with EOPNOTSUPP falls back to the copy and still never overwrites', async () => {
    const fs = failingFs({
      link: () => {
        throw errno('EOPNOTSUPP')
      },
    })
    const { ops, idOf } = await setup(
      { 'a.dm2': 'demo', 'b.dm2': 'new', 'sub/b.dm2': 'old' },
      { fs },
    )
    const result = items(await ops.move([await idOf('a.dm2'), await idOf('b.dm2')], sub))

    expect(result[0].status).toBe('done')
    expect(result[1].status).not.toBe('done')
    expect(await readFile(join(sub, 'a.dm2'), 'utf8')).toBe('demo')
    expect(await readFile(join(sub, 'b.dm2'), 'utf8')).toBe('old')
    expect(await readFile(join(dir, 'b.dm2'), 'utf8')).toBe('new')
  })

  it('a cross-device move keeps the modification time', async () => {
    const fs = failingFs({
      link: () => {
        throw errno('EXDEV')
      },
    })
    const { ops, idOf, scan } = await setup({ 'a.dm2': 'demo', 'a.dm2.json': 'notes' }, { fs })
    const old = new Date('2020-03-04T05:06:07.000Z')
    await utimes(join(dir, 'a.dm2'), old, old)
    const result = items(await ops.move([await idOf('a.dm2')], sub))

    expect(result[0].status).toBe('done')
    expect((await stat(join(sub, 'a.dm2'))).mtime.getTime()).toBe(old.getTime())
    expect(await readFile(join(sub, 'a.dm2'), 'utf8')).toBe('demo')
    expect(await readFile(join(sub, 'a.dm2.json'), 'utf8')).toBe('notes')
    expect(await readdir(dir)).toEqual(['sub'])
    expect(await listed(scan)).toEqual(['sub/a.dm2'])
  })

  it('a demo already in the target folder is skipped', async () => {
    const { ops, idOf } = await setup({ 'sub/a.dm2': 'demo' })
    const result = items(await ops.move([await idOf('a.dm2')], sub))

    expect(result[0]).toMatchObject({
      status: 'skipped',
      reasonKey: 'replays.bulk.reason.alreadyThere',
    })
    expect(await readFile(join(sub, 'a.dm2'), 'utf8')).toBe('demo')
  })
})

describe('demo delete and move together', () => {
  it('a busy file is reported as in use and the rest proceed', async () => {
    const fs = failingFs({
      unlink: (p) => {
        if (p === join(dir, 'b.dm2')) throw errno('EBUSY')
      },
    })
    const { ops, idOf, scan } = await setup(
      { 'a.dm2': 'a', 'b.dm2': 'b', 'c.dm2': 'c' },
      {
        fs,
        trash: async (p) => {
          if (p === join(dir, 'b.dm2')) throw errno('EBUSY')
          await rm(p)
        },
      },
    )
    const [a, b, c] = [await idOf('a.dm2'), await idOf('b.dm2'), await idOf('c.dm2')]

    const deleted = items(await ops.delete([a, b]))
    expect(deleted.map((i) => [i.status, i.reasonKey])).toEqual([
      ['done', null],
      ['failed', 'replays.bulk.reason.inUse'],
    ])

    const moved = items(await ops.move([b, c], sub))
    expect(moved.map((i) => [i.status, i.reasonKey])).toEqual([
      ['failed', 'replays.bulk.reason.inUse'],
      ['done', null],
    ])
    expect((await readdir(dir)).sort()).toEqual(['b.dm2', 'sub'])
    expect(await readdir(sub)).toEqual(['c.dm2'])
    expect(await listed(scan)).toEqual(['b.dm2', 'sub/c.dm2'])
  })

  it('zip entries are skipped for delete and move', async () => {
    const { ops, trashItem, idOf, scan } = await setup({ 'pack.zip': 'zip bytes', 'a.dm2': 'a' })
    const zipped: ReplaysScanService = {
      ...scan,
      resolveFile: (id) =>
        id === 'zip-entry'
          ? {
              absolutePath: join(dir, 'pack.zip'),
              archiveEntry: { archivePath: join(dir, 'pack.zip'), entryPath: 'inside.dm2' },
            }
          : scan.resolveFile(id),
    }
    const zipOps = createDemoFileOps({
      scan: zipped,
      sessions: createPlaybackSessions(),
      os: { trashItem },
    })

    for (const result of [
      items(await zipOps.delete(['zip-entry'])),
      items(await zipOps.move(['zip-entry'], sub)),
    ]) {
      expect(result).toEqual([
        { demoId: 'zip-entry', status: 'skipped', reasonKey: 'replays.bulk.reason.archiveEntry' },
      ])
    }
    expect(trashItem).not.toHaveBeenCalled()
    expect(await readFile(join(dir, 'pack.zip'), 'utf8')).toBe('zip bytes')
    expect(await readdir(sub)).toEqual([])
    expect(items(await ops.delete([await idOf('a.dm2')]))[0].status).toBe('done')
  })

  it('a playing demo is skipped for delete and move', async () => {
    const { ops, sessions, trashItem, idOf } = await setup({ 'a.dm2': 'a', 'b.dm2': 'b' })
    const playing = await idOf('a.dm2')
    sessions.begin(playing)

    const deleted = items(await ops.delete([playing]))
    const moved = items(await ops.move([playing, await idOf('b.dm2')], sub))

    expect(deleted).toEqual([
      { demoId: playing, status: 'skipped', reasonKey: 'replays.bulk.reason.playing' },
    ])
    expect(moved.map((i) => [i.status, i.reasonKey])).toEqual([
      ['skipped', 'replays.bulk.reason.playing'],
      ['done', null],
    ])
    expect(trashItem).not.toHaveBeenCalled()
    expect(await readFile(join(dir, 'a.dm2'), 'utf8')).toBe('a')
    expect(await readdir(sub)).toEqual(['b.dm2'])
  })

  it('a running scan refuses the whole call', async () => {
    const { scan, trashItem, idOf } = await setup({ 'a.dm2': 'a' })
    const scanning = createDemoFileOps({
      scan: { ...scan, isScanning: () => true },
      sessions: createPlaybackSessions(),
      os: { trashItem },
    })
    const id = await idOf('a.dm2')

    for (const outcome of [await scanning.delete([id]), await scanning.move([id], sub)]) {
      expect(outcome).toEqual({ ok: false, error: { key: 'replays.bulk.error.scanning' } })
    }
    expect(trashItem).not.toHaveBeenCalled()
    expect(await readFile(join(dir, 'a.dm2'), 'utf8')).toBe('a')
  })

  it('an unknown id is reported as failed', async () => {
    const { ops } = await setup({ 'a.dm2': 'a' })
    expect(items(await ops.delete(['nope']))).toEqual([
      { demoId: 'nope', status: 'failed', reasonKey: 'replays.bulk.reason.unknownDemo' },
    ])
  })
})
