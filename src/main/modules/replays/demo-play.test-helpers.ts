import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { type DiscoveredDemo } from '@shared/modules/replays'
import { ok, type Installation, type LaunchInput, type LaunchState } from '@shared/types'
import { canonicalizePath } from '../../lib/fs-utils'
import { createDemoPlay, type DemoPlayLaunch } from './demo-play'
import type { PlaybackControl } from './playback-control'
import { type StageAvailability } from './stage'

export let tmp: string
export let q2proRoot: string
export let siblingRoot: string
export let r1q2Root: string
export let homeDir: string

export function installation(overrides: Partial<Installation>): Installation {
  return {
    id: 'test',
    name: 'Test',
    rootPath: 'unset',
    engineKind: 'q2pro',
    executablePath: 'unset',
    launchArgs: [],
    activeGameDir: '',
    activeMap: '',
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

export function demo(
  overrides: Partial<DiscoveredDemo> & Pick<DiscoveredDemo, 'id' | 'fileName'>,
): DiscoveredDemo {
  return {
    format: 'dm2',
    gzip: false,
    source: {
      kind: 'installation',
      installationId: 'q2pro-a',
      installationName: 'Q2PRO',
      gameDir: 'baseq2',
    },
    archiveEntry: null,
    map: 'q2dm1',
    unparsableReason: null,
    readable: true,
    unreadable: null,
    gameDir: null,
    pov: null,
    players: [],
    durationMs: null,
    roster: null,
    fileTime: { birthtimeMs: 0, mtimeMs: 0 },
    folder: [],
    nameFacts: null,
    ...overrides,
  }
}

export function fakeLaunch(initiallyRunning = false) {
  const listeners = new Set<(state: LaunchState) => void>()
  const state = { running: initiallyRunning, exitBeforeResolve: false }
  const unsubscribe = vi.fn()
  const launch = {
    isRunning: () => state.running,
    start: vi.fn(async (input: LaunchInput) => {
      state.running = !state.exitBeforeResolve
      return ok<LaunchState>({
        phase: state.running ? 'running' : 'exited',
        installationId: input.installationId,
      })
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

export interface Setup {
  demos: DiscoveredDemo[]
  files: Record<string, { absolutePath: string; archiveEntry: DiscoveredDemo['archiveEntry'] }>
  active?: string
  running?: boolean
  /** The staging context's platform - `linux` gives a Q2PRO installation a write dir (story 160). */
  contextPlatform?: NodeJS.Platform
  /** Engine of the active installation (`q2pro-a`); defaults to q2pro. */
  activeEngine?: Installation['engineKind']
  activeDetectedEngines?: Installation['detectedEngines']
  /** The platform `demo.play` runs on, and an optional playback control (story 164). */
  platform?: string
  playback?: PlaybackControl
  /** (story 170) */
  stageAvail?: StageAvailability
  geometry?: string | null
  /** (story 170) */
  cvarRestore?: {
    snapshot: (configPath: string, options?: { wholeFile?: true }) => Promise<void>
    restore: () => Promise<void>
  }
  /** (story 171) */
  onStageSession?: (start: {
    geometry: string
    rect: { x: number; y: number; width: number; height: number }
  }) => () => void
  /** The level the last demo session ended at; null when none was remembered. */
  demoVolume?: number | null
}

export function harness({
  demos,
  files,
  active = 'q2pro-a',
  running = false,
  contextPlatform = 'win32',
  activeEngine = 'q2pro',
  activeDetectedEngines,
  platform = 'win32',
  playback,
  stageAvail = { available: true },
  geometry = '800x600+10+20',
  cvarRestore,
  onStageSession,
  demoVolume = null,
}: Setup) {
  const fake = fakeLaunch(running)
  const sessions = { begin: vi.fn(), end: vi.fn() }
  const installations = [
    installation({
      id: 'q2pro-a',
      rootPath: q2proRoot,
      engineKind: activeEngine,
      detectedEngines: activeDetectedEngines,
    }),
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
    demoVolume: () => demoVolume,
    launch: fake.launch,
    sessions,
    discoveryContext: () => ({
      platform: contextPlatform,
      homeDir: homeDir,
      zipDeps: { extractorPath: join(tmp, 'no-extractor.exe'), extractorExists: false },
    }),
  })
  return { ...fake, sessions, installations, play: player.play }
}

export const CTF_DEMO = demo({
  id: 'ctf',
  fileName: 'x.dm2',
  gameDir: 'ctf',
  source: {
    kind: 'installation',
    installationId: 'q2pro-a',
    installationName: 'Q2PRO',
    gameDir: 'ctf',
  },
})
export const BASE_DEMO = demo({ id: 'base', fileName: 'b.dm2' })

export async function setupDirs(): Promise<void> {
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
}

export async function teardownDirs(): Promise<void> {
  await rm(tmp, { recursive: true, force: true })
}

export function ctfFiles(): Setup['files'] {
  return {
    ctf: { absolutePath: join(q2proRoot, 'ctf', 'Demos', 'x.dm2'), archiveEntry: null },
    base: { absolutePath: join(q2proRoot, 'baseq2', 'demos', 'b.dm2'), archiveEntry: null },
  }
}

export function fakeControl() {
  return {
    prepare: vi.fn(async () => ({
      argsBeforeDemo: ['+before'],
      argsAfterDemo: ['+exec', 'after.cfg'],
    })),
    attach: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    send: vi.fn(),
    currentFormat: vi.fn(() => null),
    enterFullscreen: vi.fn(),
    onDisplayChange: vi.fn(() => () => undefined),
    onStateChange: vi.fn(() => () => undefined),
    display: vi.fn(() => ({
      fullscreen: false,
      cinema: false,
      speed: 1,
      cinemaAvailability: { available: true as const },
      stageNotice: null,
    })),
    emitDisplay: vi.fn(),
    setSpeed: vi.fn(),
    setVolume: vi.fn(),
    takeChangedVolume: vi.fn(() => null),
    settled: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(() => Promise.resolve()),
  } satisfies PlaybackControl
}
