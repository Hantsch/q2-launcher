/**
 * Parses the connectionless `status` reply's body — one serverinfo line followed by one line per
 * connected player — into a typed result.
 *
 * The reply to a `status` query carries the command token `print`, not `status`
 * (`\xff\xff\xff\xffprint\n...`), so that is what the envelope is read against. Everything after
 * the envelope is this module's job: the first line is handed to `splitInfostring`
 * (`./infostring.ts`), the rest are player lines.
 *
 * ## Why the player section is all-or-nothing
 *
 * A busy server's `status` reply is routinely cut short by the path MTU, and a cut lands
 * mid-line. A partial player list is indistinguishable downstream from a complete one, so
 * accepting one would make the watchlist report a player who *is* on the server as gone — the
 * failure mode story 108 calls out by name. Any structurally broken player line therefore fails
 * the whole reply with `'truncated'`, even when earlier lines parsed fine. The opposite case — a
 * reply with no player lines at all — is not a failure but a genuinely empty server:
 * `{ ok: true, players: [] }`. Distinguishing those two is the entire point of the union.
 *
 * ## Why the separators are `[ \t]`, never `\s`
 *
 * A player name is arbitrary bytes, and Quake II's colour ("green") charset lives in 0x80-0xFF.
 * After `decodeLatin1`, byte 0xA0 is the code unit U+00A0, which JavaScript's `\s` **matches** —
 * so a `\s`-based split would silently eat a name's leading colour byte or cut a token in half.
 * Only space and tab are separators here; everything from the third field on is the name,
 * verbatim.
 *
 * Never throws on malformed/foreign input — only the `StatusReplyResult` union is returned.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */

import { splitInfostring } from './infostring'
import { readConnectionlessReply } from './protocol'
import type { ServerReplyFailure } from './protocol'

/** One connected player as a `status` reply reports them. Exactly these three fields — the raw
 * line is deliberately not carried along, so nothing downstream can re-parse it differently. */
export interface ServerPlayer {
  score: number
  ping: number
  name: string
}

/** A successfully parsed `status` reply: the raw serverinfo record plus the complete player list
 * (`[]` for an empty server — never a partial list, see the file doc comment). */
export interface StatusReplySuccess {
  ok: true
  serverinfo: Record<string, string>
  players: ServerPlayer[]
}

/** `parseStatusReply`'s result: a parsed reply, or a failure carrying one of
 * `ServerReplyFailureReason`'s codes (shared with `readConnectionlessReply` and `parseInfoReply`). */
export type StatusReplyResult = StatusReplySuccess | ServerReplyFailure

/** Same strict decimal-integer rule `readIntKey` applies — a leading `-` is allowed because a
 * score goes negative in plenty of mods and a ping of `-1` is how bots are reported. */
const INTEGER_PATTERN = /^-?\d+$/

/**
 * `[leading blanks] score <blanks> ping <blanks> name...` — see the file doc comment on why the
 * separator class is `[ \t]` and not `\s`. The name group must start with a non-separator, so a
 * line that stops after the ping field (no name at all) does not match and is reported as a cut.
 */
const PLAYER_LINE_PATTERN = /^[ \t]*([^ \t]+)[ \t]+([^ \t]+)[ \t]+([^ \t][\s\S]*)$/

/**
 * Mirrors `splitInfostring`'s own leading/trailing-backslash trim just far enough to count
 * segments — an odd count after that trim means the line ends on a key with no value, i.e. it was
 * cut before the value (or the following backslash) arrived. This does not duplicate
 * `splitInfostring`'s pairing/dedup logic, only the one fact this module needs from it.
 */
function hasDanglingKey(line: string): boolean {
  const segments = line.split('\\').filter((segment, index, all) => {
    const isLeadingEmpty = index === 0 && segment === ''
    const isTrailingEmpty = index === all.length - 1 && segment === ''
    return !(isLeadingEmpty || isTrailingEmpty)
  })
  return segments.length > 0 && segments.length % 2 === 1
}

type PlayerLineOutcome =
  { ok: true; player: ServerPlayer } | { ok: false; reason: 'truncated' | 'malformed-player-line' }

/**
 * Reads the name out of a player line's third field.
 *
 * A quoted name is the common case: exactly the outer two quotes are stripped, the last quote on
 * the line winning as the closing one, so an embedded `"` inside a name survives. An opening
 * quote with no closing quote is a cut mid-name (`undefined` → `'truncated'`). A field that does
 * not open with a quote is an unquoted name and is taken verbatim.
 */
function readPlayerName(field: string): string | undefined {
  if (!field.startsWith('"')) return field
  if (field.length < 2 || !field.endsWith('"')) return undefined
  return field.slice(1, -1)
}

function parsePlayerLine(line: string): PlayerLineOutcome {
  const match = PLAYER_LINE_PATTERN.exec(line)
  // Fewer than three fields: the line was cut before a name could arrive.
  if (!match) return { ok: false, reason: 'truncated' }

  const scoreText = match[1] as string
  const pingText = match[2] as string
  const nameField = match[3] as string

  // Both numeric fields are present but one is not a number: the server sent something the
  // protocol does not allow. That is a violation, not a cut — a cut takes the *end* of a line.
  if (!INTEGER_PATTERN.test(scoreText) || !INTEGER_PATTERN.test(pingText)) {
    return { ok: false, reason: 'malformed-player-line' }
  }

  const name = readPlayerName(nameField)
  if (name === undefined) return { ok: false, reason: 'truncated' }

  return { ok: true, player: { score: Number(scoreText), ping: Number(pingText), name } }
}

/**
 * Parses an inbound `status` connectionless reply datagram.
 *
 * 1. Strips the envelope via `readConnectionlessReply(bytes, 'print')`, propagating whatever
 *    failure reason it returns (`too-short`, `not-connectionless`, `unexpected-command`, ...).
 * 2. The first body line is the serverinfo line. Two distinct broken shapes are told apart, per
 *    the story's own truncation-signal list:
 *    - nothing of it arrived at all (empty/whitespace-only, and nothing follows it either) —
 *      there is no line to call "cut", so this is `'malformed-infostring'`, mirroring
 *      `parseInfoReply`;
 *    - it arrived but stops mid-key with no following newline (an odd number of backslash
 *      segments once the leading/trailing empties `splitInfostring` also ignores are stripped,
 *      and nothing follows on the wire) — that dangling key is exactly the "cut mid-serverinfo"
 *      shape the story calls a truncation, not a malformed reply, so it is `'truncated'`.
 *    A dangling key followed by more content (i.e. more lines did arrive) is not a cut — that is
 *    `splitInfostring`'s ordinary "dangling final key is dropped" tolerance, unchanged.
 * 3. Every following line is a player line. A single empty element at the very end is the
 *    optional trailing newline many servers do send, and is skipped; any other broken line fails
 *    the whole reply (`'truncated'` for a cut, `'malformed-player-line'` for a non-numeric
 *    score/ping). A trailing newline is never *required* — most real servers omit it.
 */
export function parseStatusReply(bytes: Uint8Array): StatusReplyResult {
  const envelope = readConnectionlessReply(bytes, 'print')
  if (!envelope.ok) return envelope

  const lines = envelope.body.split('\n')
  const serverinfoLine = lines[0] ?? ''
  const nothingFollows = lines.length === 1

  if (serverinfoLine.trim().length === 0 && nothingFollows) {
    return { ok: false, reason: 'malformed-infostring' }
  }
  if (nothingFollows && hasDanglingKey(serverinfoLine)) {
    return { ok: false, reason: 'truncated' }
  }

  const serverinfo = splitInfostring(serverinfoLine)

  const players: ServerPlayer[] = []
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index] as string
    if (line === '' && index === lines.length - 1) continue

    const outcome = parsePlayerLine(line)
    if (!outcome.ok) return { ok: false, reason: outcome.reason }
    players.push(outcome.player)
  }

  return { ok: true, serverinfo, players }
}
