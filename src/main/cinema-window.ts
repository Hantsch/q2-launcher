import { BrowserWindow, screen } from 'electron'
import { scopedLogger } from './lib/logger'
import { rendererCinemaUrl } from './lib/renderer-source'
import {
  hardenWebContents,
  IS_UI_HARNESS,
  IS_UI_HARNESS_OFFSCREEN,
  OFFSCREEN_MARGIN,
  RENDERER_SOURCE,
  rendererWebPreferences,
} from './window-shared'

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
  /** Runs `cb` whenever the overlay closes, however it got closed. Returns an unsubscribe. */
  onClosed: (cb: () => void) => () => void
}

export function createCinemaWindow(): CinemaWindow {
  let window: BrowserWindow | null = null
  const listeners = new Set<() => void>()

  const isOpen = (): boolean => window !== null && !window.isDestroyed()

  const open = async (): Promise<void> => {
    if (isOpen()) return
    const displays = screen.getAllDisplays()
    const bounds = screen.getPrimaryDisplay().bounds
    // Harness: placed left of every display, same size, so a run never covers the desktop.
    const position = IS_UI_HARNESS_OFFSCREEN
      ? {
          x: Math.min(...displays.map((display) => display.bounds.x)) - bounds.width - OFFSCREEN_MARGIN,
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
      ...(IS_UI_HARNESS ? { focusable: false } : {}),
      webPreferences: rendererWebPreferences(),
    })
    window = created
    created.setAlwaysOnTop(true, 'screen-saver')
    hardenWebContents(created)

    created.on('closed', () => {
      if (window === created) window = null
      for (const cb of [...listeners]) {
        try {
          cb()
        } catch (error) {
          log.warn(`cinema onClosed listener failed: ${String(error)}`)
        }
      }
    })

    created.once('ready-to-show', () => {
      if (created.isDestroyed()) return
      if (IS_UI_HARNESS) created.showInactive()
      else created.show()
    })

    try {
      await created.loadURL(rendererCinemaUrl(RENDERER_SOURCE))
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

  return {
    open,
    close,
    isOpen,
    onClosed: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}
