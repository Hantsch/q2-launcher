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
import { createGunzip } from 'node:zlib'
import { DM2_HEADER_MAX_BYTES, parseDm2Header, type Dm2HeaderResult } from '../../shared/demos/dm2-header'

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
      const isGzip = peekResult.bytesRead === 2 && peek[0] === GZIP_MAGIC_0 && peek[1] === GZIP_MAGIC_1

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
