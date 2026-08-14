import type { LauncherBridge } from '@shared/ipc'

declare global {
  interface Window {
    /** Exposed by `src/preload/index.ts` via `contextBridge`. */
    q2: LauncherBridge
  }
}
