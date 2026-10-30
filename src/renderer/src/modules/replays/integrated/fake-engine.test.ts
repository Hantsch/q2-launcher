// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adaptEngineModule } from './engine-module'
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
