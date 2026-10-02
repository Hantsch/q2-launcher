/**
 * What `electron` resolves to under vitest (aliased in `vitest.config.ts`). The real package's
 * entry point, outside an Electron process, only returns the binary's path - and downloads that
 * binary on first require - so no test may depend on it (`scripts/quiet-test-run.test.mjs`).
 *
 * Every name `src/main` and `src/preload` import from `electron` is exported here so named
 * imports resolve, but none of them does anything: a test that needs Electron behaviour declares
 * it with its own `vi.mock('electron', ...)`, which replaces this module for that file. Functions
 * return `undefined` on purpose - a path-returning call such as `app.getPath()` fails at the
 * caller exactly like an unmocked Electron would, instead of handing out a plausible directory a
 * test could write into.
 */

const inert = (): undefined => undefined

export const app = {
  isPackaged: false,
  getPath: inert,
  getAppPath: inert,
  getVersion: inert,
  getName: inert,
  getLocale: inert,
  on: inert,
  once: inert,
  off: inert,
  quit: inert,
  exit: inert,
  relaunch: inert,
  focus: inert,
  whenReady: inert,
  requestSingleInstanceLock: inert,
  setAppUserModelId: inert,
}

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return []
  }
  static getFocusedWindow(): null {
    return null
  }
  static fromWebContents(): null {
    return null
  }
  static fromId(): null {
    return null
  }
}

export const screen = {
  getPrimaryDisplay: inert,
  getAllDisplays: (): unknown[] => [],
  getDisplayMatching: inert,
  getDisplayNearestPoint: inert,
  on: inert,
  off: inert,
}

export const protocol = { registerSchemesAsPrivileged: inert, handle: inert }
export const session = { defaultSession: undefined, fromPartition: inert }
export const clipboard = { writeText: inert, readText: (): string => '' }
export const shell = { openExternal: inert, openPath: inert, showItemInFolder: inert }
export const ipcMain = { handle: inert, removeHandler: inert, on: inert, off: inert }
export const dialog = { showOpenDialog: inert, showSaveDialog: inert, showMessageBox: inert }
export const nativeImage = { createFromPath: inert, createFromBuffer: inert, createEmpty: inert }
export const contextBridge = { exposeInMainWorld: inert }
export const ipcRenderer = { invoke: inert, on: inert, off: inert, removeListener: inert }
