import { join } from 'node:path'
import { app } from 'electron'
import { STATE_FILE, WINDOW_STATE_FILE } from '@shared/constants'

export function userDataDir(): string {
  return app.getPath('userData')
}

/** Settings + installations. Rewritten only on real changes. */
export function stateFilePath(): string {
  return join(userDataDir(), STATE_FILE)
}

/**
 * Window geometry, kept in its own file: it changes on every resize and we do
 * not want that write churn anywhere near the installation list.
 */
export function windowStateFilePath(): string {
  return join(userDataDir(), WINDOW_STATE_FILE)
}
