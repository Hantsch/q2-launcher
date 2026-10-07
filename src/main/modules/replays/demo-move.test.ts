import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FolderRef } from '@shared/replays/demo-folders'
import type { Outcome } from '@shared/types/common'
import { canLinkDirectories, rescan, scanExtraFolders } from '../../../test-support/replays-scan'
import { createDemoMove } from './demo-move'
import type { RelocateFs } from './demo-relocate'
import { createPlaybackSessions } from './playback-sessions'
import type { ReplaysScanService } from './scan-service'

/** Demo move over real files: a temp demo folder with subfolders, scanned by the real scan service
 * as an extra folder; an injected `fs` only where one specific call must fail. */

let root: string
let dir: string

beforeEach(async () => {
  // Canonical: scan ids hash the realpath, and a Windows runner's tmpdir() is an 8.3 short path.
  root = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-replays-move-')))
  dir = join(root, 'demos')
  await mkdir(dir, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const realFs: RelocateFs = {
  stat: async (p) => (await import('node:fs/promises')).stat(p),
  rename: (a, b) => rename(a, b),
}

async function setup(
  files: Record<string, string>,
  opts: {
    fs?: Partial<RelocateFs>
    scanning?: boolean
    extraDirs?: string[]
    scanDir?: string
  } = {},
) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true })
    await writeFile(join(dir, name), content)
  }
  const scan = await scanExtraFolders(root, [opts.scanDir ?? dir, ...(opts.extraDirs ?? [])])
  const sessions = createPlaybackSessions()
  const scanForMove: ReplaysScanService = opts.scanning ? { ...scan, isScanning: () => true } : scan
  const service = createDemoMove({
    scan: scanForMove,
    sessions,
    fs: { ...realFs, ...opts.fs },
  })
  const idOf = async (fileName: string): Promise<string> => {
    const row = (await scan.read()).find((r) => r.fileName === fileName)
    if (!row) throw new Error(`no row for ${fileName}`)
    return row.id
  }
  const folder = async (...path: string[]): Promise<FolderRef> => {
    const sourceKey = (await scan.readFolders())[0].sourceKey
    return { sourceKey, path }
  }
  const folderOf = async (sourceDir: string, ...path: string[]): Promise<FolderRef> => {
    const sourceKey = (await scan.readFolders()).find((f) => f.source === sourceDir)?.sourceKey
    if (sourceKey === undefined) throw new Error(`no source for ${sourceDir}`)
    return { sourceKey, path }
  }
  return { scan, sessions, idOf, folder, folderOf, move: service.move }
}

const list = async (...path: string[]): Promise<string[]> =>
  (await readdir(join(dir, ...path))).sort()

function errorKey(outcome: Outcome<unknown>): string | undefined {
  return outcome.ok ? undefined : outcome.error.key
}

const canLink = await canLinkDirectories()

describe('demo move', () => {
  it('moves demo and sidecar', async () => {
    const t = await setup({ 'a.dm2': 'demo', 'a.dm2.json': '{"name":"A"}', 'duels/.keep': '' })
    const id = await t.idOf('a.dm2')

    const outcome = await t.move(id, await t.folder('duels'))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.demo.folder).toEqual(['duels'])
    expect(await list()).toEqual(['duels'])
    expect(await list('duels')).toEqual(['.keep', 'a.dm2', 'a.dm2.json'])
    expect((await t.scan.read()).map((r) => r.folder)).toEqual([['duels']])
    expect(t.scan.resolveFile(id)).toBeUndefined()
    expect(t.scan.resolveFile(outcome.value.demo.id)?.absolutePath).toBe(
      join(dir, 'duels', 'a.dm2'),
    )
  })

  it('moves a demo back to the source root', async () => {
    const t = await setup({ 'duels/a.dm2': 'demo' })
    const outcome = await t.move(await t.idOf('a.dm2'), await t.folder())

    expect(outcome.ok && outcome.value.demo.folder).toEqual([])
    expect(await list()).toEqual(['a.dm2', 'duels'])
  })

  it('a clash in the target is refused and overwrites nothing', async () => {
    const t = await setup({ 'a.dm2': 'mine', 'duels/a.dm2': 'theirs', 'duels/b.dm2': 'b' })
    const outcome = await t.move(await t.idOf('a.dm2'), await t.folder('duels'))

    expect(errorKey(outcome)).toBe('replays.move.error.exists')
    expect(await readFile(join(dir, 'a.dm2'), 'utf8')).toBe('mine')
    expect(await readFile(join(dir, 'duels', 'a.dm2'), 'utf8')).toBe('theirs')
  })

  it('a clashing sidecar in the target is refused', async () => {
    const t = await setup({ 'a.dm2': 'mine', 'duels/a.dm2.json': '{}' })
    const outcome = await t.move(await t.idOf('a.dm2'), await t.folder('duels'))

    expect(errorKey(outcome)).toBe('replays.move.error.sidecarExists')
    expect(await list()).toEqual(['a.dm2', 'duels'])
  })

  it('a sidecar failure rolls the demo back', async () => {
    const t = await setup(
      { 'a.dm2': 'demo', 'a.dm2.json': '{}', 'duels/.keep': '' },
      {
        fs: {
          rename: async (from, to) => {
            if (from.endsWith('.json')) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
            await rename(from, to)
          },
        },
      },
    )
    const outcome = await t.move(await t.idOf('a.dm2'), await t.folder('duels'))

    expect(errorKey(outcome)).toBe('replays.move.error.moveFailed')
    expect(await list()).toEqual(['a.dm2', 'a.dm2.json', 'duels'])
    expect(await list('duels')).toEqual(['.keep'])
    expect((await t.scan.read()).map((r) => r.folder)).toEqual([[]])
  })

  it('a playing demo is not moved', async () => {
    const t = await setup({ 'a.dm2': 'demo', 'duels/.keep': '' })
    const id = await t.idOf('a.dm2')
    t.sessions.begin(id)

    expect(errorKey(await t.move(id, await t.folder('duels')))).toBe('replays.move.error.playing')
    expect(await list()).toEqual(['a.dm2', 'duels'])
  })

  it('nothing is moved while a scan is running', async () => {
    const t = await setup({ 'a.dm2': 'demo', 'duels/.keep': '' }, { scanning: true })

    expect(errorKey(await t.move(await t.idOf('a.dm2'), await t.folder('duels')))).toBe(
      'replays.move.error.scanning',
    )
    expect(await list()).toEqual(['a.dm2', 'duels'])
  })

  it('a folder that does not exist is refused', async () => {
    const t = await setup({ 'a.dm2': 'demo' })

    expect(errorKey(await t.move(await t.idOf('a.dm2'), await t.folder('ghost')))).toBe(
      'replays.move.error.unknownFolder',
    )
    expect(await list()).toEqual(['a.dm2'])
  })

  it('an unknown demo id is refused', async () => {
    const t = await setup({ 'duels/.keep': '' })

    expect(errorKey(await t.move('nope', await t.folder('duels')))).toBe(
      'replays.move.error.unknownDemo',
    )
  })

  it('moving a demo into an empty folder of a root that has no other loose demo works', async () => {
    const other = join(root, 'other')
    await mkdir(join(other, 'empty'), { recursive: true })
    const t = await setup({ 'a.dm2': 'demo', 'a.dm2.json': '{}' }, { extraDirs: [other] })

    const outcome = await t.move(await t.idOf('a.dm2'), await t.folderOf(other, 'empty'))

    expect(outcome.ok && outcome.value.demo.folder).toEqual(['empty'])
    expect((await readdir(join(other, 'empty'))).sort()).toEqual(['a.dm2', 'a.dm2.json'])
    expect(await list()).toEqual([])
  })

  it.skipIf(!canLink)('a folder that links outside the source is refused', async () => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    const t = await setup({ 'a.dm2': 'demo' })
    await symlink(outside, join(dir, 'link'), 'junction')
    await rescan(t.scan)

    const outcome = await t.move(await t.idOf('a.dm2'), await t.folder('link'))

    expect(errorKey(outcome)).toBe('replays.move.error.outsideSource')
    expect(await readdir(outside)).toEqual([])
  })

  it.skipIf(!canLink)(
    'a source reached through a link gets the id a fresh scan assigns after a move',
    async () => {
      const via = join(root, 'via')
      await symlink(dir, via, 'junction')
      const t = await setup({ 'a.dm2': 'demo', 'duels/.keep': '' }, { scanDir: via })
      const id = await t.idOf('a.dm2')

      const outcome = await t.move(id, await t.folder('duels'))

      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      const movedId = outcome.value.demo.id
      await rescan(t.scan)
      expect((await t.scan.read()).find((r) => r.fileName === 'a.dm2')?.id).toBe(movedId)
    },
  )
})
