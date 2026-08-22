/**
 * The alias reference graph — one function that answers "does anything in
 * this profile call this alias by name" (story 038).
 *
 * Before this module the question had exactly one asker,
 * `validate-actions.ts`'s lenient "referenced by anything" pass, computed
 * inline there. Story 038 needs the same answer from a second, unrelated
 * asker — the writer, deciding whether an action's alias line has any reason
 * to exist at all — so the scan is extracted here verbatim (same shapes, same
 * lower-casing) rather than duplicated. `collectAliasReferences` is exactly
 * that extraction, widened by exactly one shape (see below); `bareTokens`'/
 * `undefinedAlias`'s own, *stricter* scan in `validate-actions.ts` is
 * untouched — that one has a `catalogId` exclusion and a sign requirement
 * neither asker here needs, and is still that module's own business.
 *
 * Pure by contract, like `action-mirror.ts`: no `fs`, no DOM, no electron.
 *
 * ## What counts as a reference
 *
 * An alias takes no arguments, so the only shape that can ever *call* one is
 * a bare (argument-less) top-level segment of a raw command — same rule
 * `validate-actions.ts`'s own file doc comment explains at length. Candidates
 * come from three places, all lower-cased into one set. Each value is run
 * through `alt-layers.ts`'s `sanitizeCommand` before it is scanned — the same
 * transform `render.ts`/`alt-layers.ts` apply before a `binds`/`overrides`
 * value is actually written to the `.cfg` file — so a value that reaches the
 * scan quote-wrapped (schema-legal for `binds`/`overrides`, though the UI's
 * own save path already strips quotes before it gets that far) is recognised
 * exactly the way the real render treats it, rather than being compared,
 * quotes and all, against an alias name that never carries any:
 *
 * - every `kind: 'raw'` command of every action in `sources.actions` (not
 *   only "candidate bindings" — an alias's own recursive body, a message
 *   entry's text, anything). Action command text is already
 *   schema-guaranteed quote-free (`actionTextSchema`), so sanitizing it here
 *   is a no-op kept only for uniformity with the other two sources;
 * - every value of `sources.binds` (a hand-typed `bind r "+test"` on the raw
 *   Binds tab is exactly as real a reference as one typed into an action);
 * - every value of every layer's `overrides` in `sources.layers`.
 *
 * Widened by exactly one further shape (the one addition over the pass this
 * extracts): the **target token** of a `bind <key> <token>` segment. Story
 * 041 imports precisely that construct (`alias cali "bind KP_END
 * drop_shotgun"`) — a plain bare-token scan would miss `drop_shotgun`
 * entirely because the segment as a whole has whitespace and is therefore
 * never a *candidate* under the bare-segment rule above. Only the widening
 * changes; a target token that itself carries arguments (more than one
 * further token after the key) is not a shape this module recognises and is
 * left alone, same as any other segment with whitespace left in it.
 *
 * Missing a real reference here means the writer silently drops an alias line
 * something still calls — a live key going dead. The widening can therefore
 * only ever add candidates, never remove one the un-widened scan already
 * found; on the validation side it can only make `aliasUnreferenced` quieter,
 * never noisier.
 *
 * No self-exclusion: an action whose own command text happens to contain its
 * own alias name (a recursive body) counts as referenced by that text, same
 * as any other occurrence. That is the user's business, and treating it as a
 * reference is the safe side (keeping a line beats dropping a live one).
 */

import type { ConfigAction } from '../modules/config'
import { sanitizeCommand, type AltLayer } from './alt-layers'
import { aliasNameFor } from './alias-render'
import { bindValueFor } from './action-mirror'

/**
 * Everything `collectAliasReferences`/`actionsWithAliasLine` read a profile's
 * reference candidates from. `binds`/`layers` default to "none" at the call
 * site (both optional here) since not every caller has both in scope — same
 * shape `validate-actions.ts`'s own `references` parameter already uses.
 */
export interface AliasReferenceSources {
  actions: ConfigAction[]
  binds?: Record<string, string>
  layers?: AltLayer[]
}

/**
 * The target token of a `bind <key> <token>` segment, lower-cased, or
 * `undefined` when `segment` is not exactly that three-word shape. `token`
 * itself must be a single further word - a target carrying its own arguments
 * is not a shape this widening recognises (see the file doc comment).
 */
function bindTargetToken(segment: string): string | undefined {
  const match = /^bind\s+(\S+)\s+(\S+)$/i.exec(segment.trim())
  if (!match) return undefined
  return match[2]!.toLowerCase()
}

/**
 * Every candidate reference token in one already-sanitized command string,
 * lower-cased. Callers pass `text` through `sanitizeCommand` first (see the
 * file doc comment) so a quote-wrapped value scans the same way the real
 * render treats it.
 */
function collectFromText(text: string, tokens: Set<string>): void {
  for (const segment of text.split(';').map((part) => part.trim())) {
    if (segment.length === 0) continue
    if (!/\s/.test(segment)) {
      tokens.add(segment.toLowerCase())
      continue
    }
    const target = bindTargetToken(segment)
    if (target) tokens.add(target)
  }
}

/**
 * The lower-cased set of every token anything in `sources` could be calling
 * by name - see the file doc comment for the three source shapes and the
 * `bind <key> <token>` widening. Not filtered against any "is this actually a
 * defined alias" set; the caller (`validate-actions.ts`'s `aliasUnreferenced`
 * pass, or `actionsWithAliasLine` below) decides what to do with membership.
 */
export function collectAliasReferences(sources: AliasReferenceSources): Set<string> {
  const tokens = new Set<string>()

  for (const action of sources.actions) {
    for (const command of action.commands) {
      if (command.kind !== 'raw') continue
      collectFromText(sanitizeCommand(command.text), tokens)
    }
  }

  for (const value of Object.values(sources.binds ?? {})) {
    collectFromText(sanitizeCommand(value), tokens)
  }

  for (const layer of sources.layers ?? []) {
    for (const value of Object.values(layer.overrides)) {
      collectFromText(sanitizeCommand(value), tokens)
    }
  }

  return tokens
}

/**
 * `actions`, minus every entry whose alias line the writer has no reason to
 * emit (story 038's root fix). An action is dropped exactly when all three
 * guards hold:
 *
 * - `action.kind !== 'alias'` - a `kind: 'alias'` entry exists to be called by
 *   name and may legitimately be unreferenced (that is Care's
 *   `aliasUnreferenced` warning, not the writer's business - AC6).
 * - `bindValueFor(action) !== aliasNameFor(action)` - the action's own bind
 *   mirror does not go through the alias at all (a continuous catalogue row
 *   bound to its bare command, `action-mirror.ts`'s story 034 case), so the
 *   alias has no bind of its own calling it either.
 * - its alias name is not in `collectAliasReferences(sources)` - nothing
 *   else in the profile (another action, a base bind, a layer override, a
 *   `bind <key> <token>` body) calls it by name.
 *
 * A keyless, unreferenced `kind: 'bind'`/`'message'` action survives: its
 * `bindValueFor` equals its alias name (no catalogue mirror in play), so the
 * second guard already keeps it - user-authored content the user may be
 * about to bind, not this story's dead-catalogue-row case (User decision).
 *
 * Pure, like `collectAliasReferences` - no `fs`, no DOM, no electron. The
 * drop is per action, so a chunked `_p1`/`_p2` family (`alias-render.ts`'s
 * `renderActionAlias`) always disappears whole: dropping the action here
 * means `renderActionAliasLines` never sees it and never emits any of its
 * parts.
 */
export function actionsWithAliasLine(
  actions: ConfigAction[],
  sources: AliasReferenceSources,
): ConfigAction[] {
  const referenced = collectAliasReferences(sources)
  return actions.filter((action) => {
    if (action.kind === 'alias') return true
    if (bindValueFor(action) === aliasNameFor(action)) return true
    return referenced.has(aliasNameFor(action).toLowerCase())
  })
}
