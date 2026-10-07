import { join } from 'node:path'
import { shell, type BrowserWindow, type WebPreferences } from 'electron'
import { scopedLogger } from './lib/logger'
import type { UiHarness } from './lib/ui-harness'
import { RENDERER_ORIGIN, type RendererSource } from './lib/renderer-source'

const log = scopedLogger('window')

/** Gap between an offscreen harness window and the leftmost display, so no border pixel peeks in. */
export const OFFSCREEN_MARGIN = 100

/**
 * The one set of `webPreferences` every launcher window uses (main window and cinema overlay): same
 * preload, isolated, sandboxed, no node. An offscreen harness window has to keep rendering at full
 * rate for screenshots and timers, hence the throttling switch.
 */
export function rendererWebPreferences(harness: UiHarness): WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
    ...(harness.offscreen ? { backgroundThrottling: false } : {}),
  }
}

/**
 * Nothing in the launcher should ever navigate a window or open a popup; external links go to the
 * user's browser instead.
 */
export function hardenWebContents(window: BrowserWindow, source: RendererSource): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    // Our own content is the dev server in dev mode and `q2launcher://app/` otherwise - the
    // trailing slash keeps a look-alike host such as `q2launcher://appx/` out. This is also what
    // keeps a self-navigation to the same document alive: the harness's `page.reload()` and the
    // ErrorBoundary's `location.reload()`.
    const allowed =
      source.kind === 'dev-server'
        ? url.startsWith(source.url)
        : url.startsWith(`${RENDERER_ORIGIN}/`)
    if (!allowed) {
      event.preventDefault()
      log.warn(`blocked navigation to ${url}`)
    }
  })
}
