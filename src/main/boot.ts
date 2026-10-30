import { scopedLogger } from './lib/logger'

const log = scopedLogger('boot')

/**
 * The boot sequence's moving parts, injected so the ordering can be tested without Electron.
 * `Shell` is what both the window and the context need (harness, env, broadcaster) and is built
 * synchronously, before either starts.
 */
export interface BootSteps<Shell, Window, Context> {
  /** Every invoke channel answers from here on; invokes wait until `markReady`/`markFailed`. */
  bindIpc: () => void
  createShell: () => Shell
  createWindow: (shell: Shell) => Promise<Window>
  createContext: (shell: Shell) => Promise<Context>
  registerIpc: (context: Context) => void
  markReady: () => void
  markFailed: (error: unknown) => void
}

export interface Booted<Shell, Window, Context> {
  shell: Shell
  window: Window
  /** `null` when the context failed: IPC is then failed and every invoke is refused. */
  context: Context | null
}

/**
 * Opens the window without waiting for the app context (state read, unlock init, module setup).
 *
 * IPC is bound first, so a renderer that loads before the context is ready gets held invokes, never
 * "no handler registered". A context that fails - including `registerIpc` throwing on an
 * incomplete contract - marks IPC failed so held invokes are refused instead of hanging forever;
 * the window stays open. A window that fails still rejects the boot, as it always has. Resolves
 * once both are done, so whatever runs after it can broadcast to a loaded renderer. (story 322)
 */
export async function boot<Shell, Window, Context>(
  steps: BootSteps<Shell, Window, Context>,
): Promise<Booted<Shell, Window, Context>> {
  steps.bindIpc()
  const shell = steps.createShell()

  const window = steps.createWindow(shell)
  const context = Promise.resolve()
    .then(() => steps.createContext(shell))
    .then((created) => {
      steps.registerIpc(created)
      steps.markReady()
      return created
    })
    .catch((error: unknown) => {
      log.error('app context failed to start; the window stays open without services', error)
      steps.markFailed(error)
      return null
    })

  // `Promise.all` observes both at once, so a window that rejects while the context is still being
  // built is never an unhandled rejection; `context` itself never rejects.
  const [createdWindow, settledContext] = await Promise.all([window, context])
  return { shell, window: createdWindow, context: settledContext }
}
