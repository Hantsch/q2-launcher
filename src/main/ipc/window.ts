import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { WindowChromeState } from '@shared/ipc'
import {
  windowCloseSchema,
  windowGetStateSchema,
  windowMinimizeSchema,
  windowToggleMaximizeSchema,
} from '@shared/ipc-schemas'
import { chromeState } from '../lib/chrome-state'
import { handle } from './index'

/**
 * Window controls for the custom title bar.
 *
 * Every handler acts on the window that sent the request rather than on a
 * captured reference, so this stays correct if the launcher ever opens a second
 * window.
 */
export function registerWindowIpc(): void {
  handle('window:minimize', windowMinimizeSchema, (_payload, event) => {
    windowFrom(event)?.minimize()
  })

  handle('window:toggleMaximize', windowToggleMaximizeSchema, (_payload, event) => {
    const window = windowFrom(event)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  handle('window:close', windowCloseSchema, (_payload, event) => {
    windowFrom(event)?.close()
  })

  handle('window:getState', windowGetStateSchema, (_payload, event): WindowChromeState => {
    return chromeState(windowFrom(event))
  })
}

function windowFrom(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}
