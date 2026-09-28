/**
 * Parses the header of a `.dm2` demo file — enough of it to answer "what map, whose POV, which
 * players" without reading the whole recording.
 *
 * A `.dm2` file is a sequence of `[int32 LE length][payload]` blocks, terminated by a block whose
 * length word is `-1` (no payload follows the terminator). Each block's payload holds one or more
 * whole Quake II network messages — a message never spans a block boundary in the header region.
 * The message loop this module cares about:
 *
 * 1. The very first message in the file must be `svc_serverdata` (opcode 12): `int32 protocol,
 *    int32 servercount, byte attractloop, string gamedir, int16 playernum, string level`.
 * 2. After that, `svc_configstring` messages (opcode 13: `uint16 index, string value`) are read
 *    until a message with any other opcode appears (the recording moving on to baselines/frames)
 *    or the `-1` terminator is hit.
 *
 * `protocol` selects which configstring index layout applies (`CS_MODELS`, `CS_PLAYERSKINS`,
 * `MAX_CONFIGSTRINGS` all shift between the original 2.xx wire protocol and the extended
 * r1q2/q2pro protocols) — see `LAYOUTS` below.
 *
 * Strings are NUL-terminated and decoded with `decodeLatin1` (`../servers/protocol.ts`)
 * byte-for-byte: Quake II is not UTF-8 and high-bit bytes (its built-in colour charset) must
 * survive exactly.
 *
 * Never throws: any malformed/foreign/truncated input resolves to a typed `Dm2Unparsable` reason
 * rather than an exception, and every loop below advances the cursor or returns on every
 * iteration — no path can spin forever on hostile input.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { decodeLatin1 } from '../servers/protocol'

/** A demo header this large without resolving is treated as foreign/corrupt data, not merely a
 * slow-to-load file — `header-too-large` is reported instead of `truncated` once the input is at
 * least this big and the header still has not ended. */
export const DM2_HEADER_MAX_BYTES = 1_048_576

/** Wire protocol numbers this parser understands: the original 2.xx protocol plus the extended
 * r1q2/q2pro protocol family. */
export type Dm2Protocol = 34 | 3434 | 3435 | 3436

/** One configstring index layout: where names, models and player skins start, and how many
 * configstring slots (and thus max clients) the protocol allows. */
interface Dm2Layout {
  layout: 'original' | 'extended'
  CS_NAME: number
  CS_MODELS: number
  CS_PLAYERSKINS: number
  MAX_CONFIGSTRINGS: number
  MAX_CLIENTS: number
}

const ORIGINAL_LAYOUT: Dm2Layout = {
  layout: 'original',
  CS_NAME: 0,
  CS_MODELS: 32,
  CS_PLAYERSKINS: 1312,
  MAX_CONFIGSTRINGS: 2080,
  MAX_CLIENTS: 256,
}

const EXTENDED_LAYOUT: Dm2Layout = {
  layout: 'extended',
  CS_NAME: 0,
  CS_MODELS: 62,
  CS_PLAYERSKINS: 12862,
  MAX_CONFIGSTRINGS: 13630,
  MAX_CLIENTS: 256,
}

const LAYOUTS: Partial<Record<number, Dm2Layout>> = {
  34: ORIGINAL_LAYOUT,
  3434: EXTENDED_LAYOUT,
  3435: EXTENDED_LAYOUT,
  3436: EXTENDED_LAYOUT,
}

const SVC_SERVERDATA = 12
const SVC_CONFIGSTRING = 13

/** A successfully parsed `.dm2` header. */
export type Dm2Header = {
  ok: true
  protocol: Dm2Protocol
  layout: 'original' | 'extended'
  gameDir: string
  levelName: string
  map: string | null
  pov: string | null
  players: string[]
  largestBlockBytes: number
  bytesConsumed: number
}

/** Why the header could not be resolved into a `Dm2Header`. `protocol` is set only for
 * `unknown-protocol`, carrying the raw (unsupported) protocol number that was read. */
export type Dm2Unparsable = {
  ok: false
  reason: 'empty' | 'truncated' | 'not-a-demo' | 'unknown-protocol' | 'header-too-large'
  protocol?: number
}

export type Dm2HeaderResult = Dm2Header | Dm2Unparsable

/** A byte cursor over the whole file, used both for the block length words and for messages
 * inside a block's payload. `blockEnd` bounds reads to the current block's payload so a message
 * can never be read across a block boundary. */
interface Cursor {
  bytes: Uint8Array
  offset: number
}

function outOfBounds(bytes: Uint8Array): Dm2Unparsable {
  return bytes.length >= DM2_HEADER_MAX_BYTES ? { ok: false, reason: 'header-too-large' } : { ok: false, reason: 'truncated' }
}

function readInt32LE(cursor: Cursor, limit: number): number | null {
  if (cursor.offset + 4 > limit) return null
  const b = cursor.bytes
  const o = cursor.offset
  const value = (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) | 0
  cursor.offset += 4
  return value
}

function readUint16LE(cursor: Cursor, limit: number): number | null {
  if (cursor.offset + 2 > limit) return null
  const b = cursor.bytes
  const o = cursor.offset
  const value = b[o]! | (b[o + 1]! << 8)
  cursor.offset += 2
  return value
}

function readByte(cursor: Cursor, limit: number): number | null {
  if (cursor.offset + 1 > limit) return null
  const value = cursor.bytes[cursor.offset]!
  cursor.offset += 1
  return value
}

/** Reads a NUL-terminated string within `[cursor.offset, limit)`. Returns `null` (without
 * advancing) if the NUL is never found before `limit`. */
function readCString(cursor: Cursor, limit: number): string | null {
  const b = cursor.bytes
  let end = cursor.offset
  while (end < limit && b[end] !== 0) end++
  if (end >= limit) return null // ran out of bytes before the terminating NUL
  const value = decodeLatin1(b.subarray(cursor.offset, end))
  cursor.offset = end + 1
  return value
}

/**
 * Parses a `.dm2` file's header: the leading `svc_serverdata` plus the run of `svc_configstring`
 * messages that follows, stopping at the first non-configstring message or the `-1` terminator.
 * See the file doc comment for the exact format and stopping rule.
 */
export function parseDm2Header(bytes: Uint8Array): Dm2HeaderResult {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }

  let protocolValue: number | null = null
  let layout: Dm2Layout | null = null
  let gameDir = ''
  let playernum = 0
  let serverdataLevel = ''
  const configstrings = new Map<number, string>()
  let sawFirstMessage = false
  let largestBlockBytes = 0
  let bytesConsumed = 0

  const fileCursor: Cursor = { bytes, offset: 0 }

  for (;;) {
    const blockStart = fileCursor.offset
    const length = readInt32LE(fileCursor, bytes.length)
    if (length === null) return outOfBounds(bytes)

    if (length === -1) {
      // Terminator: header ends here, no payload follows.
      bytesConsumed = fileCursor.offset
      return finish()
    }
    if (length < 0) return { ok: false, reason: 'not-a-demo' }

    const payloadStart = fileCursor.offset
    const payloadEnd = payloadStart + length
    if (payloadEnd > bytes.length) return outOfBounds(bytes)

    if (length > largestBlockBytes) largestBlockBytes = length

    const msgCursor: Cursor = { bytes, offset: payloadStart }
    let blockDone = false

    while (msgCursor.offset < payloadEnd) {
      const opcode = readByte(msgCursor, payloadEnd)
      if (opcode === null) return outOfBounds(bytes)

      if (!sawFirstMessage) {
        sawFirstMessage = true
        if (opcode !== SVC_SERVERDATA) return { ok: false, reason: 'not-a-demo' }

        const protocolRead = readInt32LE(msgCursor, payloadEnd)
        if (protocolRead === null) return outOfBounds(bytes)
        protocolValue = protocolRead

        const servercount = readInt32LE(msgCursor, payloadEnd)
        if (servercount === null) return outOfBounds(bytes)

        const attractloop = readByte(msgCursor, payloadEnd)
        if (attractloop === null) return outOfBounds(bytes)

        const gameDirRead = readCString(msgCursor, payloadEnd)
        if (gameDirRead === null) return outOfBounds(bytes)
        gameDir = gameDirRead

        const playernumRead = readUint16LE(msgCursor, payloadEnd)
        if (playernumRead === null) return outOfBounds(bytes)
        // playernum is a signed int16 on the wire (observer POV can be negative-ish in some
        // engines' encodings); reinterpret the 16 bits as signed.
        playernum = playernumRead > 0x7fff ? playernumRead - 0x10000 : playernumRead

        const levelRead = readCString(msgCursor, payloadEnd)
        if (levelRead === null) return outOfBounds(bytes)
        serverdataLevel = levelRead

        const found = LAYOUTS[protocolValue]
        if (found === undefined) return { ok: false, reason: 'unknown-protocol', protocol: protocolValue }
        layout = found

        continue
      }

      if (opcode !== SVC_CONFIGSTRING) {
        // Header parsing is done: this message is not consumed into the result.
        bytesConsumed = blockStart + 4 + length
        blockDone = true
        break
      }

      const index = readUint16LE(msgCursor, payloadEnd)
      if (index === null) return outOfBounds(bytes)
      if (layout === null || index >= layout.MAX_CONFIGSTRINGS) return { ok: false, reason: 'not-a-demo' }

      const value = readCString(msgCursor, payloadEnd)
      if (value === null) return outOfBounds(bytes)

      configstrings.set(index, value)
    }

    if (blockDone) return finish()

    // Whole block consumed by configstrings (or just serverdata); move to the next block.
    fileCursor.offset = payloadEnd
    bytesConsumed = payloadEnd
  }

  function finish(): Dm2HeaderResult {
    if (protocolValue === null || layout === null) return { ok: false, reason: 'not-a-demo' }

    const resolvedGameDir = gameDir === '' ? 'baseq2' : gameDir

    const nameCs = configstrings.get(layout.CS_NAME)
    const levelName = nameCs !== undefined && nameCs !== '' ? nameCs : serverdataLevel

    const modelsCs = configstrings.get(layout.CS_MODELS + 1)
    const map = modelsCs !== undefined && modelsCs !== '' ? stripMapPath(modelsCs) : null

    let pov: string | null = null
    if (playernum >= 0 && layout.CS_PLAYERSKINS + playernum < layout.MAX_CONFIGSTRINGS) {
      const povCs = configstrings.get(layout.CS_PLAYERSKINS + playernum)
      if (povCs !== undefined && povCs !== '') pov = upToBackslash(povCs)
    }

    const players: string[] = []
    for (let i = 0; i < 256; i++) {
      const slot = configstrings.get(layout.CS_PLAYERSKINS + i)
      if (slot !== undefined && slot !== '') players.push(upToBackslash(slot))
    }

    return {
      ok: true,
      protocol: protocolValue as Dm2Protocol,
      layout: layout.layout,
      gameDir: resolvedGameDir,
      levelName,
      map,
      pov,
      players,
      largestBlockBytes,
      bytesConsumed,
    }
  }
}

function upToBackslash(value: string): string {
  const i = value.indexOf('\\')
  return i === -1 ? value : value.slice(0, i)
}

function stripMapPath(value: string): string {
  let result = value
  if (/^maps\//i.test(result)) result = result.slice('maps/'.length)
  if (/\.bsp$/i.test(result)) result = result.slice(0, -'.bsp'.length)
  return result
}
