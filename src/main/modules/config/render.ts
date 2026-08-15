import type { ConfigProfile } from '@shared/modules/config'

/**
 * Turns a `ConfigProfile` into the deterministic `.cfg` text q2-launcher
 * writes to disk. Pure - no `fs`, no encoding choice. The caller (the
 * writer) is responsible for writing the resulting string out as `latin1`;
 * this module only has to make sure the strings it produces are safe to
 * round-trip through that encoding, which plain string concatenation of
 * latin1-range characters guarantees on its own.
 */

export const PROFILE_FILE_PREFIX = 'q2l-profile-'
export const PROFILE_FILE_SUFFIX = '.cfg'

/** File name of a profile's own cfg file inside baseq2, e.g. "q2l-profile-<id>.cfg". */
export function profileFileName(profileId: string): string {
  return `${PROFILE_FILE_PREFIX}${profileId}${PROFILE_FILE_SUFFIX}`
}

/**
 * Prefix every q2-launcher-generated file starts with. Used both to write the
 * sentinel line and, by the writer, to detect "is this a file we generated
 * previously" (vs. the user's own hand-written file) - the prefix is checked,
 * not the whole line, because the loader file's sentinel legitimately carries a
 * *different* profile id across saves (whichever profile is the installation's
 * current default) and must still be recognised as ours.
 */
export const OWNERSHIP_MARKER = '// q2-launcher profile'

/**
 * Full sentinel comment line for `profileId`.
 *
 * Uses a plain ASCII hyphen rather than an em dash: the whole line has to
 * survive the writer's latin1 round trip byte-for-byte (see the encoding
 * note above), and an em dash (U+2014) does not - `Buffer.from(str,
 * 'latin1')` truncates it to a control character. Every profile emits this
 * line, so a non-ASCII separator here would break every write, not just ones
 * with high-ASCII cvar/bind values.
 */
export function sentinelLine(profileId: string): string {
  return `${OWNERSHIP_MARKER} ${profileId} - generated, do not edit`
}

/**
 * Renders a profile's own cvars+binds file (what gets written to
 * `baseq2/q2l-profile-<id>.cfg`). Deterministic: cvars and binds are each
 * emitted in ascending key order (`Object.keys(...).sort()`), never insertion
 * order, so the same profile always renders byte-identical output regardless
 * of how its maps were built. Starts with the sentinel line. Cvars as
 * `set <name> "<value>"`, binds as `bind <key> "<value>"`, one per line.
 * Ends with a single trailing newline (`\n` only - never `\r\n`).
 */
export function renderProfileFile(profile: ConfigProfile): string {
  const lines: string[] = [sentinelLine(profile.id)]

  for (const name of Object.keys(profile.cvars).sort()) {
    lines.push(`set ${name} "${profile.cvars[name]}"`)
  }

  for (const key of Object.keys(profile.binds).sort()) {
    lines.push(`bind ${key} "${profile.binds[key]}"`)
  }

  return `${lines.join('\n')}\n`
}

/**
 * Renders the one-line loader (what gets written to every `autoexec.cfg` -
 * baseq2's own and every played-mod folder's copy): a sentinel line for
 * `profile.id` followed by `exec <profileFileName>`. This is deliberately a
 * separate, tiny function from `renderProfileFile` because the loader is
 * always generated for whichever profile is an installation's *default*,
 * which is not necessarily the profile whose own cvars file was just
 * (re)written - callers pass whatever profile object is currently the
 * default.
 */
export function renderLoaderFile(profile: ConfigProfile): string {
  return `${sentinelLine(profile.id)}\nexec ${profileFileName(profile.id)}\n`
}
