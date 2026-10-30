import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, protocol, screen, session } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { createCinemaWindow } from './cinema-window'
import { boot } from './boot'
import { createAppContext, createAppShell, type AppContext } from './context'
import { createMainWindowEvents } from './main-window-observer'
import { bindAllChannels, markIpcFailed, markIpcReady, registerAllIpc } from './ipc'
import { logger } from './lib/logger'
import { resolveResourcePath } from './lib/resource-path'
import {
  DEV_CSP,
  PRODUCTION_CSP,
  RENDERER_INDEX_URL,
  RENDERER_SCHEME,
  createRendererProtocolHandler,
  rendererSourceFromEnv,
  type RendererSource,
} from './lib/renderer-source'
import { getNewsImagesCacheDir } from './lib/news-image-paths'
import { installShutdown } from './shutdown'
import { createMainWindow, type MainWindow } from './window'

const APP_USER_MODEL_ID = 'io.github.hantsch.q2launcher'

let context: AppContext | null = null
let mainWindow: MainWindow | null = null

/**
 * Must run at module load, not in `bootstrap()`: Electron only reads this registry while it builds
 * the scheme table on the way to `ready`, and a call that arrives afterwards is ignored without an
 * error - the scheme would then have no origin, no secure context and no fetch support, which
 * shows up as a blank window rather than as a failure.
 *
 * Privileges are deliberately the minimum the renderer needs (story 035): `standard` gives the
 * scheme a real origin, so `'self'` means something and the built `./assets/...` tags resolve;
 * `secure` makes it a secure context; `supportFetchAPI` is what lets the document be fetched back
 * to read its own CSP header. `stream` and `codeCache` buy nothing for a few hundred KB of small
 * local files.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])

/**
 * The UI-verification harness places its window offscreen (`src/main/window.ts`). Chromium's
 * Windows occlusion tracking would then treat it as hidden and stop painting it, which stalls
 * screenshots - so the harness turns it off. Must be set before `ready`, hence module load.
 */
// exempt: runs before `createAppContext`
if (process.env['Q2L_UI_HARNESS'] === '1' && process.env['Q2L_UI_VISIBLE'] !== '1') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
}

/**
 * Only one launcher at a time: a second instance would fight over `state.json`
 * and could start the same installation twice.
 */
if (!app.requestSingleInstanceLock()) {
  logger.info('another instance is already running, exiting')
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = mainWindow?.window
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  // The one line every support log should have had anyway: which build is actually running. It is
  // also story 101's out-of-process oracle - after an AppImage self-update the launcher re-execs
  // itself through `$APPIMAGE`, so the relaunched process is a *different* process that no test
  // driver is still attached to; `scripts/linux-update-e2e.mjs` polls this line out of the log file
  // on disk to prove the new version really came back up. Logged after `whenReady()` because
  // `electron-log`'s file transport resolves its path from `app.getPath('logs')`.
  logger.info(`Q2 Launcher ${app.getVersion()} starting on ${process.platform}`)

  // Makes Windows attribute notifications and the taskbar entry to us.
  electronApp.setAppUserModelId(APP_USER_MODEL_ID)
  applySecurityPolicies(currentRendererSource())

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Story 171: the window's events reach modules through `context.mainWindow` (read-only);
  // `createMainWindow` gets the write side. Same late binding over `mainWindow` as below.
  const windowEvents = createMainWindowEvents({
    getWindow: () => {
      const win = mainWindow?.window
      if (!win) return null
      return {
        isDestroyed: () => win.isDestroyed(),
        getContentBounds: () => win.getContentBounds(),
        getBounds: () => win.getBounds(),
        getZoomFactor: () => win.webContents.getZoomFactor(),
        isMinimized: () => win.isMinimized(),
        isFocused: () => win.isFocused(),
      }
    },
    displayFor: (bounds) => {
      const { id, scaleFactor } = screen.getDisplayMatching(bounds)
      return { id, scaleFactor }
    },
    onListenerError: (error) => logger.warn(`main window listener failed: ${String(error)}`),
  })

  // The window and the context are built concurrently (story 322). Each step assigns its
  // module-level binding as soon as it exists, so `second-instance`, shutdown and the late-bound
  // getters below see it without waiting for the other half.
  const booted = await boot({
    bindIpc: bindAllChannels,
    createShell: () => createAppShell(process.env),
    createWindow: async (appShell) => {
      mainWindow = await createMainWindow(appShell, windowEvents.notify)
      return mainWindow
    },
    createContext: async (appShell) => {
      const created = await createAppContext({
        isDev: is.dev,
        shell: appShell,
        // Read at call time: `mainWindow` is null until `createMainWindow` has loaded the renderer.
        getMainWindow: () => mainWindow?.window ?? null,
        mainWindow: windowEvents.observer,
        screen,
        createCinemaWindow,
      })
      context = created.context
      return created
    },
    registerIpc: ({ context: ready, unlock }) => registerAllIpc(ready, unlock),
    markReady: markIpcReady,
    markFailed: markIpcFailed,
  })

  // `boot` resolves only once `createMainWindow()` has awaited `loadURL`, i.e. the renderer's own
  // `did-finish-load`: from here a broadcast reaches a loaded page instead of being dropped. A
  // `once('did-finish-load')` listener registered at this point would never fire (story 101).
  const ready = booted.context?.context ?? null
  if (ready) {
    // Re-check every installation once the UI can display the result: a folder may
    // have been deleted, moved or unplugged while the launcher was closed.
    void revalidateOnStartup(ready)

    // Story 097: the update-check's startup kick - fire-and-forget, after a short delay so it
    // never competes with the window's own first paint, and never awaited
    // (`scheduleStartupCheck()` itself returns synchronously; so startup is not blocked).
    setTimeout(() => {
      ready.update.scheduleStartupCheck()
    }, 3_000)
  }

  app.on('activate', () => {
    // macOS: re-create the window after the last one was closed. Needs only the shell, so it works
    // even when the context failed to start.
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow(booted.shell, windowEvents.notify).then((created) => {
        mainWindow = created
      })
    }
  })
}

async function revalidateOnStartup(app: AppContext): Promise<void> {
  const installations = await app.installations.validateAll()

  const broken = installations.filter(
    (installation) => installation.status === 'missing' || installation.status === 'invalid',
  )
  if (broken.length > 0) {
    app.broadcast.toast('warning', 'installations.toast.needsAttention', { count: broken.length })
  }

  if (app.state.recoveredFrom === 'backup') {
    app.broadcast.toast('warning', 'app.toast.stateRecoveredFromBackup')
  } else if (app.state.recoveredFrom === 'defaults') {
    app.broadcast.toast('error', 'app.toast.stateReset')
  }
}

/**
 * Where the renderer document comes from - and therefore which policy travels with it - is derived
 * from the dev server being present, not from `is.dev` (`is.dev` is `!app.isPackaged`, so an
 * unpackaged run *without* a dev server, i.e. the UI-verification harness, must still get the
 * production scheme and the production policy). `is.dev` keeps deciding everything else it decides
 * today: dev-only IPC registration and `appInfo.isDev`.
 *
 * `window.ts` derives the same value from the same function; it is pure, so the two agree.
 */
function currentRendererSource(): RendererSource {
  return rendererSourceFromEnv(process.env)
}

/**
 * Defence in depth for the renderer: a strict CSP, no permission grants, and no
 * navigation away from our own content. The renderer is local, trusted code -
 * these are the guardrails that keep it that way if a dependency turns hostile.
 */
function applySecurityPolicies(source: RendererSource): void {
  if (source.kind === 'dev-server') {
    // Only the dev server's HTTP responses pass through the network layer, so this hook is the
    // only way to attach a policy in that mode - and the only mode it ever fired in. The
    // production document is served by our own protocol handler below, which carries the CSP
    // itself; that is what stopped the policy from silently vanishing in a packaged build.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [DEV_CSP],
        },
      })
    })
    logger.info(`renderer source: dev server at ${source.url}, dev CSP via onHeadersReceived`)
  } else {
    serveRendererFromScheme()
    logger.info(`renderer source: ${RENDERER_INDEX_URL}, production CSP via protocol handler`)
  }

  // The launcher needs no camera, microphone, geolocation or notifications.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => {
    done(false)
  })
}

function serveRendererFromScheme(): void {
  protocol.handle(
    RENDERER_SCHEME,
    createRendererProtocolHandler({
      // The same base directory `window.loadFile(join(__dirname, '../renderer/index.html'))` used:
      // main runs as `out/main/index.js` and the renderer bundle sits beside it in `out/renderer/`.
      // electron-builder packs `out/` into `app.asar` unchanged, so the relative step holds inside
      // the archive too - and `fs.readFile` reads asar paths transparently.
      root: join(__dirname, '../renderer'),
      csp: PRODUCTION_CSP,
      readFile: (path) => readFile(path),
      // Story 084: cached slide images are served from their own root under `userData`, on the
      // same origin as the document (a second host would be a second origin and `img-src 'self'`
      // would need widening). The directory need not exist yet - it is created when the first
      // image is fetched, and until then every request here is simply a 404.
      newsImages: {
        root: getNewsImagesCacheDir(app.getPath('userData')),
        readFile: (path) => readFile(path),
      },
      // Engine artefacts ship under resources/engine. Nothing is read at boot; a
      // missing file is only noticed (and logged once) on the first request for it (story 288).
      engine: (() => {
        const engineRoot = resolveResourcePath(
          { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath },
          'engine',
        )
        return {
          root: engineRoot,
          readFile: (path: string) => readFile(path),
          onMissing: () => logger.warn(`engine artifacts missing: ${engineRoot}`),
        }
      })(),
    }),
  )

  // `protocol.handle` throws on a duplicate registration but says nothing about a scheme that was
  // never privileged, and this story exists because a security guardrail failed open quietly once
  // already. Fail the boot loudly instead of showing a blank window with no policy.
  if (!protocol.isProtocolHandled(RENDERER_SCHEME)) {
    throw new Error(`[renderer] no handler registered for ${RENDERER_SCHEME}://`)
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Registered at module load, like the quit handlers above; `context` and `mainWindow` are read at
// quit time and may still be null if quit arrives during boot.
installShutdown({
  app,
  log: logger,
  // The launcher lets go of any playback session's pipe; the game keeps running.
  releasePlayback: () => context?.launch.releasePlaybackSession(),
  disposeModules: async () => {
    await context?.modules.disposeAll()
  },
  settles: [
    { label: 'state', run: async () => (await context?.state.settle()) ?? { ok: true } },
    { label: 'window state', run: async () => (await mainWindow?.settle()) ?? { ok: true } },
    { label: 'persistence', run: async () => (await context?.persistence.settleAll()) ?? [] },
  ],
})

process.on('uncaughtException', (error) => {
  logger.error('uncaught exception in main process', error)
})
