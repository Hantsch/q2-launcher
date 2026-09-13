import { delimiter } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import { canonicalizePath } from '../lib/fs-utils'
import { scopedLogger } from '../lib/logger'

const log = scopedLogger('dialog')

export interface DialogServiceOptions {
  /**
   * Resolves the currently tracked main `BrowserWindow`, or `null` before it exists yet (early
   * boot) or after it has been closed. A function rather than a `BrowserWindow` reference itself,
   * because `AppContext` (and therefore this service) is constructed before `index.ts` creates the
   * window - see `createMainWindow` in `index.ts`. Read fresh on every call, never cached.
   */
  getMainWindow: () => BrowserWindow | null
  /** Same `isDev` `AppContext` carries everywhere else - `is.dev` from `@electron-toolkit/utils`. */
  isDev: boolean
}

/**
 * Story 066 D4: the one place that owns `dialog.showOpenDialog` for picking config files.
 *
 * Modules cannot touch `dialog` or `BrowserWindow` directly and get no invoke event to resolve a
 * window from (`modules/types.ts:41-44`), so this exists as its own service on `AppContext` instead
 * of living inside the config module. Unlike `installations.ts`'s `showOpenDialog` helper - which
 * resolves its window from the invoke event that carried the request - this has no such event: the
 * window comes from `getMainWindow()`, the same tracked reference `index.ts` uses for
 * `second-instance` focusing.
 */
export class DialogService {
  private readonly getMainWindow: () => BrowserWindow | null
  private readonly isDev: boolean

  constructor(options: DialogServiceOptions) {
    this.getMainWindow = options.getMainWindow
    this.isDev = options.isDev
  }

  /**
   * Opens a native, multi-select file picker filtered to `.cfg` files and returns the canonicalised
   * absolute paths the user picked - `[]` on cancel (mirrors the folder/executable pickers in
   * `ipc/installations.ts`, which return `null` instead only because their contract already has a
   * "nothing picked" case; a module folding zero-or-more files wants `[]`, not a null to guard).
   *
   * **Harness stub** - `Q2L_UI_HARNESS === '1'` AND `isDev` BOTH true, never either alone: no dialog
   * opens at all, and `Q2L_UI_PICK_FILES` supplies the paths instead. This is the backdoor Playwright
   * needs because it cannot drive a native OS dialog (`docs/UI-VERIFICATION.md:701-706`); it is
   * unreachable in a packaged build, where `isDev` is always `false` regardless of any environment
   * variable a hostile or malformed launch could set.
   *
   * `Q2L_UI_PICK_FILES` format: paths joined with `path.delimiter` (`;` on Windows, `:` elsewhere) -
   * the same separator Node uses for `PATH` itself, and safe here because a `.cfg` path is most
   * unlikely to contain it (a real OS path list already relies on the same assumption). Empty
   * segments are dropped, so a trailing delimiter or an unset/empty variable both yield `[]`. D8's
   * e2e harness must produce values in this exact format.
   */
  async pickConfigFiles({ defaultPath }: { defaultPath?: string }): Promise<string[]> {
    if (this.isDev && process.env['Q2L_UI_HARNESS'] === '1') {
      const picked = parseHarnessPickedFiles(process.env['Q2L_UI_PICK_FILES'])
      log.info(`harness stub: returning ${picked.length} fixture path(s) instead of a real dialog`)
      return Promise.all(picked.map((path) => canonicalizePath(path)))
    }

    const window = this.getMainWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Config files', extensions: ['cfg'] }],
      ...(defaultPath ? { defaultPath } : {}),
    }

    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return []
    return Promise.all(result.filePaths.map((path) => canonicalizePath(path)))
  }
}

/** Splits `Q2L_UI_PICK_FILES` on `path.delimiter`, dropping empty segments. */
function parseHarnessPickedFiles(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(delimiter).filter((path) => path.length > 0)
}
