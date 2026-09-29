import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { replaysDemoPlaySchema, type DiscoveredDemo } from '@shared/modules/replays'
import { ok, type Installation, type LaunchInput, type LaunchState } from '@shared/types'
import { canonicalizePath } from '../../lib/fs-utils'
import { buildLaunchArgs } from '../../services/launch-plan'
import { createDemoPlay, type DemoPlayLaunch } from './demo-play'

/**
 * Story 159 D2: `demo.play` in main. Real temp folders on disk (containment is a realpath question,
 * so it is tested against a real filesystem), a fake launch service standing in for `LaunchService`.
 */

let tmp: string
let q2proRoot: string
let siblingRoot: string
let r1q2Root: string

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
}

function harness({ demos, files, active = 'q2pro-a', running = false }: Setup) {
  const fake = fakeLaunch(running)
  const sessions = { begin: vi.fn(), end: vi.fn() }
  const installations = [
    installation({ id: 'q2pro-a', rootPath: q2proRoot }),
    installation({ id: 'q2pro-other', rootPath: siblingRoot }),
    installation({ id: 'r1q2-b', rootPath: r1q2Root, engineKind: 'r1q2' }),
  ]
  const player = createDemoPlay({
    readDemos: async () => demos,
    resolveFile: (id) => files[id],
    installations: () => installations,
    activeInstallationId: () => active,
    platform: 'win32',
    launch: fake.launch,
    sessions,
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

describe('demo.play (story 159 D2)', () => {
  it('a q2pro launch is exactly +set game and +demo, never demomap', async () => {
    const h = harness({ demos: [CTF_DEMO, BASE_DEMO], files: ctfFiles() })
    const q2pro = h.installations[0]
    const engineDefaults = buildLaunchArgs(q2pro, { gameDir: 'baseq2' }).args

    expect(await h.play('ctf', 'q2pro-a')).toEqual({ ok: true, value: undefined })
    const ctfArgs = buildLaunchArgs(q2pro, h.launch.start.mock.calls[0][0]).args
    expect(ctfArgs).toEqual([...engineDefaults, '+set', 'game', 'ctf', '+demo', 'x.dm2'])

    h.emit({ phase: 'exited', installationId: 'q2pro-a' })
    expect(await h.play('base', 'q2pro-a')).toEqual({ ok: true, value: undefined })
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

  it("a demo outside the installation's demos folder is not launched", async () => {
    // Sibling-prefix root: `<tmp>/Quake2-other` starts with `<tmp>/Quake2`, but it is not that folder.
    const sibling = harness({
      demos: [demo({ id: 'evil', fileName: 'evil.dm2' })],
      files: { evil: { absolutePath: join(siblingRoot, 'baseq2', 'demos', 'evil.dm2'), archiveEntry: null } },
    })
    expect(await sibling.play('evil', 'q2pro-a')).toEqual({
      ok: false,
      error: { key: 'replays.play.unavailable.notInInstallation' },
    })
    expect(sibling.launch.start).not.toHaveBeenCalled()

    // Another installation's id in the payload, for a demo that is eligible in the active one.
    const otherId = harness({ demos: [CTF_DEMO], files: ctfFiles() })
    expect((await otherId.play('ctf', 'q2pro-other')).ok).toBe(false)
    expect(otherId.launch.start).not.toHaveBeenCalled()

    // A demo row that belongs to another (non-active) installation.
    const otherRow = harness({
      demos: [demo({ id: 'evil', fileName: 'evil.dm2', source: { kind: 'installation', installationId: 'q2pro-other', installationName: 'Other', gameDir: 'baseq2' } })],
      files: { evil: { absolutePath: join(siblingRoot, 'baseq2', 'demos', 'evil.dm2'), archiveEntry: null } },
    })
    expect((await otherRow.play('evil', 'q2pro-a')).ok).toBe(false)
    expect(otherRow.launch.start).not.toHaveBeenCalled()

    // An archive entry - once as the row says it, once only in main's own resolved file record.
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

    for (const h of [sibling, otherId, otherRow, archiveRow, archiveFile, r1q2, running]) {
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
