import { open, type FileHandle } from 'node:fs/promises'

/**
 * A bounded, read-only reader for a Quake II BSP's worldspawn `message` (the map's title).
 *
 * Layout: `IBSP`, version 38 (int32 LE), then lump 0 (entities) as `{ofs, len}` int32s relative to
 * the BSP's start. A BSP is untrusted input (it ships inside mod downloads), so a wrong ident or
 * version, a lump outside the file or `limit`, or any error is a refusal (`undefined`), and at most
 * `BSP_ENTITY_READ_CAP` bytes of the entity lump are ever read.
 */

export const BSP_HEADER_BYTES = 12 + 8
export const BSP_ENTITY_READ_CAP = 16 * 1024
export const BSP_TITLE_MAX_CHARS = 64

const BSP_VERSION = 38

async function readExactly(
  handle: FileHandle,
  length: number,
  position: number,
): Promise<Buffer | null> {
  const buffer = Buffer.alloc(length)
  let filled = 0
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled)
    if (bytesRead === 0) return null
    filled += bytesRead
  }
  return buffer
}

/** The `message` of the first `{ ... }` entity block, quoted key/value pairs only. */
function firstBlockMessage(entities: Buffer): string | undefined {
  const text = entities.toString('latin1')
  const open = text.indexOf('{')
  if (open === -1) return undefined
  const close = text.indexOf('}', open)
  const block = text.slice(open + 1, close === -1 ? undefined : close)
  const pair = /"([^"]*)"\s*"([^"]*)"/g
  for (let m = pair.exec(block); m; m = pair.exec(block)) {
    if (m[1] === 'message') return m[2]
  }
  return undefined
}

function cleanTitle(raw: string): string | undefined {
  let masked = ''
  for (const ch of raw) {
    const code = ch.charCodeAt(0) & 0x7f
    masked += code < 0x20 || code === 0x7f ? ' ' : String.fromCharCode(code)
  }
  const title = masked
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BSP_TITLE_MAX_CHARS)
    .trim()
  return title === '' ? undefined : title
}

/**
 * Reads a BSP's title; `base` is where the BSP starts (non-zero inside a pak) and `limit` the
 * exclusive end of its bytes (defaults to the file's end). Never throws.
 */
export async function readBspTitle(
  path: string,
  base = 0,
  limit?: number,
): Promise<string | undefined> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'r')
    const stat = await handle.stat()
    if (!stat.isFile() || base < 0) return undefined
    const end = Math.min(limit ?? stat.size, stat.size)

    const header = await readExactly(handle, BSP_HEADER_BYTES, base)
    if (!header || base + BSP_HEADER_BYTES > end) return undefined
    if (header.toString('latin1', 0, 4) !== 'IBSP') return undefined
    if (header.readInt32LE(4) !== BSP_VERSION) return undefined

    const ofs = header.readInt32LE(8)
    const len = header.readInt32LE(12)
    if (ofs < 0 || len < 0 || base + ofs + len > end) return undefined

    const entities = await readExactly(handle, Math.min(len, BSP_ENTITY_READ_CAP), base + ofs)
    if (!entities) return undefined
    const message = firstBlockMessage(entities)
    return message === undefined ? undefined : cleanTitle(message)
  } catch {
    return undefined
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
