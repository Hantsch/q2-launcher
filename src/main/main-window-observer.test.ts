import { describe, expect, it, vi } from 'vitest'
import {
  createMainWindowEvents,
  type MainWindowEvent,
  type ObservedWindow,
} from './main-window-observer'

function fakeWin(
  over: Partial<{
    bounds: { x: number; y: number; width: number; height: number }
    minimized: boolean
    focused: boolean
    destroyed: boolean
    outer: { x: number; y: number; width: number; height: number }
    zoom: number
  }> = {},
) {
  const s = {
    bounds: { x: 1, y: 2, width: 300, height: 200 },
    outer: { x: 0, y: 0, width: 320, height: 240 },
    zoom: 1,
    minimized: false,
    focused: false,
    destroyed: false,
    ...over,
  }
  const win: ObservedWindow = {
    isDestroyed: () => s.destroyed,
    getContentBounds: () => ({ ...s.bounds }),
    getBounds: () => ({ ...s.outer }),
    getZoomFactor: () => s.zoom,
    isMinimized: () => s.minimized,
    isFocused: () => s.focused,
  }
  return { s, win }
}

describe('main window observer', () => {
  it('has no snapshot without a live window', () => {
    let current: ObservedWindow | null = null
    const { observer } = createMainWindowEvents({
      getWindow: () => current,
      displayFor: () => ({ id: 1, scaleFactor: 1 }),
    })
    expect(observer.snapshot()).toBeNull()
    const { s, win } = fakeWin({ destroyed: true })
    current = win
    expect(observer.snapshot()).toBeNull()
    s.destroyed = false
    expect(observer.snapshot()).toEqual({
      contentBounds: { x: 1, y: 2, width: 300, height: 200 },
      bounds: { x: 0, y: 0, width: 320, height: 240 },
      zoomFactor: 1,
      displayId: 1,
      scaleFactor: 1,
      minimized: false,
      focused: false,
    })
  })

  it('forwards events to subscribers until they unsubscribe; a throwing one does not stop the rest', () => {
    const { win } = fakeWin()
    const onListenerError = vi.fn()
    const { observer, notify } = createMainWindowEvents({
      getWindow: () => win,
      displayFor: () => ({ id: 1, scaleFactor: 1 }),
      onListenerError,
    })
    const seen: MainWindowEvent[] = []
    observer.on(() => {
      throw new Error('boom')
    })
    const off = observer.on((e) => seen.push(e))
    notify('move')
    off()
    notify('resize')
    expect(seen).toEqual(['move'])
    expect(onListenerError).toHaveBeenCalledTimes(2)
  })

  it('focus follows the focus/blur events once one arrived', () => {
    const { win } = fakeWin({ focused: false })
    const { observer, notify } = createMainWindowEvents({
      getWindow: () => win,
      displayFor: () => ({ id: 1, scaleFactor: 1 }),
    })
    expect(observer.snapshot()?.focused).toBe(false)
    notify('focus')
    expect(observer.snapshot()?.focused).toBe(true)
    notify('blur')
    expect(observer.snapshot()?.focused).toBe(false)
  })

  it('while minimized, reports the last un-minimized bounds and the scale for them', () => {
    const { s, win } = fakeWin()
    const displayFor = vi.fn(() => ({ id: 7, scaleFactor: 1.5 }))
    const { observer, notify } = createMainWindowEvents({ getWindow: () => win, displayFor })
    notify('move')
    s.minimized = true
    s.bounds = { x: -32000, y: -32000, width: 160, height: 28 }
    s.outer = { x: -32000, y: -32000, width: 160, height: 28 }
    notify('minimize')
    expect(observer.snapshot()).toEqual({
      contentBounds: { x: 1, y: 2, width: 300, height: 200 },
      bounds: { x: 0, y: 0, width: 320, height: 240 },
      zoomFactor: 1,
      displayId: 7,
      scaleFactor: 1.5,
      minimized: true,
      focused: false,
    })
    expect(displayFor).toHaveBeenLastCalledWith({ x: 1, y: 2, width: 300, height: 200 })
  })
})

describe('main window snapshot', () => {
  it('the snapshot carries zoom factor, outer bounds and display id', () => {
    const { win } = fakeWin({ zoom: 1.25, outer: { x: 5, y: 6, width: 400, height: 300 } })
    const { observer } = createMainWindowEvents({
      getWindow: () => win,
      displayFor: () => ({ id: 42, scaleFactor: 2 }),
    })
    expect(observer.snapshot()).toMatchObject({
      zoomFactor: 1.25,
      bounds: { x: 5, y: 6, width: 400, height: 300 },
      displayId: 42,
      scaleFactor: 2,
    })
  })
})
