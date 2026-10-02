import type { Clipboard, Shell } from 'electron'
import {
  recordHarnessExternalUrl,
  recordHarnessRevealedPath,
  type UiHarness,
} from '../lib/ui-harness'

/**
 * The one place the main process opens, reveals, copies and records. Under the harness a reveal or
 * an external open is recorded to a fixture file instead of reaching the OS, so a scripted run never
 * pops a file manager or browser on the test machine. (story 209)
 */
export interface OsService {
  /** Resolves to an error message, `''` on success - Electron's `shell.openPath` contract. */
  openPath(path: string): Promise<string>
  showItemInFolder(path: string): void | Promise<void>
  openExternal(url: string): Promise<void>
  copyText(text: string): void
}

export function createOsService(deps: {
  harness: UiHarness
  shell: Pick<Shell, 'openPath' | 'showItemInFolder' | 'openExternal'>
  clipboard: Pick<Clipboard, 'writeText'>
}): OsService {
  const { harness, shell, clipboard } = deps
  return {
    async openPath(path) {
      if (harness.enabled) {
        await recordHarnessRevealedPath(harness, path)
        return ''
      }
      return shell.openPath(path)
    },
    showItemInFolder(path) {
      if (harness.enabled) return recordHarnessRevealedPath(harness, path)
      shell.showItemInFolder(path)
    },
    async openExternal(url) {
      if (harness.enabled) return recordHarnessExternalUrl(harness, url)
      await shell.openExternal(url)
    },
    copyText: (text) => clipboard.writeText(text),
  }
}
