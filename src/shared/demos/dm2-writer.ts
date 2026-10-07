/**
 * Builds synthetic `.dm2` byte streams for `dm2-header.test.ts` — the writer half of the fixture
 * pair `dm2-header.ts` needs, mirroring `src/shared/servers/reply-fixtures.ts`'s role for the
 * server-reply parsers: hand-assembled bytes a test can shape precisely, never anything captured
 * off a real client/server.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { encodeLatin1 } from '../servers/protocol'
import type { Dm2Protocol } from './dm2-header'

const SVC_SERVERDATA = 12
const SVC_CONFIGSTRING = 13

export interface BuildDm2Options {
  protocol: Dm2Protocol
  gameDir: string
  playernum: number
  configstrings: Record<number, string>
  /** If set, splits the header messages across multiple blocks so no block payload exceeds this
   * many bytes. Splits only happen between whole messages, never mid-message. */
  maxBlockPayload?: number
  /** If set, appends one more message after the header messages: opcode 14
   * (`svc_spawnbaseline`-shaped, i.e. "some other opcode") followed by this many filler bytes. */
  trailingFrameBytes?: number
  /** If true, appends the `-1` terminator block (no payload) after everything else. */
  terminate?: boolean
}

function pushInt32LE(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
}

function pushUint16LE(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >>> 8) & 0xff)
}

function pushCString(bytes: number[], value: string): void {
  const encoded = encodeLatin1(value)
  for (const b of encoded) bytes.push(b)
  bytes.push(0)
}

/** Builds one `svc_serverdata` message's bytes. */
function buildServerdataMessage(
  protocol: number,
  gameDir: string,
  playernum: number,
  level: string,
): number[] {
  const msg: number[] = []
  msg.push(SVC_SERVERDATA)
  pushInt32LE(msg, protocol) // protocol
  pushInt32LE(msg, 1) // servercount
  msg.push(0) // attractloop
  pushCString(msg, gameDir)
  pushUint16LE(msg, playernum & 0xffff)
  pushCString(msg, level)
  return msg
}

/** Builds one `svc_configstring` message's bytes. */
function buildConfigstringMessage(index: number, value: string): number[] {
  const msg: number[] = []
  msg.push(SVC_CONFIGSTRING)
  pushUint16LE(msg, index)
  pushCString(msg, value)
  return msg
}

/**
 * Assembles a synthetic `.dm2` byte stream: an `svc_serverdata` message, one `svc_configstring`
 * message per `configstrings` entry (ascending index order), an optional trailing
 * "some other message" (opcode 14 + filler bytes), all split into `[int32 LE length][payload]`
 * blocks (respecting `maxBlockPayload` if set, otherwise everything in one block), optionally
 * followed by the `-1` terminator block.
 */
export function buildDm2(opts: BuildDm2Options): Uint8Array {
  const {
    protocol,
    gameDir,
    playernum,
    configstrings,
    maxBlockPayload,
    trailingFrameBytes,
    terminate,
  } = opts

  const messages: number[][] = []
  messages.push(buildServerdataMessage(protocol, gameDir, playernum, 'level'))

  const sortedIndices = Object.keys(configstrings)
    .map((k) => Number(k))
    .sort((a, b) => a - b)
  for (const index of sortedIndices) {
    messages.push(buildConfigstringMessage(index, configstrings[index]!))
  }

  if (trailingFrameBytes !== undefined && trailingFrameBytes >= 0) {
    const msg: number[] = [14]
    for (let i = 0; i < trailingFrameBytes; i++) msg.push(i & 0xff)
    messages.push(msg)
  }

  // Group messages into blocks, respecting maxBlockPayload (splits only between whole messages).
  const blocks: number[][] = []
  let current: number[] = []
  const limit = maxBlockPayload ?? Number.POSITIVE_INFINITY
  for (const msg of messages) {
    if (current.length > 0 && current.length + msg.length > limit) {
      blocks.push(current)
      current = []
    }
    for (const b of msg) current.push(b)
  }
  if (current.length > 0 || blocks.length === 0) blocks.push(current)

  const out: number[] = []
  for (const block of blocks) {
    pushInt32LE(out, block.length)
    for (const b of block) out.push(b)
  }

  if (terminate) pushInt32LE(out, -1)

  return new Uint8Array(out)
}
