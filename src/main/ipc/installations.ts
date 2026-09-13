import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { fail, ok } from '@shared/types'
import { canonicalizePath } from '../lib/fs-utils'
import { uiHarnessPickedFolders } from '../lib/ui-harness'
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

  /**
   * Story 074 D8 adds a **harness stub** to this channel, mirroring
   * `DialogService.pickConfigFiles()` (`src/main/services/dialog.ts`) exactly: when
   * `Q2L_UI_HARNESS === '1'` AND `app.isDev` are BOTH true (`isUiHarnessEnabled`,
   * `src/main/lib/ui-harness.ts`), no dialog opens at all and `Q2L_UI_PICK_FOLDER` supplies the
   * folder instead. It is unreachable in a packaged build, where `isDev` is always `false`
   * regardless of any environment variable a hostile or malformed launch could set.
   *
   * It exists because Playwright cannot drive a native OS dialog (`docs/UI-VERIFICATION.md`,
   * "Known blind spots") and the bootstrap wizard's target step has no typeable field
   * (`PathPicker`'s input is `readOnly`), so `scripts/flows/bootstrap-wizard.mjs` could not reach
   * AC2-AC8 at all otherwise. The stubbed path gets no special trust: it comes back through the
   * same return value the real dialog uses, and every consumer re-judges it in main
   * (`computeTargetVerdict`, `canonicalizePath`) exactly as before.
   *
   * `Q2L_UI_PICK_FOLDER` is a list and successive calls walk it, because one flow legitimately
   * picks more than one folder (that flow needs a `Program Files` path for AC2's warning and its
   * real fixture target for AC3's). The counter lives here, per registration, rather than in
   * `ui-harness.ts` - that file stays a pure predicate, and a module-level counter would be shared
   * by two `AppContext`s in the same process the way `downloadsModule`'s own subscription set
   * would have been. The last entry repeats forever, so an extra pick (the wizard's write-dir
   * remedy button, say) cannot exhaust the list and read as a surprise cancel.
   */
  let harnessFolderPicks = 0
  handle('installations:pickFolder', pickPathInputSchema, async (options, event) => {
    const stubbed = uiHarnessPickedFolders({ isDev: app.isDev })
    if (stubbed !== undefined) {
      if (stubbed.length === 0) return null
      const picked = stubbed[Math.min(harnessFolderPicks, stubbed.length - 1)]
      harnessFolderPicks += 1
      return picked
    }

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
