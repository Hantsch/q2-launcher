// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { ReplaysIntegratedPrepareResult } from '@shared/modules/replays'
import type { Outcome } from '@shared/types'
import { mockClient } from '../../../test-support/mock-client'
import { integratedPrepare, integratedRelease } from '../client'
import { clearConsole, consoleLines, pushLine } from './engine-console'
import { engineLoader } from './engine-loader'
import { adaptEngineModule, type RawEngineModule } from './engine-module'
import factory, { type FakeEngineCounters } from './fake-engine'
import {
  SESSION_CVARS,
  playIntegrated,
  stopIntegrated,
  type IntegratedHooks,
} from './integrated-session'

vi.mock('../client', (importOriginal) =>
  mockClient<typeof import('../client')>(importOriginal, {
    integratedPrepare: vi.fn(),
    integratedRelease: vi.fn(),
  }),
)
vi.mock('./engine-loader', () => ({ engineLoader: { load: vi.fn(), discard: vi.fn() } }))

const prepare = vi.mocked(integratedPrepare)
const release = vi.mocked(integratedRelease)
const load = vi.mocked(engineLoader.load)

const counters = (): FakeEngineCounters =>
  (globalThis as unknown as { __q2lFakeEngine: FakeEngineCounters }).__q2lFakeEngine

function manifest(
  over: Partial<ReplaysIntegratedPrepareResult> = {},
): ReplaysIntegratedPrepareResult {
  return {
    token: 'token-a',
    gameDir: 'baseq2',
    files: [
      { index: 0, vpath: 'baseq2/pak0.pak', size: 5 },
      { index: 1, vpath: 'baseq2/maps/q2dm1.bsp', size: 3 },
    ],
    demo: { index: 2, vpath: 'baseq2/demos/_launcher/duel.dm2', size: 4 },
    ...over,
  }
}

let frames = new Map<number, FrameRequestCallback>()
let frameId = 0
function runFrame(): void {
  const due = [...frames.values()]
  frames.clear()
  for (const cb of due) cb(0)
}

/** Every response is sized from the manifest that is currently being served. */
let served: ReplaysIntegratedPrepareResult = manifest()
const fetchMock = vi.fn(async (url: string) => {
  const index = Number(url.slice(url.lastIndexOf('/') + 1))
  const file = [...served.files, served.demo].find((f) => f.index === index)
  return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(file?.size ?? 0) }
})

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve()
}

let raw: RawEngineModule
let ccall: MockInstance<RawEngineModule['ccall']>
const consoleCommands = (): string[] => ccall.mock.calls.map((c) => String(c[3][0]))

function hooks() {
  return {
    onLoading: vi.fn(),
    onPlaying: vi.fn(),
    onFinished: vi.fn(),
    onRefused: vi.fn<IntegratedHooks['onRefused']>(),
  }
}

function grant(m: ReplaysIntegratedPrepareResult): void {
  served = m
  prepare.mockResolvedValueOnce({ ok: true, value: m })
}

/** Plays up to the demo command: prepare, fetches, the loading frame. */
async function playThrough(m: ReplaysIntegratedPrepareResult, h = hooks()): Promise<typeof h> {
  grant(m)
  const done = playIntegrated({ demoId: 'd', installationId: 'i' }, h)
  await settle()
  runFrame()
  await done
  return h
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  frames = new Map()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++frameId, cb)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('fetch', fetchMock)
  const canvas = document.createElement('canvas')
  canvas.getContext = (() => null) as typeof canvas.getContext
  raw = await factory({
    canvas,
    noInitialRun: true,
    locateFile: (p) => p,
    print: pushLine,
    printErr: pushLine,
  })
  ccall = vi.spyOn(raw, 'ccall')
  vi.spyOn(raw, 'callMain')
  load.mockResolvedValue(adaptEngineModule(raw, canvas))
  release.mockResolvedValue({ ok: true, value: undefined })
  clearConsole()
})

afterEach(async () => {
  await stopIntegrated()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete (globalThis as unknown as { __q2lFakeEngine?: unknown }).__q2lFakeEngine
})

describe('integrated session start', () => {
  it('the first play writes the manifest into MEMFS and starts the engine with basedir, homedir and game', async () => {
    const h = await playThrough(manifest())

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/engine-data/token-a/0',
      '/engine-data/token-a/1',
      '/engine-data/token-a/2',
    ])
    expect(counters().files).toEqual({
      '/q2/baseq2/pak0.pak': 5,
      '/q2/baseq2/maps/q2dm1.bsp': 3,
      '/q2/baseq2/demos/_launcher/duel.dm2': 4,
    })
    const [args] = counters().mainArgs
    expect(counters().mainArgs).toHaveLength(1)
    expect(args.slice(0, 9)).toEqual([
      '+set',
      'basedir',
      '/q2',
      '+set',
      'homedir',
      '/q2home',
      '+set',
      'game',
      'baseq2',
    ])
    expect(args.slice(-2)).toEqual(['+demo', '_launcher/duel.dm2'])
    expect(h.onPlaying).toHaveBeenCalledTimes(1)
    expect(h.onRefused).not.toHaveBeenCalled()
  })

  it('the session cvars are set on start and before every later demo', async () => {
    await playThrough(manifest())
    const expected = Object.fromEntries(SESSION_CVARS)
    expect(SESSION_CVARS).toContainEqual(['s_enable', '0'])
    const args = counters().mainArgs[0]
    for (const [name, value] of SESSION_CVARS) {
      const at = args.indexOf(name)
      expect(args.slice(at - 1, at + 2)).toEqual(['+set', name, value])
      expect(at).toBeLessThan(args.indexOf('+demo'))
    }

    // A console change between plays must not survive into the next demo.
    ccall.mockClear()
    raw.ccall('q2l_console', null, ['string'], ['set s_enable 1\nset cl_demowait 0'])
    await playThrough(manifest({ token: 'token-b' }))
    expect(counters().cvars).toMatchObject(expected)
    const commands = consoleCommands()
    const demoAt = commands.indexOf('demo _launcher/duel.dm2')
    const setsAt = commands.findIndex((c) => c.startsWith('set '))
    expect(setsAt).toBeGreaterThan(-1)
    expect(setsAt).toBeLessThan(demoAt)
    expect(commands.join('\n')).not.toMatch(/\bexec\b|\.cfg/)
  })

  it('the console capture holds no plumbing lines', async () => {
    await playThrough(manifest())
    await playThrough(manifest({ token: 'token-b', gameDir: 'ctf' }))
    expect(consoleLines().filter((l) => l.includes('q2l_') || l.includes('Execing'))).toEqual([])
    expect(consoleLines().filter((l) => l.startsWith('Unknown command'))).toEqual([])
  })

  it('the loading state comes one animation frame before the demo command', async () => {
    const h = hooks()
    grant(manifest())
    const done = playIntegrated({ demoId: 'd', installationId: 'i' }, h)
    await settle()
    expect(h.onLoading).toHaveBeenCalledTimes(1)
    expect(counters().files['/q2/baseq2/demos/_launcher/duel.dm2']).toBe(4)
    expect(counters().mainArgs).toEqual([])
    expect(frames.size).toBe(1)
    runFrame()
    await done
    expect(counters().mainArgs).toHaveLength(1)
    expect(h.onPlaying).toHaveBeenCalledTimes(1)

    // A later play with everything cached still paints the loading state before `demo`.
    const later = hooks()
    grant(manifest({ token: 'token-b' }))
    ccall.mockClear()
    const again = playIntegrated({ demoId: 'd', installationId: 'i' }, later)
    await settle()
    expect(later.onLoading).toHaveBeenCalledTimes(1)
    expect(consoleCommands()).not.toContain('demo _launcher/duel.dm2')
    runFrame()
    await again
    expect(consoleCommands()).toContain('demo _launcher/duel.dm2')
  })
})

describe('integrated session end and stop', () => {
  it("the demo's end reports finished once and keeps the picture", async () => {
    const h = await playThrough(manifest())
    runFrame()
    expect(h.onFinished).not.toHaveBeenCalled()
    vi.advanceTimersByTime(counters().demoPlayMs)
    runFrame()
    expect(h.onFinished).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
    runFrame()
    expect(h.onFinished).toHaveBeenCalledTimes(1)
    expect(counters().disconnects).toBe(0)
    expect(release).not.toHaveBeenCalled()
  })

  it('stop disconnects and releases the token', async () => {
    await playThrough(manifest())
    await stopIntegrated()
    expect(counters().disconnects).toBe(1)
    expect(release).toHaveBeenCalledWith('token-a')
    expect(frames.size).toBe(0)
  })

  it('the poll stops after Stop', async () => {
    const h = await playThrough(manifest())
    await stopIntegrated()
    vi.advanceTimersByTime(counters().demoPlayMs)
    runFrame()
    expect(frames.size).toBe(0)
    expect(h.onFinished).not.toHaveBeenCalled()
  })

  it('stop still releases the token when the engine is gone', async () => {
    await playThrough(manifest())
    ccall.mockImplementation(() => {
      throw new Error('context lost')
    })
    await expect(stopIntegrated()).resolves.toBeUndefined()
    expect(release).toHaveBeenCalledWith('token-a')
  })

  it('a stop while loading fetches nothing after the release and never starts the demo', async () => {
    let resolveFirst: (v: Awaited<ReturnType<typeof fetchMock>>) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
    const h = hooks()
    grant(manifest())
    const done = playIntegrated({ demoId: 'd', installationId: 'i' }, h)
    await settle()
    await stopIntegrated()
    expect(release).toHaveBeenCalledWith('token-a')
    resolveFirst({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(5) })
    await settle()
    runFrame()
    await done
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(counters().mainArgs).toEqual([])
    expect(h.onPlaying).not.toHaveBeenCalled()
  })

  it('a stop during prepare releases the token that prepare returns', async () => {
    let resolvePrepare: (v: Outcome<ReplaysIntegratedPrepareResult>) => void = () => {}
    prepare.mockImplementationOnce(() => new Promise((r) => (resolvePrepare = r)))
    const h = hooks()
    const done = playIntegrated({ demoId: 'd', installationId: 'i' }, h)
    await settle()
    const stopped = stopIntegrated()
    await settle()
    expect(release).not.toHaveBeenCalled()
    resolvePrepare({ ok: true, value: manifest() })
    await stopped
    await done
    expect(release).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith('token-a')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(counters().mainArgs).toEqual([])
    expect(h.onLoading).not.toHaveBeenCalled()
  })
})

describe('integrated session later plays', () => {
  it('a play while a session runs releases its token before preparing the next', async () => {
    await playThrough(manifest())
    await playThrough(manifest({ token: 'token-b' }))
    expect(release).toHaveBeenCalledWith('token-a')
    expect(release.mock.invocationCallOrder[0]).toBeLessThan(prepare.mock.invocationCallOrder[1])
    expect(fetchMock.mock.calls.slice(3).every((c) => String(c[0]).includes('token-b'))).toBe(true)
  })

  it('a later play reuses files already in MEMFS and replaces the previous launcher demo', async () => {
    await playThrough(manifest())
    fetchMock.mockClear()
    const unlink = vi.spyOn(raw.FS, 'unlink')
    await playThrough(
      manifest({
        token: 'token-b',
        files: [
          { index: 0, vpath: 'baseq2/pak0.pak', size: 5 },
          { index: 1, vpath: 'baseq2/maps/q2dm1.bsp', size: 9 },
        ],
        demo: { index: 2, vpath: 'baseq2/demos/_launcher/rematch.dm2', size: 6 },
      }),
    )
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/engine-data/token-b/1',
      '/engine-data/token-b/2',
    ])
    expect(unlink).toHaveBeenCalledWith('/q2/baseq2/demos/_launcher/duel.dm2')
    expect(counters().files).toEqual({
      '/q2/baseq2/pak0.pak': 5,
      '/q2/baseq2/maps/q2dm1.bsp': 9,
      '/q2/baseq2/demos/_launcher/rematch.dm2': 6,
    })
    expect(counters().mainArgs).toHaveLength(1)
  })

  it('a game change is sent after disconnect and before the demo, and only when it changes', async () => {
    await playThrough(manifest())
    ccall.mockClear()
    const ctf = manifest({
      token: 'token-b',
      gameDir: 'ctf',
      files: [{ index: 0, vpath: 'ctf/pak0.pak', size: 2 }],
      demo: { index: 1, vpath: 'ctf/demos/_launcher/flag.dm2', size: 3 },
    })
    const h = await playThrough(ctf)
    const commands = consoleCommands()
    // The first disconnect belongs to stopping the previous session.
    const own = commands.slice(1)
    expect(own[0]).toBe('disconnect')
    expect(own[1]).toBe('game ctf')
    expect(own.at(-1)).toBe('demo _launcher/flag.dm2')
    expect(h.onPlaying).toHaveBeenCalledTimes(1)
    expect(consoleLines().filter((l) => l.startsWith("Couldn't open"))).toEqual([])

    ccall.mockClear()
    await playThrough({ ...ctf, token: 'token-c' })
    expect(consoleCommands().some((c) => c.startsWith('game '))).toBe(false)
  })
})

describe('integrated session refusals', () => {
  it('a refusal reaches onRefused and nothing loads', async () => {
    const h = hooks()
    const refusal: Outcome<ReplaysIntegratedPrepareResult> = {
      ok: false,
      error: { key: 'replays.integrated.error.dataTooLarge', params: { sizeMb: 3 } },
    }
    prepare.mockResolvedValueOnce(refusal)
    await playIntegrated({ demoId: 'd', installationId: 'i' }, h)
    expect(h.onRefused).toHaveBeenCalledWith({
      key: 'replays.integrated.error.dataTooLarge',
      params: { sizeMb: 3 },
      canPlayInEngineMode: true,
    })
    expect(h.onLoading).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })

  it('a failed fetch releases the token and reports loadFailed', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    }))
    const h = hooks()
    grant(manifest())
    await playIntegrated({ demoId: 'd', installationId: 'i' }, h)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith('token-a')
    expect(h.onRefused).toHaveBeenCalledWith({
      key: 'replays.integrated.error.loadFailed',
      canPlayInEngineMode: true,
    })
    expect(counters().mainArgs).toEqual([])
    expect(h.onPlaying).not.toHaveBeenCalled()
  })

  it('a throwing engine start releases the token and reports loadFailed', async () => {
    vi.mocked(raw.callMain).mockImplementationOnce(() => {
      throw new Error('abort')
    })
    const h = await playThrough(manifest())
    expect(release).toHaveBeenCalledWith('token-a')
    expect(h.onRefused).toHaveBeenCalledWith({
      key: 'replays.integrated.error.loadFailed',
      canPlayInEngineMode: true,
    })
    expect(h.onPlaying).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })

  it('a later play still works after a failed start', async () => {
    vi.mocked(raw.callMain).mockImplementationOnce(() => {
      throw new Error('abort')
    })
    await playThrough(manifest())
    const h = await playThrough(manifest({ token: 'token-b' }))
    expect(h.onRefused).not.toHaveBeenCalled()
    expect(h.onPlaying).toHaveBeenCalledTimes(1)
  })
})
