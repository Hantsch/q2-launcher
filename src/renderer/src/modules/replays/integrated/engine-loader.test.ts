// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { consoleLines } from './engine-console'
import { createEngineLoader } from './engine-loader'
import type { EngineFactory, RawEngineModule } from './engine-module'

function setup() {
  const raw: RawEngineModule = {
    _q2l_resize: vi.fn(),
    pauseMainLoop: vi.fn(),
    resumeMainLoop: vi.fn(),
    ccall: vi.fn(),
    callMain: vi.fn(),
    FS: {
      mkdirTree: vi.fn(),
      writeFile: vi.fn(),
      unlink: vi.fn(),
      analyzePath: vi.fn(() => ({ exists: false })),
      stat: vi.fn(() => ({ size: 0 })),
    },
    _q2l_demo_eof: vi.fn(() => 0),
  }
  const factory = vi.fn<EngineFactory>(async () => raw)
  const importFactory = vi.fn(async () => factory)
  return { raw, factory, loader: createEngineLoader(importFactory) }
}

describe('engine loader', () => {
  it('a second load reuses the instantiated engine', async () => {
    const { factory, loader } = setup()
    const first = await loader.load()
    const second = await loader.load()
    expect(second).toBe(first)
    expect(factory).toHaveBeenCalledOnce()
    expect(first.canvas.id).toBe('q2l-engine-canvas')
    expect(factory.mock.calls[0][0].locateFile('q2pro.wasm')).toBe('/engine/q2pro.wasm')
  })

  it('pagehide discards the engine instance', async () => {
    const { factory, raw, loader } = setup()
    const first = await loader.load()
    window.dispatchEvent(new Event('pagehide'))
    expect(raw.pauseMainLoop).toHaveBeenCalledOnce()
    expect(raw.ccall).toHaveBeenCalledWith('q2l_console', null, ['string'], ['disconnect\n'])
    const next = await loader.load()
    expect(next).not.toBe(first)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('a load that resolves after discard is torn down', async () => {
    const { raw, loader } = setup()
    const pendingLoad = loader.load()
    loader.discard()
    const late = await pendingLoad
    expect(raw.pauseMainLoop).toHaveBeenCalledOnce()
    expect(raw.ccall).toHaveBeenCalledWith('q2l_console', null, ['string'], ['disconnect\n'])
    expect(late.canvas.isConnected).toBe(false)
  })
})

describe('engine loader console', () => {
  it('engine output reaches the ring buffer and production exposes no hook', async () => {
    const { factory, loader } = setup()
    await loader.load()
    const opts = factory.mock.calls[0][0]
    opts.print?.('hello')
    opts.printErr?.('oops')
    expect(consoleLines().slice(-2)).toEqual(['hello', 'oops'])
    expect('__q2lEngineConsole' in window).toBe(false)
  })

  it('the fixture engine switches on the console hook for flows', async () => {
    ;(globalThis as unknown as { __q2lFakeEngine: object }).__q2lFakeEngine = {}
    try {
      const { loader } = setup()
      await loader.load()
      expect((window as unknown as { __q2lEngineConsole: unknown }).__q2lEngineConsole).toBe(
        consoleLines,
      )
    } finally {
      delete (globalThis as unknown as { __q2lFakeEngine?: object }).__q2lFakeEngine
      delete (window as unknown as { __q2lEngineConsole?: unknown }).__q2lEngineConsole
    }
  })
})
