import type { BrowserWindow, Display } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createDisplaysService, type ScreenLike } from './displays'

const display = (id: number, scaleFactor: number, x = 0): Display =>
  ({ id, scaleFactor, bounds: { x, y: 0, width: 1920, height: 1080 } }) as Display

const win = { getContentBounds: () => ({ x: 2000, y: 0, width: 800, height: 600 }) } as BrowserWindow
const primary = display(1, 1)
const second = display(2, 2, 1920)

function screenOf(extra: Partial<ScreenLike> = {}): ScreenLike {
  return {
    getPrimaryDisplay: () => primary,
    getAllDisplays: () => [primary, second],
    getDisplayMatching: (rect) => (rect.x >= second.bounds.x ? second : primary),
    ...extra,
  }
}

describe('displays service', () => {
  it('dipToScreenRect uses the screen API when present and the display scale factor otherwise', () => {
    const rect = { x: 1, y: 2, width: 10, height: 20 }
    const native = vi.fn(() => ({ x: 9, y: 9, width: 9, height: 9 }))
    const withApi = createDisplaysService({
      screen: screenOf({ dipToScreenRect: native }),
      getMainWindow: () => win,
    })
    expect(withApi.dipToScreenRect(rect, 'main')).toEqual({ x: 9, y: 9, width: 9, height: 9 })
    expect(native).toHaveBeenCalledWith(win, rect)
    withApi.dipToScreenRect(rect, null)
    expect(native).toHaveBeenLastCalledWith(null, rect)

    const without = createDisplaysService({ screen: screenOf(), getMainWindow: () => win })
    expect(without.dipToScreenRect(rect, 'main')).toEqual({ x: 2, y: 4, width: 20, height: 40 })
    expect(without.dipToScreenRect(rect, null)).toEqual(rect)
    // A null anchor converts at the scale of the display the rect sits on, not the primary's.
    expect(without.dipToScreenRect(second.bounds, null)).toEqual({
      x: 3840,
      y: 0,
      width: 3840,
      height: 2160,
    })
  })

  it('primary and all list the screen displays', () => {
    const service = createDisplaysService({ screen: screenOf(), getMainWindow: () => null })
    expect(service.primary()).toEqual({ id: 1, bounds: primary.bounds, scaleFactor: 1 })
    expect(service.all().map((d) => [d.id, d.scaleFactor])).toEqual([
      [1, 1],
      [2, 2],
    ])
  })
})
