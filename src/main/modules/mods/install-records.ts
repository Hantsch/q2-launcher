import { z } from 'zod'
import {
  modLastLaunchSchema,
  type ModInstallRecord,
  type ModLastLaunch,
} from '@shared/modules/mods'
import { parseForgivingRows } from '../../lib/forgiving'

/**
 * The mods module's slice of an installation's `moduleData` (`moduleData.mods`) - the one parser
 * of that key. Read defensively: a bad envelope is an empty set, a bad row is dropped, nothing
 * throws.
 */
/** A recorded path is later deleted (story 191): only plain gamedir-relative, forward-slash paths pass. */
export function isSafeRecordedPath(path: string): boolean {
  if (path.length === 0 || /[\\\0]/.test(path) || path.startsWith('/') || /^[a-zA-Z]:/.test(path))
    return false
  return path
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

const fileSchema = z.object({
  path: z.string().refine(isSafeRecordedPath),
  sizeBytes: z.number().finite().nonnegative(),
  sha256: z.string().min(1),
})

const recordSchema = z.object({
  catalogId: z.string().min(1),
  gameDir: z.string().min(1),
  version: z.string().min(1),
  variantId: z.string().min(1),
  engineKind: z.enum([
    'r1q2',
    'q2pro',
    'yquake2',
    'kmquake2',
    'vkquake2',
    'q2rtx',
    'vanilla',
    'remaster',
    'custom',
    'unknown',
  ]),
  arch: z.enum(['x86', 'x64', 'arm64', 'unknown']),
  platform: z.enum(['win32', 'linux']),
  contentOnly: z.boolean(),
  pkzUnsupported: z.boolean().optional().catch(undefined),
  installedAt: z.number().finite(),
  files: z.array(fileSchema),
})

export interface ModsState {
  records: ModInstallRecord[]
}

function envelopeOf(moduleData: unknown): Record<string, unknown> | undefined {
  if (typeof moduleData !== 'object' || moduleData === null) return undefined
  const envelope = (moduleData as Record<string, unknown>)['mods']
  if (typeof envelope !== 'object' || envelope === null) return undefined
  return envelope as Record<string, unknown>
}

/** Parses `moduleData.mods`; a bad record is dropped, garbage is `{ records: [] }`. Never throws. */
export function readModsState(moduleData: unknown): ModsState {
  const rows = envelopeOf(moduleData)?.['records']
  return { records: parseForgivingRows(recordSchema, rows) as ModInstallRecord[] }
}

function baseOf(moduleData: unknown): Record<string, unknown> {
  return typeof moduleData === 'object' && moduleData !== null
    ? (moduleData as Record<string, unknown>)
    : {}
}

/**
 * Every writer of `moduleData.mods` goes through here: the envelope holds the install records and
 * the remembered launch side by side, and rebuilding it from one of them alone would erase the
 * other - records lost mean the launcher can no longer update or remove a mod it installed.
 */
function withEnvelopeKey(
  moduleData: unknown,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const envelope = envelopeOf(moduleData)
  const kept = envelope && !Array.isArray(envelope) ? envelope : {}
  return { ...baseOf(moduleData), mods: { ...kept, [key]: value } }
}

/** Returns a new `moduleData` whose install records are `records`; every other key is kept. */
export function withRecords(
  moduleData: unknown,
  records: readonly ModInstallRecord[],
): Record<string, unknown> {
  return withEnvelopeKey(moduleData, 'records', [...records])
}

/** Returns a new `moduleData` with `record` replacing any record of the same game dir (case-insensitive). */
export function withRecord(moduleData: unknown, record: ModInstallRecord): Record<string, unknown> {
  const key = record.gameDir.toLowerCase()
  const kept = readModsState(moduleData).records.filter((r) => r.gameDir.toLowerCase() !== key)
  return withRecords(moduleData, [...kept, record])
}

/** The remembered launch choice; anything that does not parse reads as "nothing remembered" (story 249). */
export function readLastLaunch(moduleData: unknown): ModLastLaunch | null {
  return modLastLaunchSchema
    .nullable()
    .catch(null)
    .parse(envelopeOf(moduleData)?.['lastLaunch'] ?? null)
}

/** Returns a new `moduleData` remembering `choice` (only its choice fields); every other key is kept. */
export function withLastLaunch(
  moduleData: unknown,
  choice: ModLastLaunch,
): Record<string, unknown> {
  const { gameDir, map, gameType } = choice
  return withEnvelopeKey(moduleData, 'lastLaunch', { gameDir, map, gameType })
}

/**
 * Lower-cased game directory names the launcher has an install record for. Deliberately lenient:
 * a row only needs a `gameDir` to count (story 188 tells catalog from manual by that alone).
 */
export function recordedGameDirs(moduleData: unknown): Set<string> {
  const rows = envelopeOf(moduleData)?.['records']
  return new Set(
    parseForgivingRows(z.object({ gameDir: z.string().min(1) }), rows).map((r) =>
      r.gameDir.toLowerCase(),
    ),
  )
}
