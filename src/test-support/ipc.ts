/**
 * Registrars only fill `ipc/index.ts`'s listener table; `ipcMain.handle` is called by
 * `bindAllChannels()` alone. A registrar test calls this after its registrar ran (and after
 * `vi.resetModules()`) so its mocked `ipcMain.handle` sees the handlers, with the boot gate open.
 */
export async function bindRegisteredChannels(): Promise<void> {
  const ipc = await import('../main/ipc/index')
  ipc.bindAllChannels()
  ipc.markIpcReady()
}
