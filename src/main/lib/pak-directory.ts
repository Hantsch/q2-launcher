import { open, type FileHandle } from 'node:fs/promises'

/**
 * Story 192: a bounded, read-only reader for a Quake II `.pak` directory.
 *
 * Layout: a 12-byte header (`PACK`, then `dirofs` and `dirlen` as little-endian int32), and at
 * `dirofs` a directory of `dirlen / 64` entries, each a 56-byte NUL-padded name followed by the
 * entry's offset and length. Only the header and the directory are ever read - never file data -
 * and the directory is refused before allocation unless it is well-formed, fits inside the file
 * and holds at most `PAK_MAX_ENTRIES` entries (so the largest buffer is 4 MiB). A pak is
 * untrusted input (it can come from any mod download), so every inconsistency is a refusal.
 */

export const PAK_HEADER_BYTES = 12
export const PAK_ENTRY_BYTES = 64
export const PAK_NAME_BYTES = 56
export const PAK_MAX_ENTRIES = 65_536

export type PakEntry = { name: string; offset: number; length: number }

export type PakDirectoryResult = { ok: true; names: string[]; entries: PakEntry[] } | { ok: false }

const REFUSED: PakDirectoryResult = { ok: false }

/** Reads exactly `length` bytes at `position`, or returns `null` if the file ends first. */
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

function entryName(directory: Buffer, index: number): string {
  const start = index * PAK_ENTRY_BYTES
  const field = directory.subarray(start, start + PAK_NAME_BYTES)
  const nul = field.indexOf(0)
  return field.toString('latin1', 0, nul === -1 ? PAK_NAME_BYTES : nul)
}

/** Lists the entry names of a pak. Never throws: any error or inconsistency is `{ ok: false }`. */
export async function readPakDirectory(path: string): Promise<PakDirectoryResult> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'r')
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < PAK_HEADER_BYTES) return REFUSED

    const header = await readExactly(handle, PAK_HEADER_BYTES, 0)
    if (!header || header.toString('latin1', 0, 4) !== 'PACK') return REFUSED

    const dirofs = header.readInt32LE(4)
    const dirlen = header.readInt32LE(8)
    if (dirofs < 0 || dirlen < 0) return REFUSED
    if (dirlen % PAK_ENTRY_BYTES !== 0) return REFUSED
    const count = dirlen / PAK_ENTRY_BYTES
    if (count > PAK_MAX_ENTRIES) return REFUSED
    if (dirofs + dirlen > stat.size) return REFUSED

    const directory = await readExactly(handle, dirlen, dirofs)
    if (!directory) return REFUSED

    const entries: PakEntry[] = []
    for (let i = 0; i < count; i += 1) {
      const at = i * PAK_ENTRY_BYTES + PAK_NAME_BYTES
      entries.push({
        name: entryName(directory, i),
        offset: directory.readInt32LE(at),
        length: directory.readInt32LE(at + 4),
      })
    }
    return { ok: true, names: entries.map((e) => e.name), entries }
  } catch {
    return REFUSED
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
