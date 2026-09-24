/**
 * Parses the connectionless `info` reply's body — a single serverinfo line, no player list
 * (that is `status`'s job, a separate deliverable's `status-reply.ts`) — into a typed result.
 *
 * `readConnectionlessReply` (`./protocol.ts`) already strips the `OOB_PREFIX` + command envelope;
 * this module only interprets what is left: split the body with `splitInfostring` (`./infostring.ts`)
 * and read the well-known keys off the result, never inventing a value `splitInfostring`/`readIntKey`
 * did not actually produce.
 *
 * Never throws on malformed/foreign input — only the `InfoReplyResult` union is returned for
 * anything bytes-derived.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { readIntKey, splitInfostring } from './infostring'
import { readConnectionlessReply } from './protocol'
import type { ServerReplyFailure } from './protocol'

/** A successfully parsed `info` reply: the raw serverinfo record plus the well-known fields read
 * out of it. A field stays `undefined` when its key was absent or, for the numeric fields, present
 * but not a clean integer — never coerced to a fake value. */
export interface InfoReplySuccess {
  ok: true
  serverinfo: Record<string, string>
  hostname?: string
  map?: string
  clients?: number
  maxClients?: number
}

/** `parseInfoReply`'s result: a parsed reply, or a failure carrying one of
 * `ServerReplyFailureReason`'s codes (shared with `readConnectionlessReply` and the `status` reply
 * parser). */
export type InfoReplyResult = InfoReplySuccess | ServerReplyFailure

/**
 * Parses an inbound `info` connectionless reply datagram.
 *
 * 1. Strips the envelope via `readConnectionlessReply(bytes, 'info')`, propagating whatever
 *    failure reason it returns (`too-short`, `not-connectionless`, `unexpected-command`, ...).
 * 2. An empty or whitespace-only body — nothing to split at all — fails with
 *    `'malformed-infostring'`. A body that splits into *something*, even if it is missing specific
 *    well-known keys, is not an error (AC4): missing keys simply come back `undefined` below.
 * 3. Splits the body into the raw `serverinfo` record and reads `hostname`, `mapname`, `clients`
 *    and `maxclients` off it.
 */
export function parseInfoReply(bytes: Uint8Array): InfoReplyResult {
  const envelope = readConnectionlessReply(bytes, 'info')
  if (!envelope.ok) return envelope

  const body = envelope.body
  if (body.trim().length === 0) return { ok: false, reason: 'malformed-infostring' }

  const serverinfo = splitInfostring(body)

  const hostname = typeof serverinfo.hostname === 'string' ? serverinfo.hostname : undefined
  const map = typeof serverinfo.mapname === 'string' ? serverinfo.mapname : undefined
  const clients = readIntKey(serverinfo, 'clients')
  const maxClients = readIntKey(serverinfo, 'maxclients')

  return { ok: true, serverinfo, hostname, map, clients, maxClients }
}
