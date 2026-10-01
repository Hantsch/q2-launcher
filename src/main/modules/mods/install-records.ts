import { z } from 'zod'

/**
 * The mods module's slice of an installation's `moduleData` (`moduleData.mods`).
 *
 * Story 190 (install) extends this schema with the rest of a record; it must keep the
 * `records[].gameDir` key, which story 188 reads to tell catalog from manual game dirs.
 * Read defensively: a bad envelope is an empty set, a bad row is dropped.
 */
const recordRowSchema = z.object({ gameDir: z.string().min(1) })

/** Lower-cased game directory names the launcher has an install record for. */
export function recordedGameDirs(moduleData: unknown): Set<string> {
  const result = new Set<string>()
  if (typeof moduleData !== 'object' || moduleData === null) return result
  const envelope = (moduleData as Record<string, unknown>)['mods']
  if (typeof envelope !== 'object' || envelope === null) return result
  const records = (envelope as Record<string, unknown>)['records']
  if (!Array.isArray(records)) return result
  for (const row of records) {
    const parsed = recordRowSchema.safeParse(row)
    if (parsed.success) result.add(parsed.data.gameDir.toLowerCase())
  }
  return result
}
