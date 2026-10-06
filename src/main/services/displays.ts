import type { BrowserWindow, Display, Rectangle, Screen } from 'electron'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayInfo {
  id: number
  bounds: Rect
  scaleFactor: number
}

/** Read-only view of the screen: the only path to electron's `screen` for modules. (story 209) */
export interface DisplaysService {
  primary(): DisplayInfo
  all(): DisplayInfo[]
  /**
   * DIP rect to physical screen pixels; `'main'` anchors it to the main window, `null` to the
   * display the rect itself sits on (so a display's own bounds convert at that display's scale).
   */
  dipToScreenRect(rect: Rect, window: 'main' | null): Rect
}

/** `dipToScreenRect` is optional: Electron only ships it on Windows and Linux. */
export type ScreenLike = Pick<
  Screen,
  'getPrimaryDisplay' | 'getAllDisplays' | 'getDisplayMatching'
> & {
  dipToScreenRect?: (window: BrowserWindow | null, rect: Rectangle) => Rectangle
}

const info = (d: Display): DisplayInfo => ({
  id: d.id,
  bounds: { ...d.bounds },
  scaleFactor: d.scaleFactor,
})

export function createDisplaysService(deps: {
  screen: ScreenLike
  getMainWindow: () => BrowserWindow | null
}): DisplaysService {
  const { screen, getMainWindow } = deps
  return {
    primary: () => info(screen.getPrimaryDisplay()),
    all: () => screen.getAllDisplays().map(info),
    dipToScreenRect(rect, window) {
      const win = window === 'main' ? getMainWindow() : null
      if (typeof screen.dipToScreenRect === 'function') return screen.dipToScreenRect(win, rect)
      // Without the native API, a rect scales by its anchor display's factor: the window's display
      // for 'main', else the display the rect overlaps most - on a mixed-DPI desktop the primary
      // display's factor would misplace every rect that lies on another display.
      const display = screen.getDisplayMatching(win ? win.getContentBounds() : rect)
      const scale = display.scaleFactor
      return {
        x: rect.x * scale,
        y: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      }
    },
  }
}
