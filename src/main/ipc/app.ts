import { app as electronApp, clipboard, shell } from 'electron'
import { release } from 'node:os'
import { fail, ok, type AppInfo, type Platform } from '@shared/types'
import { isDirectory } from '../lib/fs-utils'
import { logFilePath } from '../lib/logger'
import { userDataDir } from '../lib/paths'
import { appCopyTextSchema, appGetInfoSchema, appRevealPathSchema, urlSchema } from '@shared/ipc-schemas'
import type { AppContext } from '../context'
import { handle, handleOutcome } from './index'

export function registerAppIpc(app: AppContext): void {
  handle('app:getInfo', appGetInfoSchema, (): AppInfo => {
    return {
      appVersion: electronApp.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      platform: process.platform as Platform,
      osVersion: release(),
      userDataPath: userDataDir(),
      logPath: logFilePath(),
      isDev: app.isDev,
      isPackaged: electronApp.isPackaged,
    }
  })

  // Story 075: `appCopyTextSchema` caps length and rejects non-strings before the
  // clipboard is ever touched - `handleOutcome` already turns that rejection into
  // a failed `Outcome` instead of throwing.
  handleOutcome('app:copyText', appCopyTextSchema, (text) => {
    clipboard.writeText(text)
    return ok(null)
  })

  // `urlSchema` allows only http(s), so a renderer cannot open `file:` or a
  // custom protocol handler through this channel.
  handleOutcome(
    'app:openExternal',
    urlSchema,
    async (url) => {
      await shell.openExternal(url)
      return ok(null)
    },
    'app.error.invalidUrl',
  )

  handleOutcome(
    'app:revealPath',
    appRevealPathSchema,
    async (target) => {
      // Renderer-supplied paths are never trusted: the schema only settles the
      // shape, so the allowlist stays here - only folders the launcher already
      // knows about may be revealed.
      if (!isAllowedRevealTarget(app, target)) {
        return fail('app.error.pathNotAllowed')
      }

      if (await isDirectory(target)) {
        const error = await shell.openPath(target)
        return error ? fail('app.error.revealFailed', { message: error }) : ok(null)
      }
      shell.showItemInFolder(target)
      return ok(null)
    },
    'app.error.invalidPath',
  )
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
