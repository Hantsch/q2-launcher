// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adaptEngineModule, runConsole } from './engine-module'
import factory, { type FakeEngineCounters } from './fake-engine'

const counters = (): FakeEngineCounters =>
  (globalThis as unknown as { __q2lFakeEngine: FakeEngineCounters }).__q2lFakeEngine

afterEach(() => {
  delete (globalThis as unknown as { __q2lFakeEngine?: unknown }).__q2lFakeEngine
  vi.unstubAllGlobals()
})

describe('fake engine', () => {
  it('the fake engine counts what the host does to it', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 200
    canvas.getContext = (() => null) as typeof canvas.getContext

    const raw = await factory({ canvas, noInitialRun: true, locateFile: (p) => p })
    const host = adaptEngineModule(raw, canvas)
    expect(counters().instances).toBe(1)

    host.resumeLoop()
    expect(counters().loopRunning).toBe(true)
    frames[0]?.(0)
    expect(frames).toHaveLength(2)
    host.pauseLoop()
    expect(counters().loopRunning).toBe(false)

    host.resize()
    expect(counters().resizes).toBe(1)
    expect(counters().lastResize).toEqual({ width: 320, height: 200 })

    host.disconnect()
    raw.ccall('q2l_console', null, ['string'], ['status'])
    expect(counters().disconnects).toBe(1)

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(counters().keyEvents).toBe(1)

    await factory({
      canvas: document.createElement('canvas'),
      noInitialRun: true,
      locateFile: (p) => p,
    })
    expect(counters().instances).toBe(2)
  })
})

describe('fake engine console', () => {
  const boot = async (print: (t: string) => void) => {
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const canvas = document.createElement('canvas')
    canvas.getContext = (() => null) as typeof canvas.getContext
    return factory({ canvas, noInitialRun: true, locateFile: (p) => p, print, printErr: print })
  }

  it('an exec prints Execing like Q2PRO', async () => {
    const lines: string[] = []
    const raw = await boot((t) => lines.push(t))
    runConsole(raw, 'exec autoexec.cfg;bogus 1\nset game mod')
    expect(lines).toEqual(['Execing autoexec.cfg', 'Unknown command "bogus"'])
    expect(counters().cvars.game).toBe('mod')
  })

  it('a demo reaches its end and keeps the last picture', async () => {
    vi.useFakeTimers()
    try {
      const lines: string[] = []
      const raw = await boot((t) => lines.push(t))
      raw.FS.mkdirTree('/q2/mod/demos')
      raw.FS.writeFile('/q2/mod/demos/a.dm2', new Uint8Array(7))
      expect(raw.FS.stat('/q2/mod/demos/a.dm2').size).toBe(7)

      runConsole(raw, 'demo a.dm2')
      expect(lines).toEqual(["Couldn't open demos/a.dm2"])

      raw.callMain(['+set', 'game', 'mod', '+demo', 'a.dm2'])
      expect(counters().mainArgs).toHaveLength(1)
      expect(raw._q2l_demo_eof()).toBe(0)
      vi.advanceTimersByTime(1499)
      expect(raw._q2l_demo_eof()).toBe(0)
      vi.advanceTimersByTime(1)
      expect(raw._q2l_demo_eof()).toBe(1)

      runConsole(raw, 'disconnect')
      expect(raw._q2l_demo_eof()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('unlinking a file makes the demo unopenable again', async () => {
    const lines: string[] = []
    const raw = await boot((t) => lines.push(t))
    raw.FS.writeFile('/q2/baseq2/demos/b.dm2', 'xy')
    raw.FS.unlink('/q2/baseq2/demos/b.dm2')
    expect(raw.FS.analyzePath('/q2/baseq2/demos/b.dm2').exists).toBe(false)
    runConsole(raw, 'demo b.dm2')
    expect(lines).toEqual(["Couldn't open demos/b.dm2"])
  })
})
