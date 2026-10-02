import { createListenerSet } from './lib/listeners'

/**
 * Story 171 D2: a read-only view of the main window for modules - its current content bounds, scale,
 * minimized and focused state, and the window events that change them. Modules never touch the
 * `BrowserWindow`; `window.ts` forwards the events through `notify`, the shell's write side.
 */
export type MainWindowEvent = 'move' | 'resize' | 'minimize' | 'restore' | 'focus' | 'blur'

export interface MainWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface MainWindowSnapshot {
  /** DIP content bounds; while minimized, the last bounds the window had before it was minimized. */
  contentBounds: MainWindowBounds
  /** DIP outer window bounds; same last-un-minimized rule as `contentBounds`. */
  bounds: MainWindowBounds
  zoomFactor: number
  /** The display the content bounds sit on. */
  displayId: number
  scaleFactor: number
  minimized: boolean
  focused: boolean
}

export interface MainWindowObserver {
  /** Null while there is no (live) main window. */
  snapshot(): MainWindowSnapshot | null
  /** Subscribes to the window's events; returns the unsubscribe. */
  on(listener: (event: MainWindowEvent) => void): () => void
}

/** The slice of `BrowserWindow` the observer reads. */
export interface ObservedWindow {
  isDestroyed(): boolean
  getContentBounds(): MainWindowBounds
  getBounds(): MainWindowBounds
  getZoomFactor(): number
  isMinimized(): boolean
  isFocused(): boolean
}

export interface MainWindowEvents {
  observer: MainWindowObserver
  notify(event: MainWindowEvent): void
}

export function createMainWindowEvents(deps: {
  getWindow: () => ObservedWindow | null
  displayFor: (bounds: MainWindowBounds) => { id: number; scaleFactor: number }
  onListenerError?: (error: unknown) => void
}): MainWindowEvents {
  const listeners = createListenerSet<MainWindowEvent>(
    { error: (_message, error) => deps.onListenerError?.(error) },
    'main window',
  )
  let lastBounds: MainWindowBounds | null = null
  let lastOuterBounds: MainWindowBounds | null = null
  // Focus follows the focus/blur events once one has arrived; before that the window is asked.
  let focusedByEvent: boolean | null = null

  const live = (): ObservedWindow | null => {
    const win = deps.getWindow()
    return win && !win.isDestroyed() ? win : null
  }

  const snapshot = (): MainWindowSnapshot | null => {
    const win = live()
    if (!win) return null
    const minimized = win.isMinimized()
    if (!minimized || lastBounds === null || lastOuterBounds === null) {
      lastBounds = { ...win.getContentBounds() }
      lastOuterBounds = { ...win.getBounds() }
    }
    const contentBounds = { ...lastBounds }
    const display = deps.displayFor(contentBounds)
    return {
      contentBounds,
      bounds: { ...lastOuterBounds },
      zoomFactor: win.getZoomFactor(),
      displayId: display.id,
      scaleFactor: display.scaleFactor,
      minimized,
      focused: focusedByEvent ?? win.isFocused(),
    }
  }

  return {
    observer: {
      snapshot,
      on: (listener) => listeners.add(listener),
    },
    notify(event) {
      if (event === 'focus') focusedByEvent = true
      else if (event === 'blur') focusedByEvent = false
      const win = live()
      if (win && !win.isMinimized()) {
        lastBounds = { ...win.getContentBounds() }
        lastOuterBounds = { ...win.getBounds() }
      }
      listeners.emit(event)
    },
  }
}
