import { join } from 'node:path'
import { app as electronApp, BrowserWindow, screen, shell } from 'electron'
import {
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_DEFAULT_WIDTH,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
} from '@shared/constants'
import type { WindowState } from '@shared/types'
import { chromeState } from './lib/chrome-state'
import { JsonStore } from './lib/json-store'
import { scopedLogger } from './lib/logger'
import { windowStateFilePath } from './lib/paths'
import {
  RENDERER_INDEX_URL,
  RENDERER_ORIGIN,
  resolveRendererSource,
  type RendererSource,
} from './lib/renderer-source'
import { parseWindowState } from './lib/schemas'
import type { AppContext } from './context'

const log = scopedLogger('window')

/** The launcher's chrome colour, so the first frame is not a white flash. */
const BACKGROUND_COLOR = '#0b0b0d'

/**
 * Set to `1` by the UI-verification harness (`scripts/lib/harness.mjs`'s
 * `childEnv()`) in the app's environment, never in a normal or packaged launch.
 *
 * Read once at module load — the environment cannot change under a running
 * process, and a single lookup keeps the two places that branch on it from
 * disagreeing. Matched strictly against `'1'` so a stray `Q2L_UI_HARNESS=0`
 * cannot switch the launcher into a window that refuses focus.
 */
const IS_UI_HARNESS = process.env['Q2L_UI_HARNESS'] === '1'

/**
 * Which document this window loads, and what `will-navigate` therefore has to allow. Derived from
 * the dev server being present rather than from `is.dev` — see the same derivation in `index.ts`,
 * which decides the matching CSP from it. `resolveRendererSource` is pure, so both agree; read
 * once at module load for the same reason as `IS_UI_HARNESS` above.
 */
const RENDERER_SOURCE: RendererSource = resolveRendererSource({
  isDev: Boolean(process.env['ELECTRON_RENDERER_URL']),
  devServerUrl: process.env['ELECTRON_RENDERER_URL'],
})

/**
 * Build resources are not packed into the application automatically.
 * electron-builder copies the icon beside app.asar; development reads the
 * generated source asset directly from build/.
 */
function mainWindowIconPath(): string {
  const fileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  return electronApp.isPackaged
    ? join(process.resourcesPath, fileName)
    : join(__dirname, '../../build', fileName)
}

function defaultWindowState(): WindowState {
  return {
    width: WINDOW_DEFAULT_WIDTH,
    height: WINDOW_DEFAULT_HEIGHT,
    maximized: false,
    fullScreen: false,
  }
}

/**
 * Drops a saved position that is no longer on screen.
 *
 * Without this, unplugging the monitor the launcher was last used on leaves the
 * window restored off-screen with no way to get it back.
 */
function withVisiblePosition(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return state

  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      state.x! < area.x + area.width &&
      state.x! + state.width > area.x &&
      state.y! < area.y + area.height &&
      state.y! + state.height > area.y
    )
  })

  if (visible) return state
  log.info('saved window position is off-screen, centering instead')
  const { x: _x, y: _y, ...centered } = state
  return centered
}

export interface MainWindow {
  window: BrowserWindow
  /** Flushes pending geometry writes; call before quitting. */
  settle: () => Promise<void>
}

export async function createMainWindow(app: AppContext): Promise<MainWindow> {
  const store = new JsonStore<WindowState>({
    filePath: windowStateFilePath(),
    defaults: defaultWindowState,
    parse: parseWindowState,
    // Resizing fires continuously; one write per burst is plenty.
    debounceMs: 400,
  })

  const saved = withVisiblePosition(await store.load())

  const window = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    // Under the verification harness the window must be painted but never
    // activated, so it cannot steal the foreground from whoever started the run.
    // `focusable: false` is the OS-level half of that (WS_EX_NOACTIVATE on
    // Windows): the window is not activated on show and clicking it does not
    // raise it. Spread conditionally rather than passed as `focusable: true`, so
    // a normal launch hands Electron exactly the options it got before — Windows
    // also derives `skipTaskbar: true` from `focusable: false`.
    ...(IS_UI_HARNESS ? { focusable: false } : {}),
    backgroundColor: BACKGROUND_COLOR,
    icon: mainWindowIconPath(),
    // Fully custom chrome: the title bar is a React component, matching the
    // reference launchers. Trade-off: Windows 11 snap layouts (the flyout when
    // hovering the maximize button) are unavailable with `frame: false`, so the
    // title bar implements double-click-to-maximize instead.
    frame: false,
    autoHideMenuBar: true,
    title: 'Q2 Launcher',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })

  // --- geometry persistence -------------------------------------------------
  const persistGeometry = (): void => {
    if (window.isDestroyed()) return
    // `getNormalBounds` keeps the pre-maximize rectangle, which is what we want
    // to restore to when the user un-maximizes after a restart.
    const bounds = window.getNormalBounds()
    store.set({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
    })
  }

  const emitChromeState = (): void => {
    if (!window.isDestroyed()) app.broadcast.emit('window:state', chromeState(window))
  }

  const onGeometryChange = (): void => {
    persistGeometry()
    emitChromeState()
  }

  window.on('resize', persistGeometry)
  window.on('move', persistGeometry)
  window.on('maximize', onGeometryChange)
  window.on('unmaximize', onGeometryChange)
  window.on('enter-full-screen', onGeometryChange)
  window.on('leave-full-screen', onGeometryChange)
  window.on('focus', emitChromeState)
  window.on('blur', emitChromeState)
  window.on('close', persistGeometry)

  // --- navigation hardening -------------------------------------------------
  // Nothing in the launcher should ever navigate the window or open a popup;
  // external links go to the user's browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    // Our own content is the dev server in dev mode and `q2launcher://app/` otherwise — the
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

  window.once('ready-to-show', () => {
    if (saved.fullScreen) window.setFullScreen(true)
    else if (saved.maximized) window.maximize()
    // `show()` shows *and* focuses; `showInactive()` shows without asking for
    // activation. The harness path needs the second one — `focusable: false`
    // alone would leave Electron requesting a focus the window then refuses.
    if (IS_UI_HARNESS) window.showInactive()
    else window.show()
  })

  // Production loads over `q2launcher://`, not `loadFile`: a `file://` document has no origin the
  // header hook can reach, which is how the CSP came to be absent from every packaged build.
  if (RENDERER_SOURCE.kind === 'dev-server') {
    await window.loadURL(RENDERER_SOURCE.url)
  } else {
    await window.loadURL(RENDERER_INDEX_URL)
  }

  return {
    window,
    settle: () => store.settle(),
  }
}
