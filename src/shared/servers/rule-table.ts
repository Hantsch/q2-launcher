/**
 * Builds the full "rules a server plays by" table out of a raw `serverinfo` map: every key the
 * server actually reported, either parsed into a typed `RuleValue` when the key is one the
 * launcher understands, or carried through verbatim as a raw string pair otherwise. A key whose
 * own parser rejects its value is never dropped or moved to `raw` - it stays in `known` as
 * `{ kind: 'unparsed' }`, since the server did report it.
 *
 * This module returns typed descriptors only - no i18n strings, no formatting. Labels and
 * formatting are a renderer concern.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*` import, no DOM types, no
 * `Buffer`, no IPC.
 */
import { decodeDmflags } from './dmflags'

/** The known keys this table understands, in the fixed order they are shown. */
const KNOWN_KEYS = [
  'hostname',
  'mapname',
  'gamename',
  'gamedir',
  'game',
  'maxclients',
  'protocol',
  'version',
  'port',
  'needpass',
  'deathmatch',
  'coop',
  'ctf',
  'teamplay',
  'dmflags',
  'fraglimit',
  'timelimit',
  'capturelimit',
  'cheats',
  'maptime',
  'uptime',
  'gamedate'
] as const

type KnownKey = (typeof KNOWN_KEYS)[number]

const TEXT_KEYS: ReadonlySet<KnownKey> = new Set([
  'hostname',
  'mapname',
  'gamename',
  'gamedir',
  'game',
  'version',
  'gamedate'
])
const INT_KEYS: ReadonlySet<KnownKey> = new Set(['maxclients', 'port'])
const FLAG_KEYS: ReadonlySet<KnownKey> = new Set(['deathmatch', 'coop', 'ctf', 'teamplay', 'cheats'])
const LIMIT_KEYS: ReadonlySet<KnownKey> = new Set(['fraglimit', 'capturelimit'])
const DURATION_KEYS: ReadonlySet<KnownKey> = new Set(['maptime', 'uptime'])

const INTEGER_PATTERN = /^-?\d+$/
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/

export type RuleValue =
  | { kind: 'text'; value: string }
  | { kind: 'int'; value: number }
  | { kind: 'protocol'; value: number; engine: 'vanilla' | 'r1q2' | 'q2pro' | undefined }
  | { kind: 'needpass'; password: boolean; spectatorPassword: boolean }
  | { kind: 'flag'; value: number; on: boolean }
  | { kind: 'limit'; value: number }
  | { kind: 'minutes'; value: number }
  | { kind: 'duration'; seconds: number }
  | { kind: 'dmflags'; value: number }
  | { kind: 'unparsed'; raw: string }

export interface KnownRuleRow {
  key: KnownKey
  value: RuleValue
}

export interface RawRuleRow {
  key: string
  value: string
}

export interface RuleTable {
  known: KnownRuleRow[]
  raw: RawRuleRow[]
  dmflags?: { raw: string; decoded: ReturnType<typeof decodeDmflags> }
}

function parseProtocolEngine(value: number): 'vanilla' | 'r1q2' | 'q2pro' | undefined {
  if (value === 34) return 'vanilla'
  if (value === 35) return 'r1q2'
  if (value === 36) return 'q2pro'
  return undefined
}

function parseKnownValue(key: KnownKey, raw: string): RuleValue {
  if (TEXT_KEYS.has(key)) {
    return { kind: 'text', value: raw }
  }

  if (INT_KEYS.has(key)) {
    if (!INTEGER_PATTERN.test(raw)) return { kind: 'unparsed', raw }
    return { kind: 'int', value: Number(raw) }
  }

  if (key === 'protocol') {
    if (!INTEGER_PATTERN.test(raw)) return { kind: 'unparsed', raw }
    const value = Number(raw)
    return { kind: 'protocol', value, engine: parseProtocolEngine(value) }
  }

  if (key === 'needpass') {
    if (!INTEGER_PATTERN.test(raw)) return { kind: 'unparsed', raw }
    const value = Number(raw)
    return { kind: 'needpass', password: (value & 1) !== 0, spectatorPassword: (value & 2) !== 0 }
  }

  if (FLAG_KEYS.has(key)) {
    if (!INTEGER_PATTERN.test(raw)) return { kind: 'unparsed', raw }
    const value = Number(raw)
    return { kind: 'flag', value, on: value !== 0 }
  }

  if (LIMIT_KEYS.has(key)) {
    if (!INTEGER_PATTERN.test(raw)) return { kind: 'unparsed', raw }
    return { kind: 'limit', value: Number(raw) }
  }

  if (key === 'timelimit') {
    if (!DECIMAL_PATTERN.test(raw)) return { kind: 'unparsed', raw }
    return { kind: 'minutes', value: Number(raw) }
  }

  if (DURATION_KEYS.has(key)) {
    if (NON_NEGATIVE_INTEGER_PATTERN.test(raw)) return { kind: 'duration', seconds: Number(raw) }
    if (raw.length > 0) return { kind: 'text', value: raw }
    return { kind: 'unparsed', raw }
  }

  // key === 'dmflags'
  if (!INTEGER_PATTERN.test(raw)) return { kind: 'unparsed', raw }
  return { kind: 'dmflags', value: Number(raw) }
}

/**
 * Splits a raw `serverinfo` map into the known, ordered rule rows this table understands plus
 * everything else verbatim. Every key present in `serverinfo` appears exactly once, either in
 * `known` or in `raw` - never both, never dropped.
 */
export function buildRuleTable(serverinfo: Record<string, string>): RuleTable {
  const known: KnownRuleRow[] = []
  const consumed = new Set<string>()

  for (const key of KNOWN_KEYS) {
    if (!(key in serverinfo)) continue
    const raw = serverinfo[key] as string
    known.push({ key, value: parseKnownValue(key, raw) })
    consumed.add(key)
  }

  const raw: RawRuleRow[] = Object.keys(serverinfo)
    .filter((key) => !consumed.has(key))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => ({ key, value: serverinfo[key] as string }))

  const result: RuleTable = { known, raw }

  if ('dmflags' in serverinfo) {
    const dmflagsRaw = serverinfo.dmflags as string
    result.dmflags = { raw: dmflagsRaw, decoded: decodeDmflags(dmflagsRaw) }
  }

  return result
}
