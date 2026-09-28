import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REPLAYS_EVENTS,
  discoveredDemoSchema,
  replaysScanProgressSchema,
  type DiscoveredDemo,
  type ReplaysExtraFolder,
  type ReplaysScanProgress,
} from '@shared/modules/replays'
import { SHIPPED_NAME_PATTERNS } from '@shared/replays/name-patterns'
import { canonicalizePath } from '../../lib/fs-utils'
import { discoverDemos } from './discovery'
import { REPLAYS_INDEX_CACHE_FILE, ReplaysIndexCache } from './index-cache'
import {
  createReplaysScanService,
  nameMatcherFor,
  readDemoFacts,
  type CreateReplaysScanServiceOptions,
  type DemoHeaderFacts,
  type ReplaysScanFile,
} from './scan-service'

/**
 * Story 144 D3: the scan service over real files - a temp userData dir for the D1 cache, temp demo
 * folders scanned through the real `discoverDemos` (as extra folders), and an injected `parse` so a
 * test can hold a scan mid-flight or make it throw.
 */

const FACTS: DemoHeaderFacts = { map: 'q2dm1', unparsableReason: null, readable: true, unreadable: null }
const HOUR_AGO_S = (Date.now() - 60 * 60 * 1000) / 1000

let root: string
let userData: string
let cacheFile: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'q2-launcher-replays-scan-'))
  userData = join(root, 'userData')
  cacheFile = join(userData, REPLAYS_INDEX_CACHE_FILE)
  await mkdir(userData, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

/** A demo folder with the given files, each backdated an hour unless `fresh`. */
async function demoFolder(name: string, files: string[], fresh: string[] = []): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  for (const file of files) {
    await writeFile(join(dir, file), `demo ${file}`)
    if (!fresh.includes(file)) await utimes(join(dir, file), HOUR_AGO_S, HOUR_AGO_S)
  }
  return dir
}

function extraFolders(dirs: string[]): ReplaysExtraFolder[] {
  return dirs.map((path, i) => ({ id: `extra-${i}`, path, addedAt: '2026-01-01T00:00:00.000Z' }))
}

interface Harness {
  service: ReturnType<typeof createReplaysScanService>
  progress: () => ReplaysScanProgress[]
  idleCount: () => number
  waitIdle: (count: number) => Promise<void>
}

function harness(
  dirs: string[],
  overrides: Partial<CreateReplaysScanServiceOptions> = {},
): Harness {
  const emitted: Array<{ type: string; payload: unknown }> = []
  const service = createReplaysScanService({
    emit: (type, payload) => emitted.push({ type, payload }),
    cache: new ReplaysIndexCache({ filePath: cacheFile }),
    discover: async () =>
      (
        await discoverDemos([], extraFolders(dirs), {
          platform: process.platform,
          homeDir: root,
          zipDeps: { extractorPath: '', extractorExists: false },
        })
      ).demos,
    parse: vi.fn(async () => FACTS),
    nameMatcher: () => ({ fingerprint: 'fp-1', match: () => null }),
    isGameRunning: () => false,
    ...overrides,
  })
  const progress = (): ReplaysScanProgress[] =>
    emitted
      .filter((e) => e.type === REPLAYS_EVENTS.scanProgress)
      .map((e) => e.payload as ReplaysScanProgress)
  const idleCount = (): number => progress().filter((p) => !p.running).length
  const waitIdle = (count: number): Promise<void> =>
    vi.waitFor(() => expect(idleCount()).toBe(count), { timeout: 5000 })
  return { service, progress, idleCount, waitIdle }
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('replays scan service (story 144 D3)', () => {
  it('a second scan.start while a scan runs does not start a parallel scan', async () => {
    const dir = await demoFolder('demos', ['a.dm2', 'b.dm2', 'c.dm2'])
    const gate = deferred()
    const parse = vi.fn(async (_file: ReplaysScanFile) => {
      await gate.promise
      return FACTS
    })
    const discover = vi.fn(async () =>
      (
        await discoverDemos([], extraFolders([dir]), {
          platform: process.platform,
          homeDir: root,
          zipDeps: { extractorPath: '', extractorExists: false },
        })
      ).demos,
    )
    const h = harness([dir], { parse, discover })

    expect(h.service.start()).toEqual({ started: true })
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1))
    expect((await h.service.overview()).scanning).toBe(true)

    expect(h.service.start()).toEqual({ started: false })

    gate.release()
    await h.waitIdle(1)

    expect(discover).toHaveBeenCalledTimes(1)
    expect(parse).toHaveBeenCalledTimes(3)
    const parsedIds = parse.mock.calls.map(([file]) => file.id)
    expect(new Set(parsedIds).size).toBe(3)
    expect(await h.service.overview()).toEqual({ scanning: false, demoCount: 3 })
  })

  it('scan progress is pushed as scanned / total per source while the scan runs', async () => {
    const dirA = await demoFolder('a', ['a1.dm2', 'a2.dm2'])
    const dirB = await demoFolder('b', ['b1.dm2'])
    const h = harness([dirA, dirB])

    h.service.start()
    // The first push goes out synchronously, before `start()` has even returned to the caller.
    expect(h.progress()).toHaveLength(1)
    await h.waitIdle(1)

    const pushes = h.progress()
    for (const push of pushes) expect(replaysScanProgressSchema.safeParse(push).success).toBe(true)

    const first = pushes[0]
    expect(first.running).toBe(true)
    expect(first.sources.every((s) => s.scanned === 0)).toBe(true)

    const firstWithSources = pushes.find((p) => p.sources.length > 0)!
    expect(firstWithSources.running).toBe(true)
    expect(firstWithSources.sources.map((s) => [s.scanned, s.total])).toEqual([
      [0, 2],
      [0, 1],
    ])

    const last = pushes[pushes.length - 1]
    expect(last.running).toBe(false)
    expect(last.sources.map((s) => [s.scanned, s.total])).toEqual([
      [2, 2],
      [1, 1],
    ])
    expect(pushes.slice(0, -1).every((p) => p.running)).toBe(true)

    const seen = new Map<string, number>()
    for (const push of pushes) {
      for (const source of push.sources) {
        expect(source.scanned).toBeGreaterThanOrEqual(seen.get(source.sourceKey) ?? 0)
        expect(source.scanned).toBeLessThanOrEqual(source.total)
        seen.set(source.sourceKey, source.scanned)
      }
    }
  })

  it('index.read serves cached rows before the scan finishes', async () => {
    const dir = await demoFolder('demos', ['live.dm2'])
    const cachedRow: DiscoveredDemo = {
      id: 'aaaaaaaaaaaaaaaa',
      fileName: 'cached.dm2',
      format: 'dm2',
      gzip: false,
      source: { kind: 'extraFolder', path: dir },
      archiveEntry: null,
      map: 'q2dm8',
      unparsableReason: null,
      readable: true,
      unreadable: null,
      fileTime: { birthtimeMs: 0, mtimeMs: 0 },
      nameFacts: null,
    }
    await new ReplaysIndexCache({ filePath: cacheFile }).write(
      new Map([[cachedRow.id, { size: 1, mtimeMs: 1, patternFingerprint: 'fp-1', parsed: cachedRow, name: null }]]),
    )

    const gate = deferred()
    const parse = vi.fn(async () => {
      await gate.promise
      return FACTS
    })
    const h = harness([dir], { parse })

    h.service.start()
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1))
    expect(await h.service.read()).toEqual([cachedRow])

    gate.release()
    await h.waitIdle(1)

    const rows = await h.service.read()
    expect(rows.map((r) => [r.fileName, r.map])).toEqual([['live.dm2', 'q2dm1']])
    for (const row of rows) expect(row).not.toHaveProperty('absolutePath')
  })

  it('deleting the cache file and scanning again produces the same list and loses no sidecar or setting', async () => {
    const dir = await demoFolder('demos', ['a.dm2', 'b.mvd2'])
    const sidecar = join(dir, 'a.dm2.json')
    await writeFile(sidecar, '{"note":"keep me"}')
    const sidecarBefore = { bytes: await readFile(sidecar), mtimeMs: (await stat(sidecar)).mtimeMs }
    const folderBefore = (await readdir(dir)).sort()

    const first = harness([dir])
    first.service.start()
    await first.waitIdle(1)
    const snapshotA = await first.service.read()
    expect(snapshotA).toHaveLength(2)
    expect(await readdir(userData)).toEqual([REPLAYS_INDEX_CACHE_FILE])

    await rm(cacheFile)

    const second = harness([dir])
    second.service.start()
    await second.waitIdle(1)
    const snapshotB = await second.service.read()

    expect(snapshotB).toEqual(snapshotA)
    expect(await readFile(sidecar)).toEqual(sidecarBefore.bytes)
    expect((await stat(sidecar)).mtimeMs).toBe(sidecarBefore.mtimeMs)
    expect((await readdir(dir)).sort()).toEqual(folderBefore)
    expect(await readdir(userData)).toEqual([REPLAYS_INDEX_CACHE_FILE])
  })

  it('a failed scan keeps the previous cache and snapshot', async () => {
    const dir = await demoFolder('demos', ['a.dm2', 'b.dm2'])
    let failing = false
    const parse = vi.fn(async () => {
      if (failing) throw new Error('parse exploded')
      return FACTS
    })
    const warn = vi.fn()
    const h = harness([dir], { parse, log: { warn } })

    h.service.start()
    await h.waitIdle(1)
    const snapshotA = await h.service.read()
    expect(snapshotA).toHaveLength(2)
    const cacheBefore = { bytes: await readFile(cacheFile), mtimeMs: (await stat(cacheFile)).mtimeMs }

    // A new file forces a parse, which now throws mid-scan.
    await writeFile(join(dir, 'c.dm2'), 'demo c')
    await utimes(join(dir, 'c.dm2'), HOUR_AGO_S, HOUR_AGO_S)
    failing = true

    expect(h.service.start()).toEqual({ started: true })
    await h.waitIdle(2)

    expect(warn).toHaveBeenCalled()
    expect(await h.service.read()).toEqual(snapshotA)
    expect(await readFile(cacheFile)).toEqual(cacheBefore.bytes)
    expect((await stat(cacheFile)).mtimeMs).toBe(cacheBefore.mtimeMs)
    expect(await h.service.overview()).toEqual({ scanning: false, demoCount: 2 })

    // The running flag was cleared: a new scan is accepted and, once parsing works, succeeds.
    failing = false
    expect(h.service.start()).toEqual({ started: true })
    await h.waitIdle(3)
    expect((await h.service.read()).map((r) => r.fileName)).toEqual(['a.dm2', 'b.dm2', 'c.dm2'])
  })

  it('a game running makes the scan skip a file still being written', async () => {
    const dir = await demoFolder('demos', ['old.dm2', 'fresh.dm2'], ['fresh.dm2'])
    const parse = vi.fn(async (_file: ReplaysScanFile) => FACTS)
    const h = harness([dir], { parse, isGameRunning: () => true })

    h.service.start()
    await h.waitIdle(1)

    const rows = await h.service.read()
    expect(rows.map((r) => r.fileName)).toEqual(['old.dm2'])

    const canonicalDir = await canonicalizePath(dir)
    const freshId = (
      await discoverDemos([], extraFolders([canonicalDir]), {
        platform: process.platform,
        homeDir: root,
        zipDeps: { extractorPath: '', extractorExists: false },
      })
    ).demos.find((d) => d.fileName === 'fresh.dm2')!.id
    expect(parse.mock.calls.map(([file]) => file.id)).not.toContain(freshId)
    expect(parse.mock.calls.map(([file]) => file.fileName)).toEqual(['old.dm2'])
  })
})

describe('unreadable demos stay in the index (story 145 D2)', () => {
  const GARBAGE_FILE = '2026-09-26-2130-q2dm1.dm2'
  const FIXTURE = join(process.cwd(), 'docs/fixtures/demos/test.dm2')

  /** 64 bytes that parse deterministically as `not-a-demo`: a block whose length (50) and payload
   * fit, whose first message's opcode (99) isn't `svc_serverdata` - same construction
   * `readability.test.ts` uses for the same reason. */
  function notADemoBytes(): Uint8Array {
    const bytes = new Uint8Array(64)
    bytes[0] = 50
    bytes[4] = 99
    for (let i = 5; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff
    return bytes
  }

  async function writeFixtures(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, GARBAGE_FILE), notADemoBytes())
    await writeFile(join(dir, 'empty.dm2'), new Uint8Array(0))
    const fixture = await readFile(FIXTURE)
    await writeFile(join(dir, 'broken.dm2'), fixture.subarray(0, 100))
    await writeFile(join(dir, 'good.dm2'), fixture)
  }

  /** A harness wired with the real header parser and the real shipped name-matching patterns -
   * the only two things story 145 D2 actually needs "for real", everything else (discovery,
   * cache) is already exercised by the harness above. */
  function realHarness(dir: string): Harness {
    return harness([dir], {
      parse: readDemoFacts,
      nameMatcher: () =>
        nameMatcherFor(
          SHIPPED_NAME_PATTERNS.map((p) => p.template),
          'fp-shipped',
        ),
    })
  }

  async function idFor(dir: string, fileName: string): Promise<string> {
    const canonicalDir = await canonicalizePath(dir)
    const demos = (
      await discoverDemos([], extraFolders([canonicalDir]), {
        platform: process.platform,
        homeDir: root,
        zipDeps: { extractorPath: '', extractorExists: false },
      })
    ).demos
    return demos.find((d) => d.fileName === fileName)!.id
  }

  it('an unparsable demo file is still an index entry, flagged unreadable', async () => {
    const dir = join(root, 'demos')
    await writeFixtures(dir)
    const h = realHarness(dir)

    h.service.start()
    await h.waitIdle(1)
    const rows = await h.service.read()

    expect(rows.map((r) => r.fileName).sort()).toEqual(
      [GARBAGE_FILE, 'empty.dm2', 'broken.dm2', 'good.dm2'].sort(),
    )

    const byName = new Map(rows.map((r) => [r.fileName, r]))
    expect(byName.get(GARBAGE_FILE)!.readable).toBe(false)
    expect(byName.get(GARBAGE_FILE)!.unreadable?.reason).toBe('not-a-demo')
    expect(byName.get('empty.dm2')!.readable).toBe(false)
    expect(byName.get('empty.dm2')!.unreadable?.reason).toBe('empty')
    expect(byName.get('broken.dm2')!.readable).toBe(false)
    expect(byName.get('broken.dm2')!.unreadable?.reason).toBe('truncated')
    expect(byName.get('good.dm2')!.readable).toBe(true)
    expect(byName.get('good.dm2')!.unreadable).toBeNull()
  })

  it('an unreadable entry carries its name facts and file time and no parsed fact', async () => {
    const dir = join(root, 'demos')
    await writeFixtures(dir)
    const h = realHarness(dir)

    h.service.start()
    await h.waitIdle(1)
    const rows = await h.service.read()
    const byName = new Map(rows.map((r) => [r.fileName, r]))

    const garbage = byName.get(GARBAGE_FILE)!
    expect(garbage.nameFacts).toEqual({
      date: { year: 2026, month: 9, day: 26, hour: 21, minute: 30 },
      map: 'q2dm1',
    })

    const broken = byName.get('broken.dm2')!
    const brokenStat = await stat(join(dir, 'broken.dm2'))
    expect(broken.fileTime).toEqual({ birthtimeMs: brokenStat.birthtimeMs, mtimeMs: brokenStat.mtimeMs })

    for (const fileName of [GARBAGE_FILE, 'empty.dm2', 'broken.dm2']) {
      const row = byName.get(fileName)!
      expect(row.map).toBeNull()
      expect(row.unreadable).toEqual({ reason: row.unreadable!.reason })
    }
  })

  it('an unreadable entry has the same id kind and fields as a readable one', async () => {
    const dir = join(root, 'demos')
    await writeFixtures(dir)
    const h = realHarness(dir)

    h.service.start()
    await h.waitIdle(1)
    const rows = await h.service.read()
    const byName = new Map(rows.map((r) => [r.fileName, r]))

    const garbage = byName.get(GARBAGE_FILE)!
    const good = byName.get('good.dm2')!

    expect(garbage.id).toMatch(/^[0-9a-f]{16}$/)
    expect(good.id).toMatch(/^[0-9a-f]{16}$/)
    expect(garbage.id).toBe(await idFor(dir, GARBAGE_FILE))
    expect(good.id).toBe(await idFor(dir, 'good.dm2'))

    expect(Object.keys(garbage).sort()).toEqual(Object.keys(good).sort())

    for (const row of rows) {
      expect(discoveredDemoSchema.safeParse(row).success).toBe(true)
    }
  })
})
