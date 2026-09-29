import type { Outcome } from '@shared/types'

/** Story 164 D1: how the launcher talks to a running demo game. One implementation per platform. */
export interface PlaybackChannel {
  /** Launch args that must come before the demo argument (e.g. logfile setup). Never contains `+demo`. */
  argsBeforeDemo: string[]
  /** Launch args that must come after the demo argument (e.g. the polling loop). */
  argsAfterDemo: string[]
  start(): Promise<void>
  /** Queue one console line for the game; refuses invalid lines and a full queue. */
  send(line: string): Outcome<void>
  latest(): { positionMs: number | null; finished: boolean }
  /** Subscribe to the demo finishing; returns the unsubscribe function. */
  onFinished(cb: () => void): () => void
  /** Story 172: switch the running demo to fullscreen; the launcher stops steering it. */
  enterFullscreen(): Outcome<void>
  /** Where the demo shows: on the launcher's stage, or fullscreen (the game reported `FS 1`). */
  display(): 'stage' | 'fullscreen'
  onDisplayChange(cb: (display: 'stage' | 'fullscreen') => void): () => void
  close(): Promise<void>
}

/** The raw text pipe to the engine, below the protocol. */
export interface EngineIo {
  writeLine(line: string): void
  onLine(cb: (line: string) => void): () => void
}
