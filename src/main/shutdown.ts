export interface SettleOutcome {
  /** Set by registries that report per store; a lone settle is named by its entry in `settles`. */
  label?: string
  ok: boolean
}

export interface ShutdownApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown
  quit(): void
}

export interface ShutdownLog {
  error(message: string, ...details: unknown[]): void
}

export interface ShutdownOptions {
  app: ShutdownApp
  timeoutMs?: number
  log: ShutdownLog
  /** Synchronous: a playback pipe's last write may depend on it, so nothing awaits before it. */
  releasePlayback: () => void
  disposeModules: () => Promise<void>
  settles: { label: string; run: () => Promise<SettleOutcome | SettleOutcome[]> }[]
}

/**
 * Quit is held (`preventDefault`) for one bounded shutdown sequence, then `app.quit()` is called
 * again. That second `before-quit` - and any quit the user triggers meanwhile - must pass straight
 * through, hence the one-way guard.
 */
export function installShutdown(options: ShutdownOptions): void {
  const { app, timeoutMs = 3000, log, releasePlayback, disposeModules, settles } = options
  let started = false

  app.on('before-quit', (event) => {
    if (started) return
    started = true
    event.preventDefault()
    // A throwing release must not leave quit held forever: log it and carry on with the sequence.
    try {
      releasePlayback()
    } catch (error) {
      log.error('shutdown: releasing playback failed', error)
    }
    void run()
  })

  async function run(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs)
    })
    const work = (async () => {
      // Disposers first: they may still write into stores that the settles below then flush.
      try {
        await disposeModules()
      } catch (error) {
        log.error('shutdown: disposing modules failed', error)
      }
      await Promise.all(
        settles.map(async ({ label, run: settle }) => {
          try {
            const result = await settle()
            for (const item of Array.isArray(result) ? result : [result]) {
              if (!item.ok) log.error(`shutdown: ${item.label ?? label} did not save`)
            }
          } catch (error) {
            log.error(`shutdown: ${label} settle failed`, error)
          }
        }),
      )
    })()
    const outcome = await Promise.race([work.then(() => 'done' as const), timeout])
    if (outcome === 'timeout')
      log.error(`shutdown: timed out after ${timeoutMs} ms, quitting anyway`)
    clearTimeout(timer)
    app.quit()
  }
}
