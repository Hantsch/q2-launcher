import type { ConfigProfile } from '@shared/modules/config'

/**
 * Profile file-name resolution — the pure half of story 022. A profile's
 * on-disk name is `<sanitized-name>.cfg`, computed once over the whole
 * profile list so that a collision between two different names can actually
 * be seen and resolved (a per-profile function cannot know about the others).
 *
 * The canonical file, every installation's copy, the loader's `exec` line and
 * the switch-bind chain all consume the same `Map<id, fileName>` this module
 * produces, so they can never disagree with each other about what a profile
 * is called on disk.
 *
 * Pure by contract: this file lives in `src/shared`, so no `node:*`, no DOM,
 * no `electron`.
 */

/** `.cfg` extension every resolved file name carries. */
const CFG_EXTENSION = '.cfg'

/**
 * Characters kept as-is in a profile file base name — the repo's existing
 * `GAME_DIR_TOKEN` set (`src/main/modules/config/writer.ts`), reused here
 * rather than redefined, since both exist to keep a string safe as a
 * filesystem path segment.
 */
const SAFE_CHARS = /[^A-Za-z0-9_.-]+/g

/** Two or more `-` in a row, collapsed to one. */
const DASH_RUNS = /-+/g

/** Leading/trailing `.` or `-`, trimmed off. */
const EDGE_DOTS_DASHES = /^[.-]+|[.-]+$/g

/** Cap on a sanitized base's length (excluding the `.cfg` extension). */
const MAX_BASE_LENGTH = 48

/**
 * Windows reserved device names: writing `<name>.cfg` where `<name>`
 * case-insensitively matches one of these addresses a device, not a file.
 * Checked against the whole base only, never a substring of it.
 */
const RESERVED_DEVICE_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

/**
 * Sanitize a human-entered profile name into a filesystem-safe base (no
 * extension):
 *
 * - Every character outside `[A-Za-z0-9_.-]` maps to `-` (spaces, quotes,
 *   unicode, anything the shell/engine or the filesystem could choke on).
 * - Runs of `-` collapse to one, so `"My  Config"` and `"My-Config"` sanitize
 *   the same way.
 * - Leading/trailing `.` or `-` are trimmed - a leading `.` would make a
 *   hidden file on some platforms, a leading/trailing `-` reads oddly next to
 *   the `-2`/`-3` collision suffix.
 * - The result is capped at 48 characters: this name is embedded in an
 *   `exec <file>` line inside a cfg, where a space/quote/`;`/`$` breaks the
 *   loader line, and 48 keeps a switch-bind step alias far below the engine's
 *   1024-byte line limit.
 * - If nothing survives (an empty or all-invalid name), the fallback is
 *   `profile-<first 8 chars of id>` - deterministic from the profile's own
 *   id, so two blank-named profiles still resolve to different bases before
 *   collision handling even runs.
 * - A result that case-insensitively matches a Windows reserved device name
 *   (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`) gets `-cfg`
 *   appended, checked against the whole base only.
 */
export function sanitizeProfileFileBase(name: string, id: string): string {
  const sanitized = name
    .replace(SAFE_CHARS, '-')
    .replace(DASH_RUNS, '-')
    .replace(EDGE_DOTS_DASHES, '')
    .slice(0, MAX_BASE_LENGTH)
    // Truncation can leave a trailing `-` right at the cap; re-trim rather
    // than accept a base ending mid-run.
    .replace(EDGE_DOTS_DASHES, '')

  const base = sanitized || `profile-${id.slice(0, 8)}`

  return RESERVED_DEVICE_NAMES.has(base.toUpperCase()) ? `${base}-cfg` : base
}

/**
 * Resolve every profile's `.cfg` file name at once, so collisions across the
 * whole list can be seen and disambiguated instead of silently overwriting
 * each other.
 *
 * A single global order - by `createdAt` ascending (ISO strings sort
 * lexically), tie-broken by `id` ascending - decides who claims a contested
 * name first. It is derived only from profile content, never from the input
 * array's position, so reordering `profiles` produces an identical mapping.
 * Each profile in that order claims the first of `<base>.cfg`, `<base>-2.cfg`,
 * `<base>-3.cfg`, ... that is not already claimed (case-insensitively -
 * Windows/macOS fold filename case).
 *
 * This is a global claim, not a per-base-group one (review finding): two
 * profiles literally named e.g. `Frag` and `Frag-2` sanitize to two DIFFERENT
 * bases (`frag`, `frag-2`), so grouping by base alone would let the second
 * `Frag` claim `Frag-2.cfg` - the exact same string the literal `Frag-2`
 * profile also claims unsuffixed - and the two would overwrite each other's
 * file. Claiming against one global, ever-growing set instead of one set per
 * base means a later profile's suffixed name can never step on an earlier
 * profile's plain (or itself-suffixed) name, whatever either profile is
 * named.
 */
export function resolveProfileFileNames(
  profiles: readonly Pick<ConfigProfile, 'id' | 'name' | 'createdAt'>[],
): Map<string, string> {
  const withBase = profiles.map((profile) => ({
    profile,
    base: sanitizeProfileFileBase(profile.name, profile.id),
  }))

  const ordered = [...withBase].sort((a, b) => {
    if (a.profile.createdAt !== b.profile.createdAt) {
      return a.profile.createdAt < b.profile.createdAt ? -1 : 1
    }
    return a.profile.id < b.profile.id ? -1 : a.profile.id > b.profile.id ? 1 : 0
  })

  const result = new Map<string, string>()
  const claimed = new Set<string>()

  for (const entry of ordered) {
    let candidate = entry.base
    let suffix = 1
    while (claimed.has(candidate.toLowerCase())) {
      suffix += 1
      candidate = `${entry.base}-${suffix}`
    }
    claimed.add(candidate.toLowerCase())
    result.set(entry.profile.id, `${candidate}${CFG_EXTENSION}`)
  }

  return result
}
