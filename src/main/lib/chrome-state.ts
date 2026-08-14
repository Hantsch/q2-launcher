import type { BrowserWindow } from 'electron'
import type { WindowChromeState } from '@shared/ipc'

/** Snapshot of the state the custom title bar renders from. */
export function chromeState(window: BrowserWindow | null): WindowChromeState {
  return {
    maximized: window?.isMaximized() ?? false,
    fullScreen: window?.isFullScreen() ?? false,
    focused: window?.isFocused() ?? false,
  }
}
