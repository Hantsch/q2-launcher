import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { fail, ok } from '@shared/types'
import { canonicalizePath } from '../lib/fs-utils'
import {
  addExistingInputSchema,
  createInstallationInputSchema,
  iconDataUrlInputSchema,
  idListSchema,
  idSchema,
  installationsInspectPathSchema,
  installationsListSchema,
  nullableIdSchema,
  pathListSchema,
  pickIconFileInputSchema,
  pickPathInputSchema,
  removeInstallationInputSchema,
  setInstallationIconInputSchema,
  updateInstallationInputSchema,
} from '@shared/ipc-schemas'
import { inspectInstallation } from '../services/inspector'
import type { AppContext } from '../context'
import { handle, handleOutcome } from './index'

export function registerInstallationsIpc(app: AppContext): void {
  handle('installations:list', installationsListSchema, () => app.installations.list())

  handleOutcome('installations:addExisting', addExistingInputSchema, async (input) => {
    return app.installations.addExisting(input)
  })

  handleOutcome('installations:create', createInstallationInputSchema, async (input) => {
    return app.installations.create(input)
  })

  handleOutcome('installations:update', updateInstallationInputSchema, async (input) => {
    return app.installations.update(input)
  })

  handleOutcome('installations:remove', removeInstallationInputSchema, async (input) => {
    return app.installations.remove(input)
  })

  handle('installations:reorder', idListSchema, (ids) => app.installations.reorder(ids))

  handle('installations:setActive', nullableIdSchema, (id) => {
    // Ignore ids that do not exist rather than storing a dangling reference.
    const exists = id === null || app.installations.find(id) !== undefined
    const next = app.state.patchSettings({
      activeInstallationId: exists ? id : null,
    })
    app.broadcast.emit('settings:changed', next)
    return next
  })

  handleOutcome('installations:validate', idSchema, (id) => app.installations.validate(id))

  handleOutcome(
    'installations:inspectPath',
    installationsInspectPathSchema,
    async (rootPath) => {
      // Used by the add dialog to preview a folder before anything is registered.
      return ok(await inspectInstallation(await canonicalizePath(rootPath)))
    },
    'app.error.invalidPath',
  )

  handleOutcome('installations:import', pathListSchema, async (rootPaths) => {
    return app.installations.importMany(rootPaths)
  })

  handle('installations:pickFolder', pickPathInputSchema, async (options, event) => {
    const result = await showOpenDialog(event, {
      title: options.title,
      properties: ['openDirectory', 'createDirectory'],
      ...(options.buttonLabel ? { buttonLabel: options.buttonLabel } : {}),
      ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
    })
    return result
  })

  handle('installations:pickExecutable', pickPathInputSchema, async (options, event) => {
    return showOpenDialog(event, {
      title: options.title,
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Executables', extensions: ['exe'] }]
          : [{ name: 'All files', extensions: ['*'] }],
      ...(options.buttonLabel ? { buttonLabel: options.buttonLabel } : {}),
      ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
    })
  })

  // ---- icon (story 067) -----------------------------------------------------------------------

  handleOutcome('installations:setIcon', setInstallationIconInputSchema, async (input) => {
    if (input.icon === null) return app.icons.clear(input.installationId)
    if (input.icon.kind === 'shipped') {
      return app.icons.setShipped(input.installationId, input.icon.id)
    }
    // `{ kind: 'custom' }` is a *result*, not a request: a custom icon exists only once main has
    // stored a file for it, which is `installations:pickIconFile`'s job. Accepting it here would
    // persist an icon with no bytes behind it.
    return fail('ipc.error.invalidPayload')
  })

  handleOutcome('installations:pickIconFile', pickIconFileInputSchema, async (input, event) => {
    return app.icons.pickAndStore(
      input.installationId,
      BrowserWindow.fromWebContents(event.sender),
    )
  })

  handle('installations:iconDataUrl', iconDataUrlInputSchema, (installationId) => {
    return app.icons.dataUrl(installationId)
  })
}

/** Modal-to-the-window dialog, so it cannot be lost behind the launcher. */
async function showOpenDialog(
  event: IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions,
): Promise<string | null> {
  const window = BrowserWindow.fromWebContents(event.sender)
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}
