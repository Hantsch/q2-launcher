import type { Readable, Writable } from 'node:stream'
import { createListenerSet } from '../lib/listeners'
import { scopedLogger } from '../lib/logger'

const log = scopedLogger('playback')

/**
 * Story 163: the launcher's line to a game it started for demo playback - the child's stdin to
 * send console commands down, and its stdout to hear what the engine prints. Main-only; it never
 * crosses IPC as an object.
 */
export interface PlaybackSession {
  readonly installationId: string
  /** True once the session is over - the game exited or errored, or the launcher let go of it. */
  readonly ended: boolean
  /**
   * Hands `text` to the game's stdin. `true` when it was handed to the pipe, `false` when it could
   * not be: the session has ended or the pipe broke. Never throws.
   */
  write(text: string): boolean
  /** Every stdout chunk from now on; returns its unsubscribe. A no-op once the session has ended. */
  onStdout(listener: (chunk: Buffer) => void): () => void
  /**
   * Called exactly once when the session ends; returns its unsubscribe. Registered after the end,
   * it is called straight away, so no subscriber can wait for an end that already happened.
   */
  onEnd(listener: () => void): () => void
}

/** What `LaunchService` keeps: the session it hands out, plus the one way to end it. */
export interface PlaybackSessionHandle {
  readonly session: PlaybackSession
  /** Ends the session: stdin ended, stdout detached and closed, `onEnd` fired. Idempotent. */
  end(): void
}

/**
 * Opens a session over a spawned child's pipes. stdout gets its `'data'` listener here, at spawn
 * time, and keeps it whether or not anybody subscribed: an undrained pipe fills up, and a chatty
 * engine blocked on a full stdout stops running. Chunks nobody asked for are dropped.
 *
 * Both pipes carry an `'error'` listener for their whole life, including after the end - a pipe
 * error without one is an uncaught exception in main. Errors are logged, never rethrown.
 */
export function openPlaybackSession(
  installationId: string,
  stdin: Writable | null,
  stdout: Readable | null,
): PlaybackSessionHandle {
  const stdoutListeners = createListenerSet<Buffer>(log, `a playback stdout for ${installationId}`)
  const endListeners = createListenerSet(log, `a playback onEnd for ${installationId}`)
  let ended = false
  let stdinBroken = false

  const onData = (chunk: Buffer | string): void => {
    if (stdoutListeners.size === 0) return
    stdoutListeners.emit(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  stdout?.on('data', onData)
  stdout?.on('error', (error: Error) => {
    log.warn(`playback stdout for ${installationId} reported an error`, error)
  })
  stdin?.on('error', (error: Error) => {
    stdinBroken = true
    log.warn(`playback stdin for ${installationId} broke`, error)
  })

  const session: PlaybackSession = {
    installationId,
    get ended() {
      return ended
    },
    write(text: string): boolean {
      if (ended) return false
      if (!stdin || stdinBroken || stdin.destroyed || stdin.writableEnded) {
        log.warn(`dropped a write to ${installationId}: its stdin is closed`)
        return false
      }
      try {
        stdin.write(text)
        return true
      } catch (error) {
        log.warn(`a write to ${installationId}'s stdin failed`, error)
        return false
      }
    },
    onStdout(listener) {
      if (ended) return () => {}
      return stdoutListeners.add(listener)
    },
    onEnd(listener) {
      if (ended) {
        listener()
        return () => {}
      }
      return endListeners.add(listener)
    },
  }

  const end = (): void => {
    if (ended) return
    ended = true
    stdout?.off('data', onData)
    stdout?.destroy()
    if (stdin && !stdinBroken && !stdin.destroyed && !stdin.writableEnded) stdin.end()
    stdoutListeners.clear()
    endListeners.emit()
    endListeners.clear()
  }

  return { session, end }
}
