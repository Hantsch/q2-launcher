/**
 * Bounded byte-level access to `.dm2` demo files on disk, feeding `parseDm2Header`
 * (`src/shared/demos/dm2-header.ts`) without ever reading a whole (possibly huge, possibly
 * gzip-compressed) demo into memory.
 *
 * `readDemoPrefix` sniffs gzip magic and either does one bounded `read()` off the raw file, or
 * streams-and-gunzips just enough to satisfy the requested byte budget, then stops — this is the
 * whole point: bounded I/O regardless of the file's real size.
 */

import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import {
  DM2_HEADER_MAX_BYTES,
  parseDm2Header,
  type Dm2HeaderResult,
} from '../../shared/demos/dm2-header'
import { parseDemoHeader, type DemoHeaderResult } from '../../shared/demos/demo-header'
import { createDm2FrameCounter } from '../../shared/demos/dm2-frames'
import { createDm2RosterCollector, type DemoRoster } from '../../shared/demos/dm2-roster'
import { createMvd2FrameCounter } from '../../shared/demos/mvd2-frames'
import type { FrameCounter, FrameCountResult } from '../../shared/demos/frame-count'

const GZIP_MAGIC_0 = 0x1f
const GZIP_MAGIC_1 = 0x8b

export type DemoPrefixResult = { ok: true; bytes: Uint8Array; compressed: boolean } | { ok: false }

/** Reads at most `maxBytes` of a demo file's (decompressed, if gzipped) content. Never throws. */
export async function readDemoPrefix(path: string, maxBytes: number): Promise<DemoPrefixResult> {
  try {
    const handle = await open(path, 'r')
    try {
      const peek = new Uint8Array(2)
      const peekResult = await handle.read(peek, 0, 2, 0)
      const isGzip =
        peekResult.bytesRead === 2 && peek[0] === GZIP_MAGIC_0 && peek[1] === GZIP_MAGIC_1

      if (!isGzip) {
        const buffer = new Uint8Array(maxBytes)
        let total = 0
        // Seed with what was already peeked, without re-reading those bytes off disk.
        const seedCount = Math.min(peekResult.bytesRead, maxBytes)
        buffer.set(peek.subarray(0, seedCount), 0)
        total = seedCount
        if (total < maxBytes) {
          const remaining = maxBytes - total
          const readResult = await handle.read(buffer, total, remaining, total)
          total += readResult.bytesRead
        }
        return { ok: true, bytes: buffer.subarray(0, total), compressed: false }
      }

      return await readGzipPrefix(path, maxBytes)
    } finally {
      await handle.close()
    }
  } catch {
    return { ok: false }
  }
}

function readGzipPrefix(path: string, maxBytes: number): Promise<DemoPrefixResult> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = []
    let total = 0
    let settled = false

    const readStream = createReadStream(path, { highWaterMark: 64 * 1024 })
    const gunzip = createGunzip()

    const finish = (): void => {
      if (settled) return
      settled = true
      readStream.destroy()
      gunzip.destroy()
      const all = Buffer.concat(chunks.map((c) => Buffer.from(c)))
      resolve({ ok: true, bytes: new Uint8Array(all.subarray(0, maxBytes)), compressed: true })
    }

    gunzip.on('data', (chunk: Buffer) => {
      chunks.push(new Uint8Array(chunk))
      total += chunk.length
      if (total >= maxBytes) finish()
    })
    gunzip.on('end', finish)
    gunzip.on('error', finish)
    readStream.on('error', finish)

    readStream.pipe(gunzip)
  })
}

export type Dm2HeaderResultWithIo = Dm2HeaderResult | { ok: false; reason: 'unreadable' }

/** Reads and parses a `.dm2` file's header, transparently handling gzip-compressed demos. */
export async function readDm2Header(path: string): Promise<Dm2HeaderResultWithIo> {
  const prefix = await readDemoPrefix(path, DM2_HEADER_MAX_BYTES)
  if (!prefix.ok) return { ok: false, reason: 'unreadable' }
  return parseDm2Header(prefix.bytes)
}

export type DemoHeaderResultWithIo = DemoHeaderResult | { ok: false; reason: 'unreadable' }

/**
 * Reads and parses a demo file's header (`.dm2` or `.mvd2`, chosen from the bytes themselves —
 * see `parseDemoHeader`), transparently handling gzip-compressed demos. The format isn't known
 * before reading, so the initial read reuses `.dm2`'s 1 MiB bound (`DM2_HEADER_MAX_BYTES`), which
 * comfortably covers `.mvd2`'s much smaller header too.
 */
export async function readDemoHeader(path: string): Promise<DemoHeaderResultWithIo> {
  const prefix = await readDemoPrefix(path, DM2_HEADER_MAX_BYTES)
  if (!prefix.ok) return { ok: false, reason: 'unreadable' }
  return parseDemoHeader(prefix.bytes)
}

const MVD2_MAGIC = [0x4d, 0x56, 0x44, 0x32] // "MVD2"
const FORMAT_SNIFF_BYTES = MVD2_MAGIC.length

/**
 * Streams `source`'s (already-decompressed) bytes into a frame counter chosen from the first
 * `FORMAT_SNIFF_BYTES` bytes (`MVD2` magic → `.mvd2`, else `.dm2`), stopping and destroying both
 * streams as soon as the counter fails. `rawStream`, when given, is the raw (still-compressed) file
 * stream feeding `source` (a gunzip transform): its errors are I/O errors (`unreadable`), while
 * errors on `source` itself are decode errors on a possibly-cut `.gz` (`finish()` on what was
 * pushed so far, like a cut plain file). Never rejects.
 */
function streamDemoDuration(
  source: Readable,
  rawStream: Readable | null,
): Promise<DemoFullPass> {
  return new Promise((resolve) => {
    let resolved = false
    let counter: FrameCounter | null = null
    let collector: ReturnType<typeof createDm2RosterCollector> | null = null
    let sniffChunks: Uint8Array[] = []
    let sniffBytes = 0

    const settle = (duration: FrameCountResult): void => {
      if (resolved) return
      resolved = true
      source.destroy()
      rawStream?.destroy()
      resolve({ duration, roster: collector?.finish() ?? null })
    }

    const chooseCounter = (): FrameCounter => {
      const head = new Uint8Array(FORMAT_SNIFF_BYTES)
      let offset = 0
      for (const chunk of sniffChunks) {
        for (let i = 0; i < chunk.length && offset < FORMAT_SNIFF_BYTES; i++)
          head[offset++] = chunk[i]!
      }
      const isMvd2 = offset === FORMAT_SNIFF_BYTES && MVD2_MAGIC.every((b, i) => head[i] === b)
      if (isMvd2) return createMvd2FrameCounter()
      collector = createDm2RosterCollector()
      return createDm2FrameCounter(collector)
    }

    const ensureCounter = (force: boolean): void => {
      if (counter !== null) return
      if (!force && sniffBytes < FORMAT_SNIFF_BYTES) return
      counter = chooseCounter()
      for (const chunk of sniffChunks) {
        if (counter.failed) break
        counter.push(chunk)
      }
      sniffChunks = []
    }

    source.on('data', (chunk: Buffer) => {
      if (resolved) return
      const bytes = new Uint8Array(chunk)
      if (counter === null) {
        sniffChunks.push(bytes)
        sniffBytes += bytes.length
        ensureCounter(false)
      } else if (!counter.failed) {
        counter.push(bytes)
      }
      if (counter?.failed) settle(counter.finish())
    })
    source.on('end', () => {
      if (resolved) return
      ensureCounter(true)
      settle((counter as FrameCounter).finish())
    })
    source.on('error', () => {
      if (resolved) return
      ensureCounter(true)
      settle((counter as FrameCounter).finish())
    })
    rawStream?.on('error', () => settle({ ok: false, reason: 'unreadable' }))
    rawStream?.pipe(source as unknown as NodeJS.WritableStream)
  })
}

export type DemoFullPass = { duration: FrameCountResult; roster: DemoRoster | null }

/**
 * Reads a demo file once, front to back, and returns its playback duration (exact server-frame
 * count) and, for `.dm2`, its roster collected in that same pass - `.mvd2` has none. `.dm2` or
 * `.mvd2` is chosen from the (decompressed, if gzipped) bytes themselves, transparently handling
 * gzip compression the same way `readDemoPrefix` does. Unlike the header readers, this reads the
 * whole file. Never rejects.
 */
export async function readDemoFullPass(path: string): Promise<DemoFullPass> {
  try {
    const handle = await open(path, 'r')
    let isGzip: boolean
    try {
      const peek = new Uint8Array(2)
      const peekResult = await handle.read(peek, 0, 2, 0)
      isGzip = peekResult.bytesRead === 2 && peek[0] === GZIP_MAGIC_0 && peek[1] === GZIP_MAGIC_1
    } finally {
      await handle.close()
    }

    if (!isGzip) {
      const readStream = createReadStream(path, { highWaterMark: 64 * 1024 })
      return await streamDemoDuration(readStream, null)
    }

    const readStream = createReadStream(path, { highWaterMark: 64 * 1024 })
    const gunzip = createGunzip()
    return await streamDemoDuration(gunzip, readStream)
  } catch {
    return { duration: { ok: false, reason: 'unreadable' }, roster: null }
  }
}
