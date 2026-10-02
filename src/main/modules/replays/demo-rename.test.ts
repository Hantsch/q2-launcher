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
import { serializeSidecar, type SidecarFields } from '@shared/replays/sidecar'
import type { Outcome } from '@shared/types/common'
import { createDemoRename, type DemoRenameFs } from './demo-rename'
import { demoIdForPath, discoverDemos } from './discovery'
import { ReplaysIndexCache } from './index-cache'
import { createPlaybackSessions, type PlaybackSessions } from './playback-sessions'
import {
  createReplaysScanService,
  nameMatcherFor,
  type DemoHeaderFacts,
  type ReplaysScanService,
} from './scan-service'
import { createSidecarStore } from './sidecar-store'

/**
 * Story 157: demo rename over real files - a temp demo folder scanned by the real scan service (as
 * an extra folder), the real sidecar store, and an injected `fs` only where one specific call must
 * fail (fault injection); everything else runs against the real filesystem.
 */

/** A readable header with a game dir and map, but no players - so `sides` can only come from the
 * name, and `map` always from the header. */
const FACTS: DemoHeaderFacts = {
  map: 'q2dm1',
  unparsableReason: null,
  readable: true,
  unreadable: null,
  gameDir: 'baseq2',
  pov: null,
  players: [],
  durationMs: null,
}
const HOUR_AGO_S = (Date.now() - 60 * 60 * 1000) / 1000
const AUTORECORD = '{year}-{month}-{day}-{hour}{min}-{map}.dm2'
const PLAYERS = '{p1}_vs_{p2}.dm2'

let root: string
let dir: string

beforeEach(async () => {
  // Canonical: scan ids hash the realpath, and a Windows runner's tmpdir() is an 8.3 short path.
  root = await realpath(await mkdtemp(join(tmpdir(), 'q2-launcher-replays-rename-')))
  dir = join(root, 'demos')
  await mkdir(dir, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const realFs: DemoRenameFs = {
  stat: (p) => stat(p),
  rename: (a, b) => rename(a, b),
  readFile: (p) => readFile(p),
  writeFile: (p, d) => writeFile(p, d),
  rm: (p, o) => rm(p, o),
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

interface Setup {
  scan: ReplaysScanService
  sessions: PlaybackSessions
  idOf: (fileName: string) => Promise<string>
  rename: (id: string, name: string) => ReturnType<ReturnType<typeof createDemoRename>['rename']>
}

/** Writes `files` (name -> content) into the demo folder, runs one real scan over it and builds
 * the rename service. `scanOverride` wraps the real scan service for the guard tests. */
async function setup(
  files: Record<string, string>,
  opts: {
    templates?: string[]
    fs?: Partial<DemoRenameFs>
    scanOverride?: (real: ReplaysScanService) => Partial<ReplaysScanService>
  } = {},
): Promise<Setup> {
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content)
    await utimes(join(dir, name), HOUR_AGO_S, HOUR_AGO_S)
  }
  const nameMatcher = () => nameMatcherFor(opts.templates ?? [], 'fp-1')
  const scan = createReplaysScanService({
    emit: () => {},
    cache: new ReplaysIndexCache({ filePath: join(root, 'replays-index.json') }),
    discover: async () =>
      discoverDemos([], [{ id: 'extra-0', path: dir, addedAt: '2026-01-01T00:00:00.000Z' }], {
        platform: process.platform,
        homeDir: root,
        zipDeps: { extractorPath: '', extractorExists: false },
      }),
    parse: async () => FACTS,
    nameMatcher,
    isGameRunning: () => false,
  })
  expect(scan.start()).toEqual({ started: true })
  await vi.waitFor(() => expect(scan.isScanning()).toBe(false), { timeout: 5000 })

  const sidecars = createSidecarStore({
    resolveDemo: (id) => {
      const file = scan.resolveFile(id)
      if (!file) return undefined
      return file.archiveEntry
        ? { kind: 'archive-entry' }
        : { kind: 'file', absolutePath: file.absolutePath }
    },
  })
  const sessions = createPlaybackSessions()
  const service = createDemoRename({
    scan: { ...scan, ...opts.scanOverride?.(scan) },
    sidecars,
    sessions,
    nameMatcher,
    fs: { ...realFs, ...opts.fs },
  })
  const idOf = async (fileName: string): Promise<string> => {
    const row = (await scan.read()).find((r) => r.fileName === fileName)
    if (!row) throw new Error(`no row for ${fileName}`)
    return row.id
  }
  return { scan, sessions, idOf, rename: (id, name) => service.rename(id, name) }
}

const sidecarText = (fields: SidecarFields): string => serializeSidecar(fields)
const listDir = async (): Promise<string[]> => (await readdir(dir)).sort()
const readJson = async (name: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(dir, name), 'utf8')) as Record<string, unknown>

function errorKey(outcome: Outcome<unknown>): string | undefined {
  return outcome.ok ? undefined : outcome.error.key
}

describe('demo rename (story 157)', () => {
  it('renames a demo and its sidecar', async () => {
    const t = await setup({
      'Final.dm2': 'demo',
      'Final.dm2.json': sidecarText({ name: 'The final' }),
    })
    const id = await t.idOf('Final.dm2')

    const outcome = await t.rename(id, 'Grand Final')

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.demo.fileName).toBe('Grand Final.dm2')
    expect(await listDir()).toEqual(['Grand Final.dm2', 'Grand Final.dm2.json'])
    expect((await readJson('Grand Final.dm2.json')).name).toBe('The final')
    // The index was re-keyed in place: the old id is gone, the new one resolves to the new file.
    expect(t.scan.resolveFile(id)).toBeUndefined()
    expect(basename(t.scan.resolveFile(outcome.value.demo.id)!.absolutePath)).toBe(
      'Grand Final.dm2',
    )
  })

  it('renames a demo without a sidecar and creates none', async () => {
    const t = await setup({ 'Final.dm2': 'demo' })

    const outcome = await t.rename(await t.idOf('Final.dm2'), 'Other')

    expect(outcome.ok).toBe(true)
    expect(await listDir()).toEqual(['Other.dm2'])
  })

  it('a failed sidecar rename restores both names and the original sidecar', async () => {
    const original = sidecarText({ name: 'Clan night', favourite: true })
    const t = await setup(
      { '2026-03-14-2130-q2dm1.dm2': 'demo', '2026-03-14-2130-q2dm1.dm2.json': original },
      {
        templates: [AUTORECORD],
        fs: {
          rename: async (a, b) => {
            if (a.endsWith('.json')) throw errno('EPERM')
            await rename(a, b)
          },
        },
      },
    )

    const outcome = await t.rename(await t.idOf('2026-03-14-2130-q2dm1.dm2'), 'clan night')

    expect(errorKey(outcome)).toBe('replays.rename.error.notWritable')
    expect(await listDir()).toEqual(['2026-03-14-2130-q2dm1.dm2', '2026-03-14-2130-q2dm1.dm2.json'])
    // Step 1 had merged the name's date into the sidecar; the undo put the original bytes back.
    expect(await readFile(join(dir, '2026-03-14-2130-q2dm1.dm2.json'), 'utf8')).toBe(original)
  })

  it('a failed undo reports rollbackFailed', async () => {
    let demoRenames = 0
    const t = await setup(
      { 'Final.dm2': 'demo', 'Final.dm2.json': sidecarText({ name: 'The final' }) },
      {
        fs: {
          rename: async (a, b) => {
            if (a.endsWith('.json')) throw errno('EBUSY')
            demoRenames += 1
            // The forward rename succeeds; renaming the demo back (the undo) fails too.
            if (demoRenames > 1) throw errno('EBUSY')
            await rename(a, b)
          },
        },
      },
    )

    const outcome = await t.rename(await t.idOf('Final.dm2'), 'Grand Final')

    expect(errorKey(outcome)).toBe('replays.rename.error.rollbackFailed')
    expect(outcome.ok ? undefined : outcome.error.params).toEqual({
      demo: 'Grand Final.dm2',
      sidecar: 'Final.dm2.json',
    })
  })

  it('a failed sidecar rename removes the sidecar step 1 created when there was none before', async () => {
    const t = await setup(
      { 'alice_vs_bob.dm2': 'demo' },
      {
        templates: [PLAYERS],
        fs: {
          rename: async (a, b) => {
            if (a.endsWith('.json')) throw errno('EPERM')
            await rename(a, b)
          },
        },
      },
    )

    const outcome = await t.rename(await t.idOf('alice_vs_bob.dm2'), 'grudge match')

    expect(errorKey(outcome)).toBe('replays.rename.error.notWritable')
    // The demo is back, and the freshly created `alice_vs_bob.dm2.json` is gone - left behind at
    // neither the old path nor the new one.
    expect(await listDir()).toEqual(['alice_vs_bob.dm2'])
  })

  describe('a failed demo rename undoes the preserved-facts sidecar write', () => {
    const failDemoRename: Partial<DemoRenameFs> = {
      rename: async (a, b) => {
        if (!a.endsWith('.json')) throw errno('EBUSY')
        await rename(a, b)
      },
    }

    it('removes the sidecar step 1 created when there was none before', async () => {
      const t = await setup(
        { 'alice_vs_bob.dm2': 'demo' },
        { templates: [PLAYERS], fs: failDemoRename },
      )

      const outcome = await t.rename(await t.idOf('alice_vs_bob.dm2'), 'grudge match')

      expect(errorKey(outcome)).toBe('replays.rename.error.renameFailed')
      expect(outcome.ok ? undefined : outcome.error.params).toEqual({ code: 'EBUSY' })
      expect(await listDir()).toEqual(['alice_vs_bob.dm2'])
    })

    it('restores the original sidecar bytes when one existed', async () => {
      const original = sidecarText({ name: 'Clan night', favourite: true })
      const t = await setup(
        { '2026-03-14-2130-q2dm1.dm2': 'demo', '2026-03-14-2130-q2dm1.dm2.json': original },
        { templates: [AUTORECORD], fs: failDemoRename },
      )

      const outcome = await t.rename(await t.idOf('2026-03-14-2130-q2dm1.dm2'), 'clan night')

      expect(errorKey(outcome)).toBe('replays.rename.error.renameFailed')
      expect(await listDir()).toEqual([
        '2026-03-14-2130-q2dm1.dm2',
        '2026-03-14-2130-q2dm1.dm2.json',
      ])
      expect(await readFile(join(dir, '2026-03-14-2130-q2dm1.dm2.json'), 'utf8')).toBe(original)
    })
  })

  it('a transient error snapshotting an existing sidecar aborts before anything is written', async () => {
    const original = sidecarText({ name: 'Clan night', favourite: true })
    const t = await setup(
      { '2026-03-14-2130-q2dm1.dm2': 'demo', '2026-03-14-2130-q2dm1.dm2.json': original },
      {
        templates: [AUTORECORD],
        fs: {
          readFile: async (p) => {
            if (p.endsWith('.json')) throw errno('EBUSY')
            return readFile(p)
          },
        },
      },
    )

    const outcome = await t.rename(await t.idOf('2026-03-14-2130-q2dm1.dm2'), 'clan night')

    expect(errorKey(outcome)).toBe('replays.rename.error.renameFailed')
    expect(outcome.ok ? undefined : outcome.error.params).toEqual({ code: 'EBUSY' })
    expect(await listDir()).toEqual(['2026-03-14-2130-q2dm1.dm2', '2026-03-14-2130-q2dm1.dm2.json'])
    expect(await readFile(join(dir, '2026-03-14-2130-q2dm1.dm2.json'), 'utf8')).toBe(original)
  })

  it('a scan swap before the index update still answers with the renamed row', async () => {
    const t = await setup(
      { 'Final.dm2': 'demo' },
      { scanOverride: () => ({ applyRename: async () => undefined }) },
    )

    const outcome = await t.rename(await t.idOf('Final.dm2'), 'Other')

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.demo.fileName).toBe('Other.dm2')
    expect(outcome.value.demo.id).toBe(demoIdForPath(join(dir, 'Other.dm2')))
    expect(await listDir()).toEqual(['Other.dm2'])
  })

  describe('guards', () => {
    it('an unknown id is refused', async () => {
      const t = await setup({ 'Final.dm2': 'demo' })
      expect(errorKey(await t.rename('nope', 'Other'))).toBe('replays.rename.error.unknownDemo')
    })

    it('an archive entry is refused', async () => {
      const t = await setup(
        { 'Final.dm2': 'demo' },
        {
          scanOverride: (real) => ({
            resolveFile: (id) => {
              const file = real.resolveFile(id)
              return (
                file && { ...file, archiveEntry: { archivePath: 'x.zip', entryPath: 'Final.dm2' } }
              )
            },
          }),
        },
      )
      expect(errorKey(await t.rename(await t.idOf('Final.dm2'), 'Other'))).toBe(
        'replays.rename.error.archiveEntry',
      )
      expect(await listDir()).toEqual(['Final.dm2'])
    })

    it('a demo that is playing is refused', async () => {
      const t = await setup({ 'Final.dm2': 'demo' })
      const id = await t.idOf('Final.dm2')
      t.sessions.begin(id)
      expect(errorKey(await t.rename(id, 'Other'))).toBe('replays.rename.error.playing')
      expect(await listDir()).toEqual(['Final.dm2'])
    })

    it('a rename while a scan runs is refused', async () => {
      const t = await setup(
        { 'Final.dm2': 'demo' },
        { scanOverride: () => ({ isScanning: () => true }) },
      )
      expect(errorKey(await t.rename(await t.idOf('Final.dm2'), 'Other'))).toBe(
        'replays.rename.error.scanning',
      )
      expect(await listDir()).toEqual(['Final.dm2'])
    })

    it('main rejects an invalid name even without the dialog', async () => {
      const t = await setup({ 'Final.dm2': 'demo' })
      expect(errorKey(await t.rename(await t.idOf('Final.dm2'), '../elsewhere/x'))).toBe(
        'replays.rename.error.separator',
      )
      expect(await listDir()).toEqual(['Final.dm2'])
    })

    it('an existing target name is refused', async () => {
      const t = await setup({ 'A.dm2': 'demo a', 'B.dm2': 'demo b' })
      const outcome = await t.rename(await t.idOf('A.dm2'), 'B')
      expect(errorKey(outcome)).toBe('replays.rename.error.exists')
      expect(outcome.ok ? undefined : outcome.error.params).toEqual({ name: 'B.dm2' })
    })

    it('an existing target sidecar is refused even when the demo has none of its own', async () => {
      const t = await setup({ 'A.dm2': 'demo a', 'B.dm2.json': sidecarText({ name: 'orphan' }) })
      const outcome = await t.rename(await t.idOf('A.dm2'), 'B')
      expect(errorKey(outcome)).toBe('replays.rename.error.sidecarExists')
      expect(outcome.ok ? undefined : outcome.error.params).toEqual({ name: 'B.dm2.json' })
      expect(await listDir()).toEqual(['A.dm2', 'B.dm2.json'])
    })
  })

  it('target file byte-identical after an exists rejection', async () => {
    const t = await setup({ 'A.dm2': 'demo a', 'B.dm2': 'demo b bytes' })
    const before = await readFile(join(dir, 'B.dm2'))

    await t.rename(await t.idOf('A.dm2'), 'B')

    expect((await readFile(join(dir, 'B.dm2'))).equals(before)).toBe(true)
    expect(await listDir()).toEqual(['A.dm2', 'B.dm2'])
  })

  it('an autorecord-named demo renamed to a plain name keeps its date in the sidecar', async () => {
    const t = await setup(
      {
        '2026-03-14-2130-q2dm1.dm2': 'demo',
        '2026-03-14-2130-q2dm1.dm2.json': sidecarText({ name: 'Clan night', favourite: true }),
      },
      { templates: [AUTORECORD] },
    )

    const outcome = await t.rename(await t.idOf('2026-03-14-2130-q2dm1.dm2'), 'clan night')

    expect(outcome.ok).toBe(true)
    expect(await listDir()).toEqual(['clan night.dm2', 'clan night.dm2.json'])
    const sidecar = await readJson('clan night.dm2.json')
    expect(Date.parse(sidecar.date as string)).toBe(new Date(2026, 2, 14, 21, 30).getTime())
    expect(sidecar.name).toBe('Clan night')
    expect(sidecar.favourite).toBe(true)
    // The header supplied the map, so the name's map was never the effective one - not preserved.
    expect(sidecar.map).toBeUndefined()
  })

  it('a players-template demo renamed away keeps its players as sides', async () => {
    const t = await setup({ 'alice_vs_bob.dm2': 'demo' }, { templates: [PLAYERS] })

    const outcome = await t.rename(await t.idOf('alice_vs_bob.dm2'), 'grudge match')

    expect(outcome.ok).toBe(true)
    expect(await listDir()).toEqual(['grudge match.dm2', 'grudge match.dm2.json'])
    expect((await readJson('grudge match.dm2.json')).sides).toEqual([{ players: ['alice', 'bob'] }])
  })

  it('a broken sidecar with facts to preserve refuses the rename and touches nothing', async () => {
    const t = await setup(
      { '2026-03-14-2130-q2dm1.dm2': 'demo', '2026-03-14-2130-q2dm1.dm2.json': '{ not json' },
      { templates: [AUTORECORD] },
    )

    const outcome = await t.rename(await t.idOf('2026-03-14-2130-q2dm1.dm2'), 'clan night')

    expect(errorKey(outcome)).toBe('replays.rename.error.sidecarBroken')
    expect(await listDir()).toEqual(['2026-03-14-2130-q2dm1.dm2', '2026-03-14-2130-q2dm1.dm2.json'])
    expect(await readFile(join(dir, '2026-03-14-2130-q2dm1.dm2.json'), 'utf8')).toBe('{ not json')
  })

  it('a case-only rename is not a collision', async () => {
    // On a case-insensitive filesystem (Windows/macOS defaults) `final.dm2` stats as the very same
    // file as `Final.dm2` - this proves the collision check is skipped for it. On a case-sensitive
    // one it is an ordinary rename to a free name, so the test holds on both.
    const t = await setup({
      'Final.dm2': 'demo',
      'Final.dm2.json': sidecarText({ name: 'The final' }),
    })

    const outcome = await t.rename(await t.idOf('Final.dm2'), 'final')

    expect(outcome.ok).toBe(true)
    expect(await listDir()).toEqual(['final.dm2', 'final.dm2.json'])
  })
})
