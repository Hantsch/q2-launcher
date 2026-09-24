/**
 * Hand-built byte fixtures for the server-reply parsers' test suites.
 *
 * Everything here is a literal byte/string template, never anything captured off a real server
 * (GB-A5, story 108): a well-formed sample plus a small builder so a test can assemble its own
 * variant without hand-rolling the connectionless envelope itself.
 *
 * This file is `info`-reply-only for now (deliverable D3). Deliverable D4 (`status-reply.ts` /
 * `status-reply.test.ts`) extends this same module with its own `status`-reply builder/samples
 * (e.g. `buildStatusReplyBytes` / `SAMPLE_STATUS_REPLY`) — names below are deliberately prefixed
 * `Info`/`INFO` so the two sets of exports never collide.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { encodeLatin1, OOB_PREFIX } from './protocol'

/**
 * Assembles a well-formed `info` connectionless reply datagram: `OOB_PREFIX` + `"info\n"` +
 * `serverinfoLine`. `serverinfoLine` is the raw backslash-delimited body a real server would send
 * back (e.g. `"\\gamename\\baseq2\\hostname\\Test Server"`), or `''` to build a reply with an
 * empty body.
 */
export function buildInfoReplyBytes(serverinfoLine: string): Uint8Array {
  const bodyBytes = encodeLatin1(`info\n${serverinfoLine}`)
  const datagram = new Uint8Array(OOB_PREFIX.length + bodyBytes.length)
  datagram.set(OOB_PREFIX, 0)
  datagram.set(bodyBytes, OOB_PREFIX.length)
  return datagram
}

/** A realistic, well-formed `info` reply: every key `parseInfoReply` knows how to read, plus a
 * couple of others a real serverinfo string typically carries. */
export const SAMPLE_INFO_REPLY: Uint8Array = buildInfoReplyBytes(
  '\\gamename\\baseq2\\hostname\\Test Server\\mapname\\q2dm1\\clients\\3\\maxclients\\8\\version\\3.20',
)

/**
 * Assembles a `status` connectionless reply datagram: `OOB_PREFIX` + `"print\n"` (a `status`
 * query is answered with the `print` command token) + `serverinfoLine`, then one `"\n"` +
 * player line per entry in `playerLines`.
 *
 * No trailing newline is written after the last player line unless `trailingNewline` is set —
 * plenty of real servers omit it, so the default is the shape a parser must accept as complete.
 */
export function buildStatusReplyBytes(
  serverinfoLine: string,
  playerLines: string[],
  { trailingNewline = false }: { trailingNewline?: boolean } = {},
): Uint8Array {
  const players = playerLines.map((line) => `\n${line}`).join('')
  const body = `print\n${serverinfoLine}${players}${trailingNewline ? '\n' : ''}`
  const bodyBytes = encodeLatin1(body)
  const datagram = new Uint8Array(OOB_PREFIX.length + bodyBytes.length)
  datagram.set(OOB_PREFIX, 0)
  datagram.set(bodyBytes, OOB_PREFIX.length)
  return datagram
}

/** The serverinfo line the `status` fixtures below share, so a test that only cares about the
 * player section can build its own variant without restating it. */
export const SAMPLE_STATUS_SERVERINFO_LINE =
  '\\gamename\\baseq2\\hostname\\Test Server\\mapname\\q2dm1\\clients\\2\\maxclients\\8\\version\\3.20'

/** A realistic, well-formed `status` reply: the shared serverinfo line plus two players with
 * quoted names — a scored human and a bot (ping `-1`). */
export const SAMPLE_STATUS_REPLY: Uint8Array = buildStatusReplyBytes(
  SAMPLE_STATUS_SERVERINFO_LINE,
  ['3 25 "PlayerOne"', '0 -1 "AnotherPlayer"'],
)

/**
 * One player whose quoted name carries everything that must NOT be mistaken for a separator: a
 * high-bit byte (0x93, from Quake II's colour charset), embedded spaces, an embedded literal `"`
 * and a backslash. Written as a latin1 string literal so every code unit is exactly the byte
 * `encodeLatin1` will emit.
 */
export const SAMPLE_STATUS_REPLY_SPECIAL_NAME: Uint8Array = buildStatusReplyBytes(
  SAMPLE_STATUS_SERVERINFO_LINE,
  ['12 5 "Pl\x93ayer "Two" \\Test"'],
)
