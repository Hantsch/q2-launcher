// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import { EngineCanvas } from './EngineCanvas'
import type { EngineLoader } from './engine-loader'
import type { EngineHost, RawEngineModule } from './engine-module'

let frames: Map<number, FrameRequestCallback>
let nextFrame: number
let cssSize: { width: number; height: number }

function fakeLoader() {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('data-testid', 'replays-engine-canvas')
  vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(
    () => ({ ...cssSize, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0 }) as DOMRect,
  )
  const host: EngineHost = {
    canvas,
    module: {} as RawEngineModule,
    resize: vi.fn(),
    pauseLoop: vi.fn(),
    resumeLoop: vi.fn(),
    disconnect: vi.fn(),
  }
  let resolveLoad: (h: EngineHost) => void = () => {}
  const loaded = new Promise<EngineHost>((resolve) => (resolveLoad = resolve))
  const loader: EngineLoader = { load: vi.fn(() => loaded), discard: vi.fn() }
  return { host, loader, finishLoad: () => act(async () => resolveLoad(host)) }
}

function runFrame(): void {
  const [id, cb] = [...frames.entries()][0] ?? []
  if (id === undefined || !cb) return
  frames.delete(id)
  act(() => cb(0))
}

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  frames = new Map()
  nextFrame = 1
  cssSize = { width: 400.3, height: 300.2 }
  vi.stubGlobal('devicePixelRatio', 1.5)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('EngineCanvas', () => {
  it('a resize sets the buffer to CSS size times devicePixelRatio and tells the engine', async () => {
    const { host, loader, finishLoad } = fakeLoader()
    render(<EngineCanvas loader={loader} />)
    await finishLoad()

    expect(screen.getByRole('img', { name: 'Demo playback, 3D view' }).contains(host.canvas)).toBe(
      true,
    )
    expect(host.canvas.hasAttribute('tabindex')).toBe(false)
    expect(host.resumeLoop).toHaveBeenCalledOnce()
    expect([host.canvas.width, host.canvas.height]).toEqual([600, 450])
    expect(host.resize).toHaveBeenCalledTimes(1)

    runFrame()
    expect(host.resize).toHaveBeenCalledTimes(1)

    cssSize = { width: 401, height: 300.2 }
    runFrame()
    expect([host.canvas.width, host.canvas.height]).toEqual([602, 450])
    expect(host.resize).toHaveBeenCalledTimes(2)
  })

  it('unmounting stops the loop and disconnects the engine', async () => {
    const { host, loader, finishLoad } = fakeLoader()
    const view = render(<EngineCanvas loader={loader} />)
    await finishLoad()
    view.unmount()

    expect(frames.size).toBe(0)
    expect(host.pauseLoop).toHaveBeenCalledOnce()
    expect(host.disconnect).toHaveBeenCalledOnce()
    expect(host.canvas.isConnected).toBe(false)
    expect(loader.discard).not.toHaveBeenCalled()
  })

  it('a load that finishes after unmount is never attached or driven', async () => {
    const { host, loader, finishLoad } = fakeLoader()
    const view = render(<EngineCanvas loader={loader} />)
    view.unmount()
    await finishLoad()

    expect(host.canvas.isConnected).toBe(false)
    expect(host.resumeLoop).not.toHaveBeenCalled()
    expect(host.resize).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })

  it('a failed engine load shows the retry text', async () => {
    const loader: EngineLoader = {
      load: vi.fn(() => Promise.reject(new Error('boom'))),
      discard: vi.fn(),
    }
    render(<EngineCanvas loader={loader} />)
    await act(async () => {})

    expect(screen.getByRole('status').textContent).toBe(
      'The 3D view could not be started. Press Play to retry.',
    )
  })

  it('a lost WebGL context shows the restart text', async () => {
    const { host, loader, finishLoad } = fakeLoader()
    render(<EngineCanvas loader={loader} />)
    await finishLoad()

    const event = new Event('webglcontextlost', { cancelable: true })
    act(() => {
      host.canvas.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(host.pauseLoop).toHaveBeenCalled()
    expect(loader.discard).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    expect(screen.getByRole('status').textContent).toBe(
      'The 3D view was lost. Press Play to restart.',
    )
  })
})
