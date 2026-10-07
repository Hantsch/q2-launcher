/**
 * Does the launcher own this `.cfg` text, and if so which profile id does it carry? (story 051)
 *
 * Two stamp shapes are read, neither preferred or normalised here:
 *
 * - **banner**: a `[q2l …]` tag (`profile-metadata.ts`) with a defined `id`, on a `//` line within
 *   the first `HEADER_SCAN_LINES` lines. A tag past the window is prose, so a pasted old header in
 *   a hand-edited file can never re-claim ownership.
 * - **sentinel** (pre-051, read forever): the first line starts with `OWNERSHIP_MARKER`
 *   (`@shared/config/render/render`), whitespace, then a profile id. Only the prefix and the first
 *   token after it are load-bearing; the trailing prose is never parsed.
 *
 * Nothing is guessed: a `//` line with no tag, a tag with no `id`, a malformed tag or a marker-like
 * prefix without whitespace-then-id all fall through, and no match means not launcher-owned (`null`).
 */

import { OWNERSHIP_MARKER } from '@shared/config/syntax/file-vocabulary'
import { parseMetaTag } from '@shared/config/profile/profile-metadata'

/** How many leading lines of a `.cfg` file are scanned for an ownership stamp: enough for the
 * four-line banner header, too few for a tag deep in a hand-edited body to pass as ownership. */
export const HEADER_SCAN_LINES = 8

/** A successful ownership read. `version` is the banner tag's `v` (`''` if absent) and always `''`
 * for a sentinel, which has no version field. */
export interface OwnershipStamp {
  id: string
  version: string
  shape: 'banner' | 'sentinel'
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

/** The id a sentinel line carries, or `null`: the prefix must be followed by whitespace, so
 * `// q2-launcher profiles` never matches. */
function sentinelId(line: string): string | null {
  if (!line.startsWith(OWNERSHIP_MARKER)) return null
  const rest = line.slice(OWNERSHIP_MARKER.length)
  if (rest.length > 0 && !/^\s/.test(rest)) return null
  const id = rest.trim().split(/\s/, 1)[0]
  return id !== undefined && id.length > 0 ? id : null
}

/**
 * Scans the first `HEADER_SCAN_LINES` lines of `text` for either stamp and returns the first found
 * in line order, or `null` (including a tag past the window, a malformed tag or one without `id`).
 */
export function readOwnershipStamp(text: string): OwnershipStamp | null {
  const lines = splitLines(text).slice(0, HEADER_SCAN_LINES)

  for (const line of lines) {
    const sentinel = sentinelId(line)
    if (sentinel !== null) {
      return { id: sentinel, version: '', shape: 'sentinel' }
    }

    const trimmed = line.trimStart()
    if (!trimmed.startsWith('//')) continue

    const parsed = parseMetaTag(trimmed.slice(2))
    if (parsed.malformed) continue

    const id = parsed.fields.id
    if (id !== undefined && id.length > 0) {
      return { id, version: parsed.fields.v ?? '', shape: 'banner' }
    }
  }

  return null
}

/** `true` when `text` carries either ownership shape within its first `HEADER_SCAN_LINES` lines. */
export function isLauncherOwnedFile(text: string): boolean {
  return readOwnershipStamp(text) !== null
}
