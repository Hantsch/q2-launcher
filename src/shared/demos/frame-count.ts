/**
 * Shared vocabulary for "how long is this demo": the result every per-format frame counter
 * returns, the streaming interface a caller feeds file chunks into, the fixed server frame length,
 * and the growable block buffer both counters use to reassemble length-prefixed blocks out of
 * arbitrarily-sized chunks.
 *
 * Duration is derived, never measured: a Quake II server runs at a fixed 10 Hz, so every recorded
 * server frame stands for `DEMO_FRAME_MS` of game time and `durationMs = frames × DEMO_FRAME_MS`.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

/** Game time one server frame stands for: Quake II servers tick at a fixed 10 Hz. */
export const DEMO_FRAME_MS = 100

/** A single demo block larger than this is treated as foreign/corrupt data rather than waited
 * for — no real client or server writes blocks anywhere near this size (q2pro caps a message at
 * 32 KiB). */
export const DEMO_MAX_BLOCK_BYTES = 1_048_576

export type FrameCountFailureReason = 'not-a-demo' | 'undecodable' | 'no-frames' | 'unreadable'

export type FrameCountResult =
  | { ok: true; frames: number; durationMs: number; complete: boolean }
  | {
      ok: false
      reason: FrameCountFailureReason
      /** File offset of the failing block's length word, when the failure is tied to one block. */
      at?: number
    }

/**
 * A streaming frame counter: feed it the file front to back in chunks of any size, then call
 * `finish()`. The result does not depend on how the file was chunked. `failed` turns true as soon
 * as the input is known to be unusable; later pushes are then ignored, so a caller may stop
 * reading early.
 */
export interface FrameCounter {
  push(chunk: Uint8Array): void
  finish(): FrameCountResult
  readonly failed: boolean
}

/**
 * A growable byte buffer with a read offset. `append` adds a chunk at the end; `consume` advances
 * the read offset. Only the unconsumed tail is ever kept: when the storage fills up, the tail is
 * moved to the front (compaction) or the storage is doubled. Storage is kept at least twice as
 * large as the tail plus the incoming chunk, so every compaction copies at most as many bytes as
 * were consumed since the previous one — total copying stays linear in the input, never
 * quadratic, however small the chunks are.
 */
export class BlockBuffer {
  private storage: Uint8Array
  private start = 0
  private end = 0

  constructor(initialCapacity = 65_536) {
    this.storage = new Uint8Array(Math.max(16, initialCapacity))
  }

  /** The backing bytes; valid data lives in `[readOffset, readOffset + available)`. The array
   * object may change on the next `append`, so do not hold on to it across pushes. */
  get bytes(): Uint8Array {
    return this.storage
  }

  get readOffset(): number {
    return this.start
  }

  get available(): number {
    return this.end - this.start
  }

  append(chunk: Uint8Array): void {
    const n = chunk.length
    if (n === 0) return
    if (this.end + n > this.storage.length) {
      const tail = this.end - this.start
      const needed = 2 * (tail + n)
      if (needed > this.storage.length) {
        let capacity = this.storage.length * 2
        while (capacity < needed) capacity *= 2
        const grown = new Uint8Array(capacity)
        grown.set(this.storage.subarray(this.start, this.end), 0)
        this.storage = grown
      } else {
        this.storage.copyWithin(0, this.start, this.end)
      }
      this.start = 0
      this.end = tail
    }
    this.storage.set(chunk, this.end)
    this.end += n
  }

  consume(n: number): void {
    this.start += Math.min(n, this.end - this.start)
    if (this.start === this.end) {
      this.start = 0
      this.end = 0
    }
  }

  /** Drops everything, and releases a storage that grew large. */
  clear(): void {
    this.start = 0
    this.end = 0
    if (this.storage.length > 65_536) this.storage = new Uint8Array(65_536)
  }
}

/** Builds the success result for `frames` counted frames. */
export function framesResult(frames: number, complete: boolean): FrameCountResult {
  if (frames === 0) return { ok: false, reason: 'no-frames' }
  return { ok: true, frames, durationMs: frames * DEMO_FRAME_MS, complete }
}
