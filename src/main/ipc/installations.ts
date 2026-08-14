import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { fail, ok } from '@shared/types'
import { canonicalizePath } from '../lib/fs-utils'
import {
  addExistingInputSchema,
  createInstallationInputSchema,
  idListSchema,
  idSchema,
  nullableIdSchema,
  pathListSchema,
  pickPathInputSchema,
  removeInstallationInputSchema,
  updateInstallationInputSchema,
} from '../lib/schemas'
import { inspectInstallation } from '../services/inspector'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerInstallationsIpc(app: AppContext): void {
  handle('installations:list', () => app.installations.list())

  handle('installations:addExisting', async (input) => {
    const parsed = addExistingInputSchema.safeParse(input)
    if (!parsed.success) return fail('ipc.error.invalidPayload')
    return app.installations.addExisting(parsed.data)
  })

  handle('installations:create', async (input) => {
    const parsed = createInstallationInputSchema.safeParse(input)
    if (!parsed.success) return fail('ipc.error.invalidPayload')
    return app.installations.create(parsed.data)
  })

  handle('installations:update', async (input) => {
    const parsed = updateInstallationInputSchema.safeParse(input)
    if (!parsed.success) return fail('ipc.error.invalidPayload')
    return app.installations.update(parsed.data)
  })

  handle('installations:remove', async (input) => {
    const parsed = removeInstallationInputSchema.safeParse(input)
    if (!parsed.success) return fail('ipc.error.invalidPayload')
    return app.installations.remove(parsed.data)
  })

  handle('installations:reorder', (ids) => app.installations.reorder(idListSchema.parse(ids)))

  handle('installations:setActive', (id) => {
    const validated = nullableIdSchema.parse(id)
    // Ignore ids that do not exist rather than storing a dangling reference.
    const exists = validated === null || app.installations.find(validated) !== undefined
    const next = app.state.patchSettings({
      activeInstallationId: exists ? validated : null,
    })
    app.broadcast.emit('settings:changed', next)
    return next
  })

  handle('installations:validate', (id) => app.installations.validate(idSchema.parse(id)))

  handle('installations:inspectPath', async (rootPath) => {
    if (typeof rootPath !== 'string' || rootPath.length === 0) {
      return fail('app.error.invalidPath')
    }
    // Used by the add dialog to preview a folder before anything is registered.
    return ok(await inspectInstallation(await canonicalizePath(rootPath)))
  })

  handle('installations:import', async (rootPaths) => {
    const parsed = pathListSchema.safeParse(rootPaths)
    if (!parsed.success) return fail('ipc.error.invalidPayload')
    return app.installations.importMany(parsed.data)
  })

  handle('installations:pickFolder', async (input, event) => {
    const options = pickPathInputSchema.parse(input)
    const result = await showOpenDialog(event, {
      title: options.title,
      properties: ['openDirectory', 'createDirectory'],
      ...(options.buttonLabel ? { buttonLabel: options.buttonLabel } : {}),
      ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
    })
    return result
  })

  handle('installations:pickExecutable', async (input, event) => {
    const options = pickPathInputSchema.parse(input)
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
