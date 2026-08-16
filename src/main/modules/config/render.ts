import type { ConfigProfile } from '@shared/modules/config'
import { generateLayerAliases } from '@shared/config/alt-layers'
import { renderActionAliasLines } from '@shared/config/alias-render'
import type { SwitchBindChainInput } from './switch-bind'
import { renderSwitchBindChain } from './switch-bind'

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
 * Renders a profile's own cvars+binds(+layers) file (what gets written to
 * `baseq2/q2l-profile-<id>.cfg`). Deterministic: cvars and binds are each
 * emitted in ascending key order (`Object.keys(...).sort()`), never insertion
 * order, so the same profile always renders byte-identical output regardless
 * of how its maps were built. Layers (story 006) and actions (story 008) are
 * the two exceptions to "sorted": they render in `profile.layers` /
 * `profile.actions` array order, with each layer's aliases in the order
 * `generateLayerAliases()` (a pure function, so this stays deterministic)
 * returns them - the stories specify this as "array order", not alphabetical,
 * since neither has a natural sort key.
 *
 * Layout: sentinel line, `set <name> "<value>"` per cvar (sorted), every
 * layer's alias lines (array order, layer by layer, aliases in generation
 * order), every action's alias lines (array order, each action's chunk
 * aliases before the alias that calls them - see `./alias-render`),
 * `bind <key> "<value>"` per base bind (sorted), then one
 * `bind <trigger> <command>` per layer that actually produced aliases (array
 * order again). A layer with no valid overrides generates `aliases: []` but
 * still returns a nominal `triggerBind` - emitting that bind would point the
 * trigger key at an alias that was never defined, so it is skipped for empty
 * layers (see `generateLayerAliases`'s own doc comment).
 *
 * Actions add no bind line of their own: the `setActions` handler mirrors every
 * keyed action into `profile.binds` as `<key> -> <alias name>` (story 008
 * decision 17), so the sorted bind block above already emits them and
 * `profile.binds` stays the single source of truth for key -> command. An
 * action whose commands are all empty produces no alias at all, exactly as an
 * empty layer does.
 *
 * Trigger bind lines are deliberately unquoted (`bind <key> <command>`, not
 * `bind <key> "<command>"`): `triggerBind.command` is always a single slugged
 * alias name (`+drops`, `zoom`) with no spaces, so quoting it would just be a
 * second convention alongside the unquoted single-token commands
 * `generateLayerAliases` itself already writes inside alias bodies (e.g.
 * `bind 1 weapnext`) - introducing quotes here would be inconsistent with
 * that, for no benefit.
 *
 * Ends with a single trailing newline (`\n` only - never `\r\n`).
 */
export function renderProfileFile(profile: ConfigProfile): string {
  const lines: string[] = [sentinelLine(profile.id)]

  for (const name of Object.keys(profile.cvars).sort()) {
    lines.push(`set ${name} "${profile.cvars[name]}"`)
  }

  const layers = profile.layers ?? []
  const layerResults = layers.map((layer) => generateLayerAliases(layer, profile.binds))

  for (const { aliases } of layerResults) {
    for (const alias of aliases) {
      lines.push(alias.line)
    }
  }

  for (const line of renderActionAliasLines(profile.actions ?? [])) {
    lines.push(line)
  }

  for (const key of Object.keys(profile.binds).sort()) {
    lines.push(`bind ${key} "${profile.binds[key]}"`)
  }

  for (const { aliases, triggerBind } of layerResults) {
    if (aliases.length === 0) continue
    lines.push(`bind ${triggerBind.key} ${triggerBind.command}`)
  }

  return `${lines.join('\n')}\n`
}

/**
 * Renders the loader (what gets written to every `autoexec.cfg` - baseq2's
 * own and every played-mod folder's copy): a sentinel line for `profile.id`
 * followed by `exec <profileFileName>`. This is deliberately a separate, tiny
 * function from `renderProfileFile` because the loader is always generated
 * for whichever profile is an installation's *default*, which is not
 * necessarily the profile whose own cvars file was just (re)written -
 * callers pass whatever profile object is currently the default.
 *
 * `switchBind` is story 007's optional in-session profile switch chain
 * (`./switch-bind`): when given, its rendered chain is appended after the
 * `exec` line, since the loader `autoexec.cfg` is the one file every
 * profile's own `exec` cannot clobber (story 007 decision 4). Called with no
 * second argument, or with an input `renderSwitchBindChain` reduces to `''`
 * for (fewer than 2 profiles, or no usable key - see its own doc comment),
 * this renders byte-identical to the plain sentinel+exec loader. The chain
 * text itself carries no trailing newline, so it slots in as one more line
 * before the loader's own final `\n`.
 */
export function renderLoaderFile(profile: ConfigProfile, switchBind?: SwitchBindChainInput): string {
  const chain = switchBind ? renderSwitchBindChain(switchBind) : ''
  const lines = [sentinelLine(profile.id), `exec ${profileFileName(profile.id)}`]
  if (chain) lines.push(chain)
  return `${lines.join('\n')}\n`
}
