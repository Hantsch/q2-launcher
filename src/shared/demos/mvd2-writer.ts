/**
 * Builds synthetic `.mvd2` byte streams for `mvd2-header.test.ts` — the writer half of the fixture
 * pair `mvd2-header.ts` needs, mirroring `dm2-writer.ts`'s role for the `.dm2` parser: hand-
 * assembled bytes a test can shape precisely, never anything captured off a real client/server.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { encodeLatin1 } from '../servers/protocol'

const MVD_SERVERDATA = 4

export interface BuildMvd2Options {
  version: number
  /** Only meaningful (and only written as its own field) from version 2012 on; before that, the
   * top 3 bits of the `cmd` byte carry it instead. Defaults to 0. */
  flags?: number
  protocol?: number
  gameDir: string
  clientNum: number
  configstrings: Record<number, string>
  layout?: 'original' | 'extended'
  /** Appends this many additional dummy `[uint16 len][len zero bytes]` blocks after block 1. */
  trailingBlocks?: number
  /** If `false`, omits the final `uint16 0` end-of-file marker. Defaults to appending it. */
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

/** The layout's configstring-loop end marker: `MAX_CONFIGSTRINGS` for whichever table
 * (`original`/`extended`) the caller asked for — kept in sync by hand with `dm2-header.ts`'s
 * `ORIGINAL_LAYOUT`/`EXTENDED_LAYOUT` rather than importing them, so this writer can build layouts
 * `parseMvd2Header` would reject too (e.g. a deliberately wrong end marker), if ever needed. */
function layoutEnd(layout: 'original' | 'extended'): number {
  return layout === 'extended' ? 13630 : 2080
}

/**
 * Assembles a synthetic `.mvd2` byte stream: the `"MVD2"` magic, one length-prefixed block 1
 * containing an `mvd_serverdata` message (`cmd`, `protocol`, `version`, optionally `flags`,
 * `servercount`, `gamedir`, `clientNum`) followed by one inline configstring per `configstrings`
 * entry (ascending index order) and the layout's end marker, optionally followed by
 * `trailingBlocks` dummy blocks and/or the `uint16 0` end-of-file marker.
 */
export function buildMvd2(opts: BuildMvd2Options): Uint8Array {
  const {
    version,
    flags = 0,
    protocol = 37,
    gameDir,
    clientNum,
    configstrings,
    layout = 'original',
    trailingBlocks,
    terminate,
  } = opts

  const block: number[] = []

  const cmd = version >= 2012 ? MVD_SERVERDATA : (MVD_SERVERDATA & 31) | ((flags & 7) << 5)
  block.push(cmd & 0xff)
  pushInt32LE(block, protocol)
  pushUint16LE(block, version & 0xffff)
  if (version >= 2012) pushUint16LE(block, flags & 0xffff)
  pushInt32LE(block, 1) // servercount
  pushCString(block, gameDir)
  pushUint16LE(block, clientNum & 0xffff)

  const sortedIndices = Object.keys(configstrings)
    .map((k) => Number(k))
    .sort((a, b) => a - b)
  for (const index of sortedIndices) {
    pushUint16LE(block, index)
    pushCString(block, configstrings[index]!)
  }
  pushUint16LE(block, layoutEnd(layout))

  const out: number[] = [0x4d, 0x56, 0x44, 0x32] // "MVD2"
  pushUint16LE(out, block.length)
  for (const b of block) out.push(b)

  if (trailingBlocks !== undefined) {
    for (let i = 0; i < trailingBlocks; i++) {
      pushUint16LE(out, 4)
      out.push(0, 0, 0, 0)
    }
  }

  if (terminate !== false) pushUint16LE(out, 0)

  return new Uint8Array(out)
}
