import type { Logger } from './logger'

export interface ListenerSet<T> {
  /** Registers `fn`; returns its unsubscribe. */
  add(fn: (value: T) => void): () => void
  /** Calls every listener with `value`, in registration order. A throwing listener never stops the others. */
  emit(value: T): void
  clear(): void
  readonly size: number
}

/**
 * A set of listeners with the delivery rules every observer list here needs: `emit` iterates a copy,
 * so a listener that unsubscribes (or subscribes) during delivery cannot disturb the iteration, and
 * each listener runs in its own try/catch, logged as `${label} listener threw`.
 */
export function createListenerSet<T = void>(
  log: Pick<Logger, 'error'>,
  label: string,
): ListenerSet<T> {
  const listeners = new Set<(value: T) => void>()
  return {
    add(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    emit(value) {
      for (const fn of [...listeners]) {
        try {
          fn(value)
        } catch (error) {
          log.error(`${label} listener threw`, error)
        }
      }
    },
    clear() {
      listeners.clear()
    },
    get size() {
      return listeners.size
    },
  }
}
