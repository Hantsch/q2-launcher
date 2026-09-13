/**
 * Answers exactly one question, for exactly one caller-supplied blob of `.cfg` text: does the
 * launcher own this file, and if so, which profile id does it carry? (story 051)
 *
 * A `.cfg` file can carry that ownership stamp in one of two shapes, and this module reads both
 * without ever preferring or normalising between them at write time - that is D2/D3's job, not
 * this one's:
 *
 * - **banner** (story 051): a `[q2l …]` tag (`profile-metadata.ts`) that carries a defined `id`
 *   field, found on a `//` comment line within the file's first `HEADER_SCAN_LINES` lines. The
 *   header block D2 writes is four such lines - a `=` rule, the profile's display name, another
 *   `=` rule, and the tag alone, right-aligned, on the last line - but this reader does not care
 *   about that shape beyond "a `//` line, early in the file, whose tag has an `id`". A tag with
 *   `id` appearing *after* line `HEADER_SCAN_LINES` is prose as far as this module is concerned;
 *   the scan window exists precisely so a player who pastes an old header into the middle of a
 *   hand-edited file can never re-claim ownership by accident.
 * - **sentinel** (pre-051, still read forever): the file's first line starts with
 *   `OWNERSHIP_MARKER` (`@shared/config/render`) followed by whitespace and a profile id -
 *   `sentinelLine()`'s own format, `<OWNERSHIP_MARKER> <profileId> - hand-edited changes are read
 *   back`. Only the marker prefix and the first whitespace-delimited token after it are load-
 *   bearing; the trailing prose is never parsed.
 *
 * Neither shape is ever guessed at: a `//` comment with no `[q2l` tag, a tag with no `id`, a
 * malformed tag, or a line merely starting with something that looks like the marker but isn't
 * followed by whitespace-then-an-id, all fall through to the next line. A file exhausting all
 * `HEADER_SCAN_LINES` lines without a match is not launcher-owned - `readOwnershipStamp` returns
 * `null` rather than a best-effort guess, the same "never guess, always say so" discipline
 * `profile-metadata.ts#parseMetaTag` already applies to a single tag.
 */

import { OWNERSHIP_MARKER } from '@shared/config/render'
import { parseMetaTag } from '@shared/config/profile-metadata'

/** How many leading lines of a `.cfg` file are scanned for an ownership stamp. Fixed at 8 so a
 * banner header (four lines) always fits comfortably within the window even after a future
 * revision grows it a little, while still being small enough that a tag appearing deep inside a
 * hand-edited file's body can never be mistaken for ownership. */
export const HEADER_SCAN_LINES = 8

/** The result of a successful ownership read - see this module's doc comment for what
 * distinguishes `banner` from `sentinel`. `version` is the header tag's own `v` field for a
 * banner stamp (empty string when the tag carried no `v`, which cannot happen for a well-formed
 * D2-written header but is not treated as an error here), and always `''` for a sentinel stamp,
 * which has no version field at all. */
export interface OwnershipStamp {
  id: string
  version: string
  shape: 'banner' | 'sentinel'
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

/**
 * The profile id carried by a sentinel line, or `null` when `line` is not one.
 *
 * The sentinel half of what `readOwnershipStamp` below recognises, checked directly against
 * `OWNERSHIP_MARKER` under the same "never guess" discipline: the prefix must be followed by
 * whitespace (so `// q2-launcher profiles` - a different word - never matches), and there must
 * be a non-empty token after it.
 */
function sentinelId(line: string): string | null {
  if (!line.startsWith(OWNERSHIP_MARKER)) return null
  const rest = line.slice(OWNERSHIP_MARKER.length)
  if (rest.length > 0 && !/^\s/.test(rest)) return null
  const id = rest.trim().split(/\s/, 1)[0]
  return id !== undefined && id.length > 0 ? id : null
}

/**
 * Scans the first `HEADER_SCAN_LINES` lines of `text` for either ownership shape (see this
 * module's doc comment) and returns the first one found, in line order. Returns `null` when
 * neither shape is found within the scan window - including when a `[q2l … id=…]` tag exists but
 * only past line `HEADER_SCAN_LINES`, when a `//` line's tag is malformed or carries no `id`, or
 * when the file is a wholly foreign config with neither shape anywhere near its head.
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

/** `true` when `text` carries either ownership shape within its first `HEADER_SCAN_LINES` lines -
 * a thin convenience over `readOwnershipStamp` for callers that only need the yes/no answer. */
export function isLauncherOwnedFile(text: string): boolean {
  return readOwnershipStamp(text) !== null
}
