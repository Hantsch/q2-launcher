import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { engineKindSchema } from '@shared/schemas'
import { replaysDemoPlaySchema, type DiscoveredDemo } from '@shared/modules/replays'
import { ok, type Installation, type LaunchInput, type LaunchState } from '@shared/types'
import { canonicalizePath } from '../../lib/fs-utils'
import { buildLaunchArgs } from '../../services/launch-plan'
import { createDemoPlay, engineIoFromSession, launcherSweepDirs, type DemoPlayLaunch } from './demo-play'
import type { PlaybackControl } from './playback-control'
import type { StageAvailability } from './stage'
import { LAUNCHER_DIR_NAME } from './demo-staging'

/**
 * Story 159 D2: `demo.play` in main. Real temp folders on disk (containment is a realpath question,
 * so it is tested against a real filesystem), a fake launch service standing in for `LaunchService`.
 */

let tmp: string
let q2proRoot: string
let siblingRoot: string
let r1q2Root: string
let homeDir: string

function installation(overrides: Partial<Installation>): Installation {
  return {
    id: 'test',
    name: 'Test',
    rootPath: 'unset',
    engineKind: 'q2pro',
    executablePath: 'unset',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: ['baseq2', 'ctf'],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
    ...overrides,
  }
}

function demo(overrides: Partial<DiscoveredDemo> & Pick<DiscoveredDemo, 'id' | 'fileName'>): DiscoveredDemo {
  return {
    format: 'dm2',
    gzip: false,
    source: { kind: 'installation', installationId: 'q2pro-a', installationName: 'Q2PRO', gameDir: 'baseq2' },
    archiveEntry: null,
    map: 'q2dm1',
    unparsableReason: null,
    readable: true,
    unreadable: null,
    gameDir: null,
    pov: null,
    players: [],
    durationMs: null,
    fileTime: { birthtimeMs: 0, mtimeMs: 0 },
    nameFacts: null,
    ...overrides,
  }
}

function fakeLaunch(initiallyRunning = false) {
  const listeners = new Set<(state: LaunchState) => void>()
  const state = { running: initiallyRunning, exitBeforeResolve: false }
  const unsubscribe = vi.fn()
  const launch = {
    isRunning: () => state.running,
    start: vi.fn(async (input: LaunchInput) => {
      state.running = !state.exitBeforeResolve
      return ok<LaunchState>({ phase: state.running ? 'running' : 'exited', installationId: input.installationId })
    }),
    onStateChange: vi.fn((listener: (s: LaunchState) => void) => {
      listeners.add(listener)
      return () => {
        unsubscribe()
        listeners.delete(listener)
      }
    }),
  } satisfies DemoPlayLaunch
  const emit = (next: LaunchState): void => {
    state.running = next.phase === 'starting' || next.phase === 'running'
    for (const listener of [...listeners]) listener(next)
  }
  return { launch, state, emit, unsubscribe, listenerCount: () => listeners.size }
}

interface Setup {
  demos: DiscoveredDemo[]
  files: Record<string, { absolutePath: string; archiveEntry: DiscoveredDemo['archiveEntry'] }>
  active?: string
  running?: boolean
  /** Story 160: the staging context's platform - `linux` gives a Q2PRO installation a write dir. */
  contextPlatform?: NodeJS.Platform
  /** Engine of the active installation (`q2pro-a`); defaults to q2pro. */
  activeEngine?: Installation['engineKind']
  /** Story 164 D4: the platform `demo.play` runs on, and an optional playback control. */
  platform?: string
  playback?: PlaybackControl
  /** Story 170 D2 */
  stageAvail?: StageAvailability
  geometry?: string | null
  /** Story 170 D3 */
  cvarRestore?: { snapshot: (configPath: string) => Promise<void>; restore: () => Promise<void> }
  /** Story 171 D2 */
  onStageSession?: (start: { geometry: string; rect: { x: number; y: number; width: number; height: number } }) => () => void
}

function harness({ demos, files, active = 'q2pro-a', running = false, contextPlatform = 'win32', activeEngine = 'q2pro', platform = 'win32', playback, stageAvail = { available: true }, geometry = '800x600+10+20', cvarRestore, onStageSession }: Setup) {
  const fake = fakeLaunch(running)
  const sessions = { begin: vi.fn(), end: vi.fn() }
  const installations = [
    installation({ id: 'q2pro-a', rootPath: q2proRoot, engineKind: activeEngine }),
    installation({ id: 'q2pro-other', rootPath: siblingRoot }),
    installation({ id: 'r1q2-b', rootPath: r1q2Root, engineKind: 'r1q2' }),
  ]
  const player = createDemoPlay({
    readDemos: async () => demos,
    resolveFile: (id) => files[id],
    installations: () => installations,
    activeInstallationId: () => active,
    platform,
    playback,
    stageAvailability: () => stageAvail,
    toGeometry: () => geometry,
    cvarRestore,
    onStageSession,
    launch: fake.launch,
    sessions,
    discoveryContext: () => ({
      platform: contextPlatform,
      homeDir: homeDir,
      zipDeps: { extractorPath: join(tmp, 'no-7za.exe'), extractorExists: false },
    }),
  })
  return { ...fake, sessions, installations, play: player.play }
}

const CTF_DEMO = demo({
  id: 'ctf',
  fileName: 'x.dm2',
  gameDir: 'ctf',
  source: { kind: 'installation', installationId: 'q2pro-a', installationName: 'Q2PRO', gameDir: 'ctf' },
})
const BASE_DEMO = demo({ id: 'base', fileName: 'b.dm2' })

beforeEach(async () => {
  tmp = await canonicalizePath(await mkdtemp(join(tmpdir(), 'demo-play-')))
  q2proRoot = join(tmp, 'Quake2')
  siblingRoot = join(tmp, 'Quake2-other')
  r1q2Root = join(tmp, 'R1Q2')
  homeDir = join(tmp, 'home')
  // `Demos` on purpose: the folder is found case-insensitively, as discovery does.
  await mkdir(join(q2proRoot, 'ctf', 'Demos'), { recursive: true })
  await mkdir(join(q2proRoot, 'baseq2', 'demos'), { recursive: true })
  await mkdir(join(siblingRoot, 'baseq2', 'demos'), { recursive: true })
  await mkdir(join(r1q2Root, 'baseq2', 'demos'), { recursive: true })
  await writeFile(join(q2proRoot, 'ctf', 'Demos', 'x.dm2'), 'demo')
  await writeFile(join(q2proRoot, 'baseq2', 'demos', 'b.dm2'), 'demo')
  await writeFile(join(siblingRoot, 'baseq2', 'demos', 'evil.dm2'), 'demo')
  await writeFile(join(r1q2Root, 'baseq2', 'demos', 'r.dm2'), 'demo')
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function ctfFiles(): Setup['files'] {
  return {
    ctf: { absolutePath: join(q2proRoot, 'ctf', 'Demos', 'x.dm2'), archiveEntry: null },
    base: { absolutePath: join(q2proRoot, 'baseq2', 'demos', 'b.dm2'), archiveEntry: null },
  }
}

describe('demo.play with a mod the installation does not list', () => {
  it('is refused as a warning until the user acknowledges it, then plays', async () => {
    await mkdir(join(q2proRoot, 'opentdm', 'demos'), { recursive: true })
    await writeFile(join(q2proRoot, 'opentdm', 'demos', 'o.dm2'), 'demo')
    const tdm = demo({
      id: 'tdm',
      fileName: 'o.dm2',
      gameDir: 'opentdm',
      source: { kind: 'installation', installationId: 'q2pro-a', installationName: 'Q2PRO', gameDir: 'opentdm' },
    })
    const h = harness({
      demos: [tdm],
      files: { tdm: { absolutePath: join(q2proRoot, 'opentdm', 'demos', 'o.dm2'), archiveEntry: null } },
    })
    expect(await h.play('tdm', 'q2pro-a')).toEqual({
      ok: false,
      error: { key: 'replays.play.unavailable.modMissing', params: { gameDir: 'opentdm' } },
    })
    expect(h.launch.start).not.toHaveBeenCalled()

    expect(await h.play('tdm', 'q2pro-a', { acknowledgeModMissing: true })).toEqual({ ok: true, value: { stage: null } })
    expect(h.launch.start).toHaveBeenCalledWith(
      { installationId: 'q2pro-a', gameDir: 'opentdm', extraArgs: ['+demo', 'o.dm2'] },
      { demo: true },
    )
  })
})

describe('demo.play engine guard (story 161 D1)', () => {
  it('a non-Q2PRO installation never gets a demo launch', async () => {
    const others = engineKindSchema.options.filter((kind) => kind !== 'q2pro')
    expect(others.length).toBeGreaterThan(0)
    for (const engineKind of others) {
      // In place, and a demo from elsewhere (which would otherwise be copied into `_launcher`).
      const outsider = demo({ id: 'evil', fileName: 'evil.dm2' })
      const h = harness({
        demos: [BASE_DEMO, outsider],
        files: {
          ...ctfFiles(),
          evil: { absolutePath: join(siblingRoot, 'baseq2', 'demos', 'evil.dm2'), archiveEntry: null },
        },
        activeEngine: engineKind,
      })
      for (const id of ['base', 'evil']) {
        const result = await h.play(id, 'q2pro-a')
        expect(result, engineKind).toEqual({ ok: false, error: { key: 'replays.play.unavailable.notQ2pro' } })
      }
      expect(h.launch.start, engineKind).not.toHaveBeenCalled()
      expect(existsSync(join(q2proRoot, 'baseq2', 'demos', LAUNCHER_DIR_NAME)), engineKind).toBe(false)
      expect(h.sessions.begin, engineKind).not.toHaveBeenCalled()
    }
  })

  it('demo launch args never contain demomap', async () => {
    for (const engineKind of engineKindSchema.options) {
      const gz = demo({ id: 'gz', fileName: 'run.dm2.gz', gzip: true })
      const h = harness({
        demos: [BASE_DEMO, gz],
        files: {
          ...ctfFiles(),
          gz: { absolutePath: join(q2proRoot, 'baseq2', 'demos', 'b.dm2'), archiveEntry: null },
        },
        activeEngine: engineKind,
      })
      for (const id of ['base', 'gz']) {
        await h.play(id, 'q2pro-a')
        h.emit({ phase: 'exited', installationId: 'q2pro-a' })
      }
      for (const [input] of h.launch.start.mock.calls) {
        const args = buildLaunchArgs(h.installations[0], input).args
        expect(args.some((a) => a.toLowerCase().includes('demomap')), engineKind).toBe(false)
      }
      expect(h.launch.start.mock.calls.length > 0, engineKind).toBe(engineKind === 'q2pro')
    }
  })

  it('the real builder never emits demomap for any engine kind, plain or gz demo', async () => {
    const gz = demo({ id: 'gz', fileName: 'run.dm2.gz', gzip: true })
    const h = harness({
      demos: [BASE_DEMO, gz],
      files: {
        ...ctfFiles(),
        gz: { absolutePath: join(q2proRoot, 'baseq2', 'demos', 'b.dm2'), archiveEntry: null },
      },
    })
    for (const id of ['base', 'gz']) {
      await h.play(id, 'q2pro-a')
      h.emit({ phase: 'exited', installationId: 'q2pro-a' })
    }
    const inputs = h.launch.start.mock.calls.map(([input]) => input)
    expect(inputs).toHaveLength(2)
    for (const engineKind of engineKindSchema.options) {
      const installation = { ...h.installations[0], engineKind }
      for (const input of inputs) {
        const args = buildLaunchArgs(installation, input).args
        expect(args.some((a) => a.toLowerCase().includes('demomap')), engineKind).toBe(false)
      }
    }
  })
})

describe('demo.play (story 159 D2)', () => {
  it('a q2pro launch is exactly +set game and +demo, never demomap', async () => {
    const h = harness({ demos: [CTF_DEMO, BASE_DEMO], files: ctfFiles() })
    const q2pro = h.installations[0]
    const engineDefaults = buildLaunchArgs(q2pro, { gameDir: 'baseq2' }).args

    expect(await h.play('ctf', 'q2pro-a')).toEqual({ ok: true, value: { stage: null } })
    const ctfArgs = buildLaunchArgs(q2pro, h.launch.start.mock.calls[0][0]).args
    expect(ctfArgs).toEqual([...engineDefaults, '+set', 'game', 'ctf', '+demo', 'x.dm2'])

    h.emit({ phase: 'exited', installationId: 'q2pro-a' })
    expect(await h.play('base', 'q2pro-a')).toEqual({ ok: true, value: { stage: null } })
    const baseArgs = buildLaunchArgs(q2pro, h.launch.start.mock.calls[1][0]).args
    expect(baseArgs).toEqual([...engineDefaults, '+demo', 'b.dm2'])

    for (const args of [ctfArgs, baseArgs]) {
      expect(args.some((a) => a.toLowerCase().includes('demomap'))).toBe(false)
    }
  })

  it('the fake launch service receives exactly the eligible LaunchInput', async () => {
    const h = harness({ demos: [CTF_DEMO], files: ctfFiles() })
    await h.play('ctf', 'q2pro-a')
    expect(h.launch.start).toHaveBeenCalledTimes(1)
    expect(h.launch.start.mock.calls[0][0]).toStrictEqual({
      installationId: 'q2pro-a',
      gameDir: 'ctf',
      extraArgs: ['+demo', 'x.dm2'],
    })
  })

  // Story 160 D2 replaced 159's refusal of a demo from elsewhere with a staged copy: such a demo is
  // still never played in place - it is launched only as `_launcher/<id><ext>`, never by its own name.
  it("a demo outside the installation's demos folder is never played in place", async () => {
    const stagedArgs = { installationId: 'q2pro-a', gameDir: 'baseq2', extraArgs: ['+demo', '_launcher/evil.dm2'] }

    // Sibling-prefix root: `<tmp>/Quake2-other` starts with `<tmp>/Quake2`, but it is not that folder.
    const sibling = harness({
      demos: [demo({ id: 'evil', fileName: 'evil.dm2' })],
      files: { evil: { absolutePath: join(siblingRoot, 'baseq2', 'demos', 'evil.dm2'), archiveEntry: null } },
    })
    expect(await sibling.play('evil', 'q2pro-a')).toEqual({ ok: true, value: { stage: null } })
    expect(sibling.launch.start.mock.calls).toEqual([[stagedArgs, { demo: true }]])

    // Another installation's id in the payload, for a demo that is eligible in the active one.
    const otherId = harness({ demos: [CTF_DEMO], files: ctfFiles() })
    expect((await otherId.play('ctf', 'q2pro-other')).ok).toBe(false)
    expect(otherId.launch.start).not.toHaveBeenCalled()

    // A demo row that belongs to another (non-active) installation.
    const otherRow = harness({
      demos: [demo({ id: 'evil', fileName: 'evil.dm2', source: { kind: 'installation', installationId: 'q2pro-other', installationName: 'Other', gameDir: 'baseq2' } })],
      files: { evil: { absolutePath: join(siblingRoot, 'baseq2', 'demos', 'evil.dm2'), archiveEntry: null } },
    })
    expect((await otherRow.play('evil', 'q2pro-a')).ok).toBe(true)
    expect(otherRow.launch.start.mock.calls).toEqual([[stagedArgs, { demo: true }]])

    // An archive entry - once as the row says it, once only in main's own resolved file record. Both
    // are staged from the archive (never played in place); with no extractor there, neither launches.
    const entry = { archivePath: join(q2proRoot, 'baseq2', 'demos', 'pack.zip'), entryPath: 'b.dm2' }
    const archiveRow = harness({
      demos: [demo({ id: 'base', fileName: 'b.dm2', archiveEntry: entry })],
      files: { base: { absolutePath: entry.archivePath, archiveEntry: entry } },
    })
    expect((await archiveRow.play('base', 'q2pro-a')).ok).toBe(false)
    expect(archiveRow.launch.start).not.toHaveBeenCalled()
    const archiveFile = harness({
      demos: [BASE_DEMO],
      files: { base: { absolutePath: join(q2proRoot, 'baseq2', 'demos', 'b.dm2'), archiveEntry: entry } },
    })
    expect((await archiveFile.play('base', 'q2pro-a')).ok).toBe(false)
    expect(archiveFile.launch.start).not.toHaveBeenCalled()

    // An r1q2 installation's id sent directly (active, so the only thing refusing it is the engine).
    const r1q2 = harness({
      demos: [demo({ id: 'r', fileName: 'r.dm2', source: { kind: 'installation', installationId: 'r1q2-b', installationName: 'R1Q2', gameDir: 'baseq2' } })],
      files: { r: { absolutePath: join(r1q2Root, 'baseq2', 'demos', 'r.dm2'), archiveEntry: null } },
      active: 'r1q2-b',
    })
    expect(await r1q2.play('r', 'r1q2-b')).toEqual({ ok: false, error: { key: 'replays.play.unavailable.notQ2pro' } })
    expect(r1q2.launch.start).not.toHaveBeenCalled()

    // A game already running - main's own launch state, not anything the renderer said.
    const running = harness({ demos: [CTF_DEMO], files: ctfFiles(), running: true })
    expect(await running.play('ctf', 'q2pro-a')).toEqual({
      ok: false,
      error: { key: 'replays.play.unavailable.gameRunning' },
    })
    expect(running.launch.start).not.toHaveBeenCalled()

    for (const h of [otherId, archiveRow, archiveFile, r1q2, running]) {
      expect(h.sessions.begin).not.toHaveBeenCalled()
    }
  })

  it('an unknown demo or a file that is gone is refused without a launch', async () => {
    const unknown = harness({ demos: [CTF_DEMO], files: ctfFiles() })
    expect(await unknown.play('nope', 'q2pro-a')).toEqual({ ok: false, error: { key: 'replays.play.error.notFound' } })
    expect(unknown.launch.start).not.toHaveBeenCalled()

    await rm(join(q2proRoot, 'ctf', 'Demos', 'x.dm2'))
    const missing = harness({ demos: [CTF_DEMO], files: ctfFiles() })
    expect(await missing.play('ctf', 'q2pro-a')).toEqual({ ok: false, error: { key: 'replays.play.error.fileMissing' } })
    expect(missing.launch.start).not.toHaveBeenCalled()
  })

  it('the payload schema refuses a smuggled path', () => {
    expect(replaysDemoPlaySchema.safeParse({ demoId: 'ctf', installationId: 'q2pro-a' }).success).toBe(true)
    expect(
      replaysDemoPlaySchema.safeParse({ demoId: 'ctf', installationId: 'q2pro-a', path: 'C:\\evil.dm2' }).success,
    ).toBe(false)
  })

  it('a playback session begins on start and ends when the game exits', async () => {
    const h = harness({ demos: [CTF_DEMO], files: ctfFiles() })
    await h.play('ctf', 'q2pro-a')
    expect(h.sessions.begin.mock.calls).toEqual([['ctf']])
    expect(h.sessions.end).not.toHaveBeenCalled()

    h.emit({ phase: 'starting', installationId: 'q2pro-a' })
    h.emit({ phase: 'running', installationId: 'q2pro-a' })
    expect(h.sessions.end).not.toHaveBeenCalled()
    expect(h.unsubscribe).not.toHaveBeenCalled()

    h.emit({ phase: 'exited', installationId: 'q2pro-a' })
    expect(h.sessions.end.mock.calls).toEqual([['ctf']])
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)
    expect(h.listenerCount()).toBe(0)

    h.emit({ phase: 'idle', installationId: null })
    expect(h.sessions.end).toHaveBeenCalledTimes(1)
    expect(h.unsubscribe).toHaveBeenCalledTimes(1)

    // A game that is already gone by the time `start()` resolves still ends its session exactly once.
    const quick = harness({ demos: [CTF_DEMO], files: ctfFiles() })
    quick.state.exitBeforeResolve = true
    await quick.play('ctf', 'q2pro-a')
    expect(quick.sessions.begin.mock.calls).toEqual([['ctf']])
    expect(quick.sessions.end.mock.calls).toEqual([['ctf']])
    expect(quick.unsubscribe).toHaveBeenCalledTimes(1)
    expect(quick.listenerCount()).toBe(0)

    // A failed start begins no session and subscribes to nothing.
    const failing = harness({ demos: [CTF_DEMO], files: ctfFiles() })
    failing.launch.start.mockResolvedValueOnce({ ok: false, error: { key: 'launch.error.executableMissing' } })
    expect(await failing.play('ctf', 'q2pro-a')).toEqual({
      ok: false,
      error: { key: 'launch.error.executableMissing' },
    })
    expect(failing.sessions.begin).not.toHaveBeenCalled()
    expect(failing.launch.onStateChange).not.toHaveBeenCalled()
  })
})

describe('demo.play from elsewhere (story 160 D2)', () => {
  /** A demo from the sibling installation: not in place for `q2pro-a`, so it is played from a copy. */
  const ELSEWHERE = demo({
    id: 'away',
    fileName: 'evil.dm2',
    source: { kind: 'installation', installationId: 'q2pro-other', installationName: 'Other', gameDir: 'baseq2' },
  })
  const elsewhereFiles = (): Setup['files'] => ({
    away: { absolutePath: join(siblingRoot, 'baseq2', 'demos', 'evil.dm2'), archiveEntry: null },
  })
  const copyPath = (): string => join(q2proRoot, 'baseq2', 'demos', '_launcher', 'away.dm2')
  const original = (): string => join(siblingRoot, 'baseq2', 'demos', 'evil.dm2')

  it('the copy is removed when the game exits, fails or never starts', async () => {
    for (const end of ['exited', 'failed'] as const) {
      const h = harness({ demos: [ELSEWHERE], files: elsewhereFiles() })
      expect(await h.play('away', 'q2pro-a')).toEqual({ ok: true, value: { stage: null } })
      expect(h.launch.start.mock.calls[0][0].extraArgs).toEqual(['+demo', '_launcher/away.dm2'])
      expect(await readFile(copyPath(), 'utf8')).toBe('demo')

      // Another installation's end, the running phase and an idle state leave the copy alone.
      h.emit({ phase: end, installationId: 'q2pro-other' })
      h.emit({ phase: 'running', installationId: 'q2pro-a' })
      h.emit({ phase: 'idle', installationId: null })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(existsSync(copyPath())).toBe(true)

      h.emit({ phase: end, installationId: 'q2pro-a' })
      await vi.waitFor(() => expect(existsSync(copyPath())).toBe(false))
      expect(h.listenerCount()).toBe(0)
      expect(existsSync(original())).toBe(true)
    }

    // The launch never starts: the copy is gone by the time `play` answers, and nothing is tracked.
    const failing = harness({ demos: [ELSEWHERE], files: elsewhereFiles() })
    failing.launch.start.mockResolvedValueOnce({ ok: false, error: { key: 'launch.error.executableMissing' } })
    expect(await failing.play('away', 'q2pro-a')).toEqual({
      ok: false,
      error: { key: 'launch.error.executableMissing' },
    })
    expect(failing.launch.start).toHaveBeenCalledTimes(1)
    expect(existsSync(copyPath())).toBe(false)
    expect(failing.launch.onStateChange).not.toHaveBeenCalled()

    // A game gone before `start()` resolved still has its copy removed.
    const quick = harness({ demos: [ELSEWHERE], files: elsewhereFiles() })
    quick.state.exitBeforeResolve = true
    expect((await quick.play('away', 'q2pro-a')).ok).toBe(true)
    await vi.waitFor(() => expect(existsSync(copyPath())).toBe(false))
    expect(quick.listenerCount()).toBe(0)
    expect(existsSync(original())).toBe(true)
  })

  it('an in-place play never deletes a file', async () => {
    const inPlace = join(q2proRoot, 'ctf', 'Demos', 'x.dm2')
    for (const end of ['exited', 'failed', 'start'] as const) {
      const h = harness({ demos: [CTF_DEMO], files: ctfFiles() })
      if (end === 'start') {
        h.launch.start.mockResolvedValueOnce({ ok: false, error: { key: 'launch.error.executableMissing' } })
      }
      await h.play('ctf', 'q2pro-a')
      expect(h.launch.start.mock.calls[0][0].extraArgs).toEqual(['+demo', 'x.dm2'])
      if (end !== 'start') h.emit({ phase: end, installationId: 'q2pro-a' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(await readFile(inPlace, 'utf8')).toBe('demo')
      expect(existsSync(join(q2proRoot, 'ctf', 'Demos', '_launcher'))).toBe(false)
      expect(existsSync(join(q2proRoot, 'ctf', 'demos', '_launcher'))).toBe(false)
    }
  })

  it('a staging failure never calls launch', async () => {
    // `_launcher` is a file here, so the one candidate folder (win32: no write dir) cannot be made.
    await writeFile(join(q2proRoot, 'baseq2', 'demos', LAUNCHER_DIR_NAME), 'in the way')
    const h = harness({ demos: [ELSEWHERE], files: elsewhereFiles() })
    expect(await h.play('away', 'q2pro-a')).toEqual({
      ok: false,
      error: {
        key: 'replays.play.error.copyDirNotWritable',
        params: { path: join(q2proRoot, 'baseq2', 'demos', LAUNCHER_DIR_NAME) },
      },
    })
    expect(h.launch.start).not.toHaveBeenCalled()
    expect(h.sessions.begin).not.toHaveBeenCalled()

    // A zip entry that cannot be read out of its archive is refused the same way, before any launch.
    const entry = { archivePath: join(siblingRoot, 'baseq2', 'demos', 'pack.zip'), entryPath: 'evil.dm2' }
    await writeFile(entry.archivePath, 'not really a zip')
    const zip = harness({
      demos: [{ ...ELSEWHERE, archiveEntry: entry }],
      files: { away: { absolutePath: entry.archivePath, archiveEntry: entry } },
    })
    const zipOutcome = await zip.play('away', 'q2pro-a')
    expect(zipOutcome.ok).toBe(false)
    expect(!zipOutcome.ok && zipOutcome.error.key).toBe('replays.play.error.archiveEntry')
    expect(zip.launch.start).not.toHaveBeenCalled()
  })

  it("a copy falls back to the Q2PRO write dir when the installation's folder is not writable", async () => {
    await writeFile(join(q2proRoot, 'baseq2', 'demos', LAUNCHER_DIR_NAME), 'in the way')
    const h = harness({ demos: [ELSEWHERE], files: elsewhereFiles(), contextPlatform: 'linux' })
    expect((await h.play('away', 'q2pro-a')).ok).toBe(true)
    expect(h.launch.start.mock.calls[0][0].extraArgs).toEqual(['+demo', '_launcher/away.dm2'])
    const fallback = join(homeDir, '.q2pro', 'baseq2', 'demos', LAUNCHER_DIR_NAME, 'away.dm2')
    expect(existsSync(fallback)).toBe(true)
    h.emit({ phase: 'exited', installationId: 'q2pro-a' })
    await vi.waitFor(() => expect(existsSync(fallback)).toBe(false))
  })

  it('the startup sweep covers every staging dir of every installation', () => {
    const [q2pro, , r1q2] = harness({ demos: [], files: {} }).installations
    const linux = { platform: 'linux' as const, homeDir, zipDeps: { extractorPath: '', extractorExists: false } }
    expect(launcherSweepDirs([q2pro, r1q2], linux)).toEqual([
      join(q2proRoot, 'baseq2', 'demos'),
      join(homeDir, '.q2pro', 'baseq2', 'demos'),
      join(q2proRoot, 'ctf', 'demos'),
      join(homeDir, '.q2pro', 'ctf', 'demos'),
      join(r1q2Root, 'baseq2', 'demos'),
      join(r1q2Root, 'ctf', 'demos'),
    ])
  })
})

describe('demo.play playback channel (story 164 D4)', () => {
  function fakeControl() {
    return {
      prepare: vi.fn(async () => ({ argsBeforeDemo: ['+before'], argsAfterDemo: ['+exec', 'after.cfg'] })),
      attach: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      send: vi.fn(),
      currentFormat: vi.fn(() => null),
      enterFullscreen: vi.fn(),
      onDisplayChange: vi.fn(() => () => undefined),
    } satisfies PlaybackControl
  }

  it('channel args wrap +demo so +demo precedes +exec', async () => {
    for (const platform of ['win32', 'linux']) {
      const playback = fakeControl()
      const timed = demo({ id: 'base', fileName: 'b.dm2', durationMs: 61_000 })
      const h = harness({ demos: [timed], files: ctfFiles(), platform, playback })
      expect(await h.play('base', 'q2pro-a')).toEqual({ ok: true, value: { stage: null } })
      expect(playback.prepare).toHaveBeenCalledWith({
        gameDirPath: join(q2proRoot, 'baseq2'),
        durationMs: 61_000,
        format: 'dm2',
      })
      const [input, options] = h.launch.start.mock.calls[0] as unknown as [LaunchInput, unknown]
      const args = input.extraArgs ?? []
      expect(args[0], platform).toBe('+before')
      expect(args.indexOf('+demo'), platform).toBeGreaterThan(-1)
      expect(args.indexOf('+demo'), platform).toBeLessThan(args.indexOf('+exec'))
      expect(args.slice(-2), platform).toEqual(['+exec', 'after.cfg'])
      // Windows needs no pipes; Linux runs the console over them.
      expect(options, platform).toEqual(platform === 'linux' ? { playback: true } : { demo: true })
      // The channel is prepared (on Windows: its files written) before the game is spawned.
      expect(playback.prepare.mock.invocationCallOrder[0], platform).toBeLessThan(
        h.launch.start.mock.invocationCallOrder[0],
      )
      expect(playback.attach, platform).toHaveBeenCalledTimes(1)
      expect(playback.cancel, platform).not.toHaveBeenCalled()
    }
  })

  it('an mvd2 demo passes format mvd2 to prepare', async () => {
    const playback = fakeControl()
    const mvd = demo({ id: 'base', fileName: 'b.dm2', format: 'mvd2' })
    const h = harness({ demos: [mvd], files: ctfFiles(), playback })
    expect(await h.play('base', 'q2pro-a')).toEqual({ ok: true, value: { stage: null } })
    expect(playback.prepare).toHaveBeenCalledWith(expect.objectContaining({ format: 'mvd2' }))
  })

  it('a start that fails cancels the prepared channel and never attaches', async () => {
    const playback = fakeControl()
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), playback })
    h.launch.start.mockResolvedValueOnce({ ok: false, error: { key: 'launch.error.spawnFailed' } })
    expect((await h.play('base', 'q2pro-a')).ok).toBe(false)
    expect(playback.cancel).toHaveBeenCalledTimes(1)
    expect(playback.attach).not.toHaveBeenCalled()
  })

  it('a prepare that throws cancels the channel and never starts the launch', async () => {
    const playback = fakeControl()
    playback.prepare.mockRejectedValueOnce(new Error('disk full'))
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), playback })
    await expect(h.play('base', 'q2pro-a')).rejects.toThrow('disk full')
    expect(playback.cancel).toHaveBeenCalledTimes(1)
    expect(h.launch.start).not.toHaveBeenCalled()
  })

  it('the Linux EngineIo adapter writes newline-terminated lines and splits stdout chunks into lines', () => {
    const stdout = new Set<(chunk: Buffer) => void>()
    const write = vi.fn(() => true)
    const io = engineIoFromSession({
      installationId: 'q2pro-a',
      ended: false,
      write,
      onStdout: (l) => {
        stdout.add(l)
        return () => stdout.delete(l)
      },
      onEnd: () => () => undefined,
    })
    const lines: string[] = []
    const off = io.onLine((l) => lines.push(l))
    io.writeLine('demoseek 5')
    expect(write).toHaveBeenCalledWith('demoseek 5\n')
    const push = (text: string): void => stdout.forEach((l) => l(Buffer.from(text)))
    push('one\r\ntw')
    push('o\nthree')
    expect(lines).toEqual(['one', 'two'])
    push('\n')
    expect(lines).toEqual(['one', 'two', 'three'])
    off()
    expect(stdout.size).toBe(0)
  })
})

describe('demo.play on the stage (story 170 D2)', () => {
  const STAGE = { x: 1, y: 2, width: 640, height: 360 }
  const STAGE_ARGS = [
    '+set', 'vid_fullscreen', '0', '+set', 'win_noborder', '1', '+set', 'win_notitle', '1',
    '+set', 'win_alwaysontop', '1', '+set', 'win_noresize', '1', '+set', 'vid_geometry', '800x600+10+20',
  ]
  const argsOf = (h: ReturnType<typeof harness>): string[] =>
    ((h.launch.start.mock.calls[0] as unknown as [LaunchInput])[0].extraArgs ?? [])
  const control = () => ({
    prepare: vi.fn(async () => ({ argsBeforeDemo: ['+before'], argsAfterDemo: ['+exec', 'after.cfg'] })),
    attach: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    send: vi.fn(),
    currentFormat: vi.fn(() => null),
    enterFullscreen: vi.fn(),
    onDisplayChange: vi.fn(() => () => undefined),
  }) satisfies PlaybackControl

  it('stage args sit before +demo', async () => {
    for (const platform of ['win32', 'linux']) {
      const playback = control()
      const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), platform, playback })
      expect(await h.play('base', 'q2pro-a', { stage: STAGE })).toEqual({ ok: true, value: { stage: { placed: true } } })
      const args = argsOf(h)
      const demoAt = args.indexOf('+demo')
      expect(args.slice(0, 1), platform).toEqual(['+before'])
      expect(args.slice(demoAt - STAGE_ARGS.length, demoAt), platform).toEqual(STAGE_ARGS)
      expect(demoAt, platform).toBeLessThan(args.indexOf('+exec'))
    }
  })

  it('Wayland plays a normal window with the reason', async () => {
    const reason = { key: 'replays.stage.unavailable.wayland' } as const
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), stageAvail: { available: false, reason } })
    expect(await h.play('base', 'q2pro-a', { stage: STAGE })).toEqual({
      ok: true,
      value: { stage: { placed: false, reason } },
    })
    const args = argsOf(h)
    expect(args.join(' ')).toContain('+set vid_fullscreen 0 +demo')
    expect(args).not.toContain('vid_geometry')
    expect(args).not.toContain('win_noborder')
  })

  it('no stage rect keeps the args as they are today', async () => {
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles() })
    expect(await h.play('base', 'q2pro-a')).toEqual({ ok: true, value: { stage: null } })
    expect(argsOf(h)).not.toContain('vid_fullscreen')
    expect(argsOf(h)[0]).toBe('+demo')
  })

  it('a stage session begins only for a placed play and ends exactly once with it (story 171 D2)', async () => {
    const end = vi.fn()
    const onStageSession = vi.fn(() => end)

    const unplaced = harness({ demos: [BASE_DEMO], files: ctfFiles(), playback: control(), onStageSession })
    await unplaced.play('base', 'q2pro-a')
    unplaced.emit({ phase: 'exited', installationId: 'q2pro-a' })
    const wayland = harness({
      demos: [BASE_DEMO],
      files: ctfFiles(),
      playback: control(),
      onStageSession,
      stageAvail: { available: false, reason: { key: 'replays.stage.unavailable.wayland' } },
    })
    await wayland.play('base', 'q2pro-a', { stage: STAGE })
    const noWindow = harness({ demos: [BASE_DEMO], files: ctfFiles(), playback: control(), onStageSession, geometry: null })
    await noWindow.play('base', 'q2pro-a', { stage: STAGE })
    const noChannel = harness({ demos: [BASE_DEMO], files: ctfFiles(), onStageSession })
    await noChannel.play('base', 'q2pro-a', { stage: STAGE })
    expect(onStageSession).not.toHaveBeenCalled()

    const placed = harness({ demos: [BASE_DEMO], files: ctfFiles(), playback: control(), onStageSession })
    await placed.play('base', 'q2pro-a', { stage: STAGE })
    expect(onStageSession).toHaveBeenCalledTimes(1)
    expect(onStageSession).toHaveBeenCalledWith({ geometry: '800x600+10+20', rect: STAGE })
    expect(end).not.toHaveBeenCalled()
    placed.emit({ phase: 'exited', installationId: 'q2pro-a' })
    placed.emit({ phase: 'failed', installationId: 'q2pro-a' })
    expect(end).toHaveBeenCalledTimes(1)
  })
})

describe('demo.play stage cvar restore (story 170 D3)', () => {
  const STAGE = { x: 1, y: 2, width: 640, height: 360 }
  const restorer = () => ({ snapshot: vi.fn(async () => undefined), restore: vi.fn(async () => undefined) })

  it('a normal launch takes no snapshot', async () => {
    const cvarRestore = restorer()
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), cvarRestore })
    expect((await h.play('base', 'q2pro-a')).ok).toBe(true)
    h.emit({ phase: 'exited', installationId: 'q2pro-a' })
    expect(cvarRestore.snapshot).not.toHaveBeenCalled()
    expect(cvarRestore.restore).not.toHaveBeenCalled()
  })

  it('a stage launch snapshots before spawn and restores after exit', async () => {
    const cvarRestore = restorer()
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), cvarRestore })
    expect((await h.play('base', 'q2pro-a', { stage: STAGE })).ok).toBe(true)
    expect(cvarRestore.snapshot).toHaveBeenCalledWith(join(q2proRoot, 'baseq2', 'q2config.cfg'))
    expect(cvarRestore.snapshot.mock.invocationCallOrder[0]).toBeLessThan(h.launch.start.mock.invocationCallOrder[0] ?? 0)
    expect(cvarRestore.restore).not.toHaveBeenCalled()
    // Another installation's exit is not this session's end.
    h.emit({ phase: 'exited', installationId: 'q2pro-other' })
    expect(cvarRestore.restore).not.toHaveBeenCalled()
    h.emit({ phase: 'exited', installationId: 'q2pro-a' })
    h.emit({ phase: 'exited', installationId: 'q2pro-a' })
    expect(cvarRestore.restore).toHaveBeenCalledTimes(1)
  })

  it('a normal-window launch (Wayland) snapshots too, into the Linux write dir', async () => {
    const cvarRestore = restorer()
    const reason = { key: 'replays.stage.unavailable.wayland' } as const
    const h = harness({
      demos: [BASE_DEMO],
      files: ctfFiles(),
      cvarRestore,
      contextPlatform: 'linux',
      stageAvail: { available: false, reason },
    })
    await h.play('base', 'q2pro-a', { stage: STAGE })
    expect(cvarRestore.snapshot).toHaveBeenCalledWith(join(homeDir, '.q2pro', 'baseq2', 'q2config.cfg'))
    h.emit({ phase: 'failed', installationId: 'q2pro-a' })
    expect(cvarRestore.restore).toHaveBeenCalledTimes(1)
  })

  it('a channel playback without a stage rect is still snapshotted (story 174 D3)', async () => {
    const cvarRestore = restorer()
    const playback = {
      prepare: vi.fn(async () => ({
        argsBeforeDemo: ['+set', 'con_notifylines', '0', '+set', 'scr_chathud', '0'],
        argsAfterDemo: ['+exec', 'after.cfg'],
      })),
      attach: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      send: vi.fn(),
      currentFormat: vi.fn(() => null),
      enterFullscreen: vi.fn(),
      onDisplayChange: vi.fn(() => () => undefined),
    } satisfies PlaybackControl
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), cvarRestore, playback })
    expect((await h.play('base', 'q2pro-a')).ok).toBe(true)
    expect(cvarRestore.snapshot).toHaveBeenCalledWith(join(q2proRoot, 'baseq2', 'q2config.cfg'))
    expect(cvarRestore.snapshot.mock.invocationCallOrder[0]).toBeLessThan(h.launch.start.mock.invocationCallOrder[0] ?? 0)
    expect(cvarRestore.restore).not.toHaveBeenCalled()
    h.emit({ phase: 'exited', installationId: 'q2pro-a' })
    expect(cvarRestore.restore).toHaveBeenCalledTimes(1)
  })

  it('a launch that does not start restores right away', async () => {
    const cvarRestore = restorer()
    const h = harness({ demos: [BASE_DEMO], files: ctfFiles(), cvarRestore })
    h.launch.start.mockImplementationOnce(async () => ({ ok: false, error: { key: 'launch.error.x' } }) as never)
    expect((await h.play('base', 'q2pro-a', { stage: STAGE })).ok).toBe(false)
    expect(cvarRestore.snapshot).toHaveBeenCalledTimes(1)
    expect(cvarRestore.restore).toHaveBeenCalledTimes(1)
  })
})
