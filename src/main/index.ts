import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, protocol, session } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { createAppContext, type AppContext } from './context'
import { registerAllIpc } from './ipc'
import { logger } from './lib/logger'
import {
  DEV_CSP,
  PRODUCTION_CSP,
  RENDERER_INDEX_URL,
  RENDERER_SCHEME,
  createRendererProtocolHandler,
  resolveRendererSource,
  type RendererSource,
} from './lib/renderer-source'
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

  // Makes Windows attribute notifications and the taskbar entry to us.
  electronApp.setAppUserModelId(APP_USER_MODEL_ID)
  applySecurityPolicies(currentRendererSource())

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  context = await createAppContext({ isDev: is.dev })
  registerAllIpc(context)
  mainWindow = await createMainWindow(context)

  // Re-check every installation once the UI can display the result: a folder may
  // have been deleted, moved or unplugged while the launcher was closed.
  mainWindow.window.webContents.once('did-finish-load', () => {
    void revalidateOnStartup(context!)
  })

  app.on('activate', () => {
    // macOS: re-create the window after the last one was closed.
    if (BrowserWindow.getAllWindows().length === 0 && context) {
      void createMainWindow(context).then((created) => {
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
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  return resolveRendererSource({ isDev: Boolean(devServerUrl), devServerUrl })
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

app.on('before-quit', () => {
  // Geometry and state are written asynchronously; make sure they land.
  void Promise.all([mainWindow?.settle(), context?.state.settle()])
})

process.on('uncaughtException', (error) => {
  logger.error('uncaught exception in main process', error)
})
