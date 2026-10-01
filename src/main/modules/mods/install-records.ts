import { z } from 'zod'
import type { ModInstallRecord } from '@shared/modules/mods'

/**
 * The mods module's slice of an installation's `moduleData` (`moduleData.mods`) - the one parser
 * of that key. Read defensively: a bad envelope is an empty set, a bad row is dropped, nothing
 * throws.
 */
/** A recorded path is later deleted (story 191): only plain gamedir-relative, forward-slash paths pass. */
export function isSafeRecordedPath(path: string): boolean {
  if (path.length === 0 || /[\\\0]/.test(path) || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return false
  return path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
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
    'r1q2', 'q2pro', 'yquake2', 'kmquake2', 'vkquake2', 'q2rtx', 'vanilla', 'remaster', 'custom', 'unknown',
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
  if (!Array.isArray(rows)) return { records: [] }
  const records: ModInstallRecord[] = []
  for (const row of rows) {
    const parsed = recordSchema.safeParse(row)
    if (parsed.success) records.push(parsed.data as ModInstallRecord)
  }
  return { records }
}

/** Returns a new `moduleData` with `record` replacing any record of the same game dir (case-insensitive). */
export function withRecord(moduleData: unknown, record: ModInstallRecord): Record<string, unknown> {
  const base =
    typeof moduleData === 'object' && moduleData !== null ? (moduleData as Record<string, unknown>) : {}
  const key = record.gameDir.toLowerCase()
  const kept = readModsState(moduleData).records.filter((r) => r.gameDir.toLowerCase() !== key)
  return { ...base, mods: { records: [...kept, record] } }
}

/**
 * Lower-cased game directory names the launcher has an install record for. Deliberately lenient:
 * a row only needs a `gameDir` to count (story 188 tells catalog from manual by that alone).
 */
export function recordedGameDirs(moduleData: unknown): Set<string> {
  const result = new Set<string>()
  const rows = envelopeOf(moduleData)?.['records']
  if (!Array.isArray(rows)) return result
  for (const row of rows) {
    const parsed = z.object({ gameDir: z.string().min(1) }).safeParse(row)
    if (parsed.success) result.add(parsed.data.gameDir.toLowerCase())
  }
  return result
}
