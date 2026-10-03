import { BrowserWindow, screen } from 'electron'
import { createListenerSet } from './lib/listeners'
import { scopedLogger } from './lib/logger'
import type { UiHarness } from './lib/ui-harness'
import { rendererCinemaUrl, type RendererSource } from './lib/renderer-source'
import { hardenWebContents, OFFSCREEN_MARGIN, rendererWebPreferences } from './window-shared'

const log = scopedLogger('cinema-window')

/**
 * Story 187 D4: the cinema overlay - a transparent, frameless window laid over the primary display
 * (over the borderless full-display game), showing the renderer's `cinema.html`. A narrow shell
 * service like the main-window observer: modules ask for `open()`/`close()`, they never touch a
 * `BrowserWindow`. Uses the same preload and `webPreferences` as the main window.
 */
export interface CinemaWindow {
  /** Opens the overlay; resolves once its page has loaded. A no-op while one is already open. */
  open: () => Promise<void>
  close: () => void
  isOpen: () => boolean
  /** Puts the open overlay back on top and focuses it; a no-op while closed. */
  raise: () => void
  /** Runs `cb` whenever the overlay closes, however it got closed. Returns an unsubscribe. */
  onClosed: (cb: () => void) => () => void
}

export function createCinemaWindow(
  harness: UiHarness,
  rendererSource: RendererSource,
): CinemaWindow {
  let window: BrowserWindow | null = null
  const listeners = createListenerSet(log, 'cinema onClosed')

  const isOpen = (): boolean => window !== null && !window.isDestroyed()

  const open = async (): Promise<void> => {
    if (isOpen()) return
    const displays = screen.getAllDisplays()
    const bounds = screen.getPrimaryDisplay().bounds
    // Harness: placed left of every display, same size, so a run never covers the desktop.
    const position = harness.offscreen
      ? {
          x:
            Math.min(...displays.map((display) => display.bounds.x)) -
            bounds.width -
            OFFSCREEN_MARGIN,
          y: 0,
        }
      : { x: bounds.x, y: bounds.y }

    const created = new BrowserWindow({
      ...position,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      show: false,
      // Harness: painted but never activated, like the main window.
      ...(harness.enabled ? { focusable: false } : {}),
      webPreferences: rendererWebPreferences(harness),
    })
    window = created
    created.setAlwaysOnTop(true, 'screen-saver')
    hardenWebContents(created, rendererSource)

    created.on('closed', () => {
      if (window === created) window = null
      listeners.emit()
    })

    created.once('ready-to-show', () => {
      if (created.isDestroyed()) return
      if (harness.enabled) created.showInactive()
      else created.show()
    })

    try {
      await created.loadURL(rendererCinemaUrl(rendererSource))
    } catch (error) {
      // A page that never loaded must not stay up as an always-on-top blank overlay.
      if (!created.isDestroyed()) created.close()
      if (window === created) window = null
      throw error
    }
  }

  const close = (): void => {
    if (window && !window.isDestroyed()) window.close()
  }

  const raise = (): void => {
    if (!window || window.isDestroyed()) return
    window.moveTop()
    window.focus()
  }

  return {
    open,
    close,
    isOpen,
    raise,
    onClosed: (cb) => listeners.add(cb),
  }
}
