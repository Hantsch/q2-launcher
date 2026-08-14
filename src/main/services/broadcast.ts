import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { EventChannel, EventPayload } from '@shared/ipc'
import type { ToastLevel } from '@shared/types'

/**
 * Push channel from main to every open window.
 *
 * Typed against `IpcEventMap`, so a channel/payload mismatch is a compile error
 * rather than a silently ignored event.
 */
export class Broadcaster {
  emit<E extends EventChannel>(channel: E, payload: EventPayload<E>): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }

  /** Convenience for the common "tell the user something happened" case. */
  toast(
    level: ToastLevel,
    messageKey: string,
    params?: Record<string, string | number>,
    timeoutMs = level === 'error' ? 0 : 5_000,
  ): void {
    this.emit('app:toast', {
      id: randomUUID(),
      level,
      messageKey,
      timeoutMs,
      ...(params ? { params } : {}),
    })
  }
}
