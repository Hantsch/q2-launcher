import { app as electronApp, shell } from 'electron'
import { fail, ok, type AppInfo, type Platform } from '@shared/types'
import { isDirectory } from '../lib/fs-utils'
import { logFilePath } from '../lib/logger'
import { userDataDir } from '../lib/paths'
import { urlSchema } from '../lib/schemas'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerAppIpc(app: AppContext): void {
  handle('app:getInfo', (): AppInfo => {
    return {
      appVersion: electronApp.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      platform: process.platform as Platform,
      userDataPath: userDataDir(),
      logPath: logFilePath(),
      isDev: app.isDev,
      isPackaged: electronApp.isPackaged,
    }
  })

  handle('app:openExternal', async (url) => {
    // Only http(s): a renderer must not be able to open `file:` or a custom
    // protocol handler through this channel.
    const parsed = urlSchema.safeParse(url)
    if (!parsed.success) return fail('app.error.invalidUrl')
    await shell.openExternal(parsed.data)
    return ok(null)
  })

  handle('app:revealPath', async (target) => {
    if (typeof target !== 'string' || target.length === 0) {
      return fail('app.error.invalidPath')
    }
    // Renderer-supplied paths are never trusted: only folders the launcher
    // already knows about may be revealed.
    if (!isAllowedRevealTarget(app, target)) {
      return fail('app.error.pathNotAllowed')
    }

    if (await isDirectory(target)) {
      const error = await shell.openPath(target)
      return error ? fail('app.error.revealFailed', { message: error }) : ok(null)
    }
    shell.showItemInFolder(target)
    return ok(null)
  })
}

/** A path is revealable if it sits under a registered installation or our own data dirs. */
function isAllowedRevealTarget(app: AppContext, target: string): boolean {
  const roots = [
    userDataDir(),
    logFilePath(),
    ...app.installations
      .list()
      .flatMap((installation) => [
        installation.rootPath,
        ...(installation.writeDirPath ? [installation.writeDirPath] : []),
        ...(installation.executablePath ? [installation.executablePath] : []),
      ]),
  ]

  const normalize = (value: string): string =>
    process.platform === 'linux' ? value : value.toLowerCase()
  const candidate = normalize(target)
  return roots.some((root) => candidate.startsWith(normalize(root)))
}
