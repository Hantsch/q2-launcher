/**
 * Row-level derivations for the servers list — pure functions that turn raw scan data into the
 * markers a server list row shows (gamemode, known player count, "waiting for an opponent"). Same
 * conventions as `src/shared/servers/infostring.ts`: pure, never throws, and a missing/unparseable
 * source value never gets an invented default.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no IPC.
 */
import { readIntKey } from './infostring'
import type { ServerListEntry } from '../modules/servers'

/** The gamemode a server's `serverinfo` reports, derived from its dm/coop/ctf/teamplay flags. */
export type ServerGamemode = 'ctf' | 'team' | 'deathmatch' | 'coop' | 'single'

/**
 * Derives a server's gamemode from its `serverinfo` flags. A missing key counts as `0`; if none of
 * the four keys (`deathmatch`/`coop`/`ctf`/`teamplay`) is present and parseable as an integer at
 * all, the gamemode is unknown (`undefined`) rather than guessed as `'single'`.
 *
 * Precedence: `ctf` != 0 wins outright; otherwise `deathmatch` != 0 and `teamplay` != 0 together
 * mean `'team'`; otherwise `deathmatch` != 0 alone means `'deathmatch'`; otherwise `coop` != 0 means
 * `'coop'`; otherwise `'single'`.
 */
export function deriveGamemode(serverinfo: Record<string, string>): ServerGamemode | undefined {
  const deathmatch = readIntKey(serverinfo, 'deathmatch')
  const coop = readIntKey(serverinfo, 'coop')
  const ctf = readIntKey(serverinfo, 'ctf')
  const teamplay = readIntKey(serverinfo, 'teamplay')

  if (deathmatch === undefined && coop === undefined && ctf === undefined && teamplay === undefined) {
    return undefined
  }

  const dm = deathmatch ?? 0
  const co = coop ?? 0
  const cf = ctf ?? 0
  const tp = teamplay ?? 0

  if (cf !== 0) return 'ctf'
  if (dm !== 0 && tp !== 0) return 'team'
  if (dm !== 0) return 'deathmatch'
  if (co !== 0) return 'coop'
  return 'single'
}

/**
 * The number of players actually known for a row: the roster length when `players` is the full
 * array (post stage-2 `status` reply), the reported count when it is still just a number (stage-1
 * `info` reply), or `undefined` when neither is known yet.
 */
export function knownPlayerCount(entry: Pick<ServerListEntry, 'players'>): number | undefined {
  const players = entry.players
  if (Array.isArray(players)) return players.length
  if (typeof players === 'number') return players
  return undefined
}

/**
 * Whether a row looks like it is waiting for an opponent - exactly one known player, regardless of
 * whether that count came from a roster array or a bare number.
 */
export function isWaitingForOpponent(entry: Pick<ServerListEntry, 'players'>): boolean {
  return knownPlayerCount(entry) === 1
}
