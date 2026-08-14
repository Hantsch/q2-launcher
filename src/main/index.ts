import { BrowserWindow, app, session } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { createAppContext, type AppContext } from './context'
import { registerAllIpc } from './ipc'
import { logger } from './lib/logger'
import { createMainWindow, type MainWindow } from './window'

const APP_USER_MODEL_ID = 'io.github.hantsch.q2launcher'

let context: AppContext | null = null
let mainWindow: MainWindow | null = null

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
  applySecurityPolicies()

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
 * Defence in depth for the renderer: a strict CSP, no permission grants, and no
 * navigation away from our own content. The renderer is local, trusted code -
 * these are the guardrails that keep it that way if a dependency turns hostile.
 */
function applySecurityPolicies(): void {
  const policy = is.dev
    ? // The dev server needs inline/eval for React Fast Refresh and a websocket for HMR.
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })

  // The launcher needs no camera, microphone, geolocation or notifications.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => {
    done(false)
  })
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
