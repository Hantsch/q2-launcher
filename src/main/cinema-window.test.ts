import { beforeEach, describe, expect, it, vi } from 'vitest'

type Mock = ReturnType<typeof vi.fn>
let failLoad = false
const created: Array<{ options: Record<string, unknown>; win: Record<string, Mock> }> = []

vi.mock('electron', () => {
  class BrowserWindow {
    handlers: Record<string, () => void> = {}
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() }
    setAlwaysOnTop = vi.fn()
    show = vi.fn()
    showInactive = vi.fn()
    isDestroyed = vi.fn(() => false)
    loadURL = vi.fn(async () => {
      if (failLoad) throw new Error('load failed')
    })
    close = vi.fn(() => this.handlers['closed']?.())
    on = vi.fn((event: string, cb: () => void) => void (this.handlers[event] = cb))
    once = vi.fn((event: string, cb: () => void) => void (this.handlers[event] = cb))
    constructor(options: Record<string, unknown>) {
      created.push({ options, win: this as unknown as Record<string, Mock> })
    }
  }
  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
  return {
    BrowserWindow,
    shell: { openExternal: vi.fn() },
    screen: { getPrimaryDisplay: () => display, getAllDisplays: () => [display] },
    app: { isPackaged: false },
  }
})

vi.mock('./lib/logger', () => ({
  scopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

async function load(harness: boolean) {
  vi.resetModules()
  created.length = 0
  if (harness) process.env['Q2L_UI_HARNESS'] = '1'
  else delete process.env['Q2L_UI_HARNESS']
  const { createCinemaWindow } = await import('./cinema-window')
  const { rendererWebPreferences } = await import('./window-shared')
  const { resolveUiHarness } = await import('./lib/ui-harness')
  const harnessGate = resolveUiHarness(process.env)
  return { service: createCinemaWindow(harnessGate, { kind: 'scheme' }), rendererWebPreferences, harnessGate }
}

describe('cinema window', () => {
  beforeEach(() => {
    delete process.env['Q2L_UI_VISIBLE']
  })

  it("the overlay window uses the main window's preload and webPreferences", async () => {
    const { service, rendererWebPreferences, harnessGate } = await load(false)
    await service.open()

    const { options, win } = created[0]!
    expect(options['webPreferences']).toEqual(rendererWebPreferences(harnessGate))
    expect(options['webPreferences']).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    })
    expect(String((options['webPreferences'] as { preload: string }).preload)).toMatch(
      /preload[\\/]index\.js$/,
    )
    expect(options).toMatchObject({
      frame: false,
      transparent: true,
      skipTaskbar: true,
      width: 1920,
      height: 1080,
    })
    expect(options).not.toHaveProperty('focusable')
    expect(win['setAlwaysOnTop']).toHaveBeenCalledWith(true, 'screen-saver')
  })

  it('under the harness the overlay is not focusable', async () => {
    const { service } = await load(true)
    await service.open()

    const { options, win } = created[0]!
    expect(options['focusable']).toBe(false)
    expect((options['x'] as number) + (options['width'] as number)).toBeLessThan(0)
    const readyToShow = win['once']!.mock.calls.find(([event]) => event === 'ready-to-show')!
    ;(readyToShow[1] as () => void)()
    expect(win['showInactive']).toHaveBeenCalled()
    expect(win['show']).not.toHaveBeenCalled()
  })

  it('a failed overlay load closes the window', async () => {
    const { service } = await load(false)
    const closed = vi.fn()
    service.onClosed(closed)
    failLoad = true
    try {
      await expect(service.open()).rejects.toThrow('load failed')
    } finally {
      failLoad = false
    }
    expect(created[0]!.win['close']).toHaveBeenCalled()
    expect(service.isOpen()).toBe(false)
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('tracks open state and notifies onClosed once', async () => {
    const { service } = await load(false)
    const closed = vi.fn()
    service.onClosed(closed)
    expect(service.isOpen()).toBe(false)
    await service.open()
    await service.open()
    expect(created).toHaveLength(1)
    expect(service.isOpen()).toBe(true)
    service.close()
    expect(service.isOpen()).toBe(false)
    expect(closed).toHaveBeenCalledTimes(1)
  })
})
