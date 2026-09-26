/**
 * Parses the connectionless `info` reply's body — one fixed-format summary line, no player list
 * (that is `status`'s job, a separate deliverable's `status-reply.ts`) — into a typed result.
 *
 * `readConnectionlessReply` (`./protocol.ts`) already strips the `OOB_PREFIX` + command envelope;
 * this module only interprets what is left. Unlike `status`, the `info` body is *not* a
 * backslash infostring: Quake II (and r1q2/q2pro, verified against live servers) formats it as
 * `"%16s %8s %2i/%2i\n"` — hostname, map, clients/maxclients — e.g.
 * `"Dediz Rocket Arena 2 w/ Gladiator Bots  ra2map9 11/24\n"`. The hostname may contain spaces and
 * is not truncated, so the line is read from the right: the last token is `clients/maxclients`,
 * the one before it is the map, everything left of that is the hostname.
 *
 * Never throws on malformed/foreign input — only the `InfoReplyResult` union is returned for
 * anything bytes-derived.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { readConnectionlessReply } from './protocol'
import type { ServerReplyFailure } from './protocol'

/** A successfully parsed `info` reply: the well-known fields read out of the summary line, plus
 * the same fields as a `serverinfo` record under their infostring key names (`hostname`,
 * `mapname`, `clients`, `maxclients`) so consumers can read an `info` and a `status` reply the
 * same way. A field stays `undefined` (and its key absent) when the line did not carry it. */
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

/** `<hostname> <map> <clients>/<maxclients>` — `%2i` pads single digits, hence `\/\s*`. */
const INFO_LINE_PATTERN = /^(.*?)\s*(\S+)\s+(\d+)\/\s*(\d+)\s*$/

/**
 * Parses an inbound `info` connectionless reply datagram.
 *
 * 1. Strips the envelope via `readConnectionlessReply(bytes, 'info')`, propagating whatever
 *    failure reason it returns (`too-short`, `not-connectionless`, `unexpected-command`, ...).
 * 2. An empty or whitespace-only body fails with `'malformed-infostring'`.
 * 3. A non-empty body that is not the `<hostname> <map> <clients>/<maxclients>` line (truncated,
 *    or a `"<hostname>: wrong version"` answer) is still a reply, just one with no fields.
 * 4. An empty (all-padding) hostname stays `undefined` rather than becoming `''`.
 */
export function parseInfoReply(bytes: Uint8Array): InfoReplyResult {
  const envelope = readConnectionlessReply(bytes, 'info')
  if (!envelope.ok) return envelope

  const line = envelope.body.split('\n')[0] ?? ''
  if (line.trim().length === 0) return { ok: false, reason: 'malformed-infostring' }
  const match = INFO_LINE_PATTERN.exec(line)
  // The server did answer - it is online - but the line cannot be read: Quake II formats it into a
  // 64-byte buffer, so a long hostname truncates the map/counts away, and a `wrong version` answer
  // carries neither. Nothing on it can be told apart reliably, so no field is claimed.
  if (match === null) return { ok: true, serverinfo: {} }

  const [, rawHostname = '', map = '', clientsText = '', maxClientsText = ''] = match
  const hostname = rawHostname.trim() === '' ? undefined : rawHostname.trim()
  const clients = Number(clientsText)
  const maxClients = Number(maxClientsText)

  const serverinfo: Record<string, string> = {
    mapname: map,
    clients: clientsText,
    maxclients: maxClientsText,
  }
  if (hostname !== undefined) serverinfo.hostname = hostname

  return { ok: true, serverinfo, hostname, map, clients, maxClients }
}
