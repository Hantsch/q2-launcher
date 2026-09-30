import { join } from 'node:path'
import { shell, type BrowserWindow, type WebPreferences } from 'electron'
import { scopedLogger } from './lib/logger'
import { RENDERER_ORIGIN, resolveRendererSource, type RendererSource } from './lib/renderer-source'

const log = scopedLogger('window')

/**
 * Set to `1` by the UI-verification harness (`scripts/lib/harness.mjs`'s `childEnv()`), never in a
 * normal or packaged launch. Read once at module load; matched strictly against `'1'` so a stray
 * `Q2L_UI_HARNESS=0` cannot switch a window into one that refuses focus.
 */
export const IS_UI_HARNESS = process.env['Q2L_UI_HARNESS'] === '1'

/**
 * A harness window is placed left of every display, so a run neither steals focus nor paints over
 * the desktop of whoever started it. `Q2L_UI_VISIBLE=1` puts it back on screen for debugging.
 */
export const IS_UI_HARNESS_OFFSCREEN = IS_UI_HARNESS && process.env['Q2L_UI_VISIBLE'] !== '1'

/** Gap between an offscreen harness window and the leftmost display, so no border pixel peeks in. */
export const OFFSCREEN_MARGIN = 100

/**
 * Which document the windows load, and what `will-navigate` therefore has to allow. Derived from
 * the dev server being present rather than from `is.dev` - see the same derivation in `index.ts`.
 */
export const RENDERER_SOURCE: RendererSource = resolveRendererSource({
  isDev: Boolean(process.env['ELECTRON_RENDERER_URL']),
  devServerUrl: process.env['ELECTRON_RENDERER_URL'],
})

/**
 * The one set of `webPreferences` every launcher window uses (main window and cinema overlay): same
 * preload, isolated, sandboxed, no node. An offscreen harness window has to keep rendering at full
 * rate for screenshots and timers, hence the throttling switch.
 */
export function rendererWebPreferences(): WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
    ...(IS_UI_HARNESS_OFFSCREEN ? { backgroundThrottling: false } : {}),
  }
}

/**
 * Nothing in the launcher should ever navigate a window or open a popup; external links go to the
 * user's browser instead.
 */
export function hardenWebContents(window: BrowserWindow): void {
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
      RENDERER_SOURCE.kind === 'dev-server'
        ? url.startsWith(RENDERER_SOURCE.url)
        : url.startsWith(`${RENDERER_ORIGIN}/`)
    if (!allowed) {
      event.preventDefault()
      log.warn(`blocked navigation to ${url}`)
    }
  })
}
