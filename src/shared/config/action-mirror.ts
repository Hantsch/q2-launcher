/**
 * The actions -> `binds` mirror, and the one function that answers "what value
 * does the mirror write for this action" (story 034).
 *
 * Until this story the answer was always `aliasNameFor(action)` and the mirror
 * itself lived inline in `setActions` (`src/main/modules/config/profiles.ts`).
 * Story 034 needs it in `src/shared` for two reasons:
 *
 * - `bind-adoption.ts` turns a raw `bind w "+forward"` into a catalogue action
 *   and has to write that action's mirrored value back into `binds` in the same
 *   pass, so the mirror can no longer be private to one main-process method.
 * - A continuous (`+`) command must NOT be reached through an alias. The engine
 *   only sends the matching `-command` on key-up when the *bind string itself*
 *   starts with `+` (`keys.c`: `if (kb && kb[0] == '+')`), so `bind w
 *   q2l_a_forward_1234` presses `+forward` and never releases it - the key
 *   sticks. A catalogue row whose whole body is one such command therefore
 *   mirrors as that command verbatim, which is also exactly what an imported
 *   `config.cfg` already contains, so adopting one is lossless.
 *
 * Everything that *writes* a mirrored value, and everything that *recognises*
 * one (conflict scans, collision checks, release paths), goes through
 * `bindValueFor`/`isMirroredValue` here - one function, so a reader can never
 * disagree with the writer about what a mirror looks like.
 *
 * Pure by contract: no node, no DOM, no electron.
 */

import type { ConfigAction } from '@shared/modules/config'
import { LEGACY_ACTION_ALIAS_PREFIX, aliasNameFor } from '@shared/config/alias-render'
import { normalizeBindKey } from '@shared/config/key-names'

/**
 * The value the `binds`/`overrides` mirror writes for `action`.
 *
 * An alias for everything except the one case that cannot survive the
 * indirection: a **catalogue** row (`catalogId` set) whose body is a single raw
 * press/release command (`+forward`, `+attack`, ...) is bound to that command
 * directly. See the file doc comment for the engine rule behind it.
 *
 * The `catalogId` requirement is what keeps this narrow and collision-free: a
 * catalogue row's command text comes from `action-catalog.ts` and is unique per
 * row, so two actions can never claim the same direct value, which is what
 * makes the value-based strip passes below safe. A hand-written free-form
 * action carrying a `+command` keeps its alias (it may grow more commands, and
 * `validate-actions.ts` already warns about the press/release case).
 */
export function bindValueFor(action: ConfigAction): string {
  const [command] = action.commands
  if (
    action.kind !== 'alias' &&
    action.catalogId &&
    action.commands.length === 1 &&
    command?.kind === 'raw' &&
    /^[+-]/.test(command.text.trim())
  ) {
    return command.text.trim()
  }
  return aliasNameFor(action)
}

/**
 * Is `value` something a mirror pass wrote for one of `actions`?
 *
 * Matched by value against `bindValueFor` - before story 034 a
 * `startsWith(LEGACY_ACTION_ALIAS_PREFIX)` test was enough for that, and it no
 * longer is, since a continuous catalogue row now mirrors as its own command
 * text. Used wherever a reader has to tell a generated entry apart from a
 * hand-typed one.
 *
 * Optionally scoped to `key` (normalized, either slot - same idea as
 * `bind-adoption.ts`'s `mirrorsSlot`): when given, only an action that
 * actually holds that key can own `value`. That scoping used to be optional
 * because the legacy `q2l_a_<slug>_<id4>` prefix was already, on its own,
 * strong evidence nobody hand-typed the value. Story 039 removes that prefix:
 * once an alias's name is a short readable word like `ssg_sg`, a mirrored
 * value and a user's own `bind x "ssg_sg"` referencing that same alias by name
 * are byte-for-byte identical, so value alone can no longer tell them apart.
 * Passing the key the value was found on restores the missing precision - the
 * mirror for a given action only ever appears on a key that action itself
 * holds, so a coincidentally-matching value on any other key is necessarily
 * hand-typed. Every caller that reads a value off a specific slot should pass
 * its key; the no-key form remains for call sites (and tests) that only need
 * the old, unscoped "is this value a mirror of *something*" answer.
 */
export function isMirroredValue(
  value: string,
  actions: readonly ConfigAction[],
  key?: string,
): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  if (key === undefined) {
    return actions.some((action) => bindValueFor(action) === trimmed)
  }
  const normalizedKey = normalizeBindKey(key)
  const holdsKey = (action: ConfigAction): boolean =>
    (Boolean(action.key) && normalizeBindKey(action.key!) === normalizedKey) ||
    (Boolean(action.secondaryKey) && normalizeBindKey(action.secondaryKey!) === normalizedKey)
  return actions.some((action) => holdsKey(action) && bindValueFor(action) === trimmed)
}

/** The two bindable slots, as the mirrors read them off an action. */
function mirrorSlots(action: ConfigAction): { key: string | undefined; modified: boolean }[] {
  return [
    { key: action.key, modified: Boolean(action.keyModifier) },
    { key: action.secondaryKey, modified: Boolean(action.secondaryKeyModifier) },
  ]
}

/**
 * Rebuild the `binds` mirror - story 008 decision 17's rule, moved here
 * verbatim and extended with story 034's value-based strip:
 *
 * 1. Strip. **The ownership rule is key-scoped and value-based** (story 034):
 *    an entry is ours to remove exactly when its value is `bindValueFor` of an
 *    action in `previousActions` *on a key that action actually held*. Neither
 *    half carries ownership on its own - a value alone cannot, because a
 *    mirrored value is by construction something a user could equally have
 *    typed (a direct `+forward` mirror is byte-for-byte a hand-typed `bind w
 *    "+forward"`, and once alias names are readable, story 039, a mirrored
 *    `ssg_sg` is byte-for-byte a hand-typed reference to that same alias); a
 *    key alone cannot either, because a key is a slot, not an identity, and
 *    the user may have rebound it themselves in the meantime. Together they
 *    say "this is the entry the last mirror pass wrote for that slot", which
 *    is the only thing that licenses deleting it. That is what keeps a user's
 *    own `bind r "+attack"` or `bind x "ssg_sg"` on an unrelated key untouched
 *    while still letting a cleared Controls slot really clear its bind.
 *
 *    Plus, permanently, every entry whose value starts with
 *    `LEGACY_ACTION_ALIAS_PREFIX`. That prefix is **not** an ownership test and
 *    is no longer read as one (story 039): it says "an older version of this
 *    app generated this name" (`q2l_a_<slug>_<id4>`), and it is kept forever so
 *    a `q2l_a_*` orphan written before the readable-name flip - whose owning
 *    action may be long gone, i.e. in no `previousActions` this call will ever
 *    see - still disappears on the next save instead of sitting in the file for
 *    good. Its one cost is accepted knowingly: an own alias name a user
 *    deliberately types as `q2l_a_...` (legal, `alias-names.ts` does not ban
 *    the prefix) is treated as legacy debris wherever it is referenced by hand.
 * 2. Rewrite. One entry per key an action still carries, in `actions` array
 *    order (later wins on a collision, deterministically). A slot carrying a
 *    modifier belongs to that modifier's layer, not to `binds` (story 016
 *    decision 17), and a `kind: 'alias'` entry is never bound at all (story
 *    019) - both are skipped here and mirrored, or not, by
 *    `applyActionLayerMirror`.
 *
 * `previousActions` defaults to `actions`, which is the right answer for a
 * caller that is not changing the array at all (`setLayers`): an action that
 * still exists but lost its key is stripped either way, and only a *deleted*
 * action needs the previous array to be recognised.
 */
export function applyActionBindMirror(
  binds: Record<string, string>,
  actions: readonly ConfigAction[],
  previousActions: readonly ConfigAction[] = actions,
): Record<string, string> {
  const staleByKey = new Map<string, Set<string>>()
  for (const action of previousActions) {
    for (const slot of mirrorSlots(action)) {
      const key = slot.key?.trim()
      if (!key || slot.modified) continue
      const normalized = normalizeBindKey(key)
      const values = staleByKey.get(normalized) ?? new Set<string>()
      values.add(bindValueFor(action))
      staleByKey.set(normalized, values)
    }
  }

  const next: Record<string, string> = {}
  for (const [key, command] of Object.entries(binds)) {
    if (command.startsWith(LEGACY_ACTION_ALIAS_PREFIX)) continue
    if (staleByKey.get(normalizeBindKey(key))?.has(command.trim())) continue
    next[key] = command
  }

  for (const action of actions) {
    if (action.kind === 'alias') continue
    const value = bindValueFor(action)
    for (const slot of mirrorSlots(action)) {
      const key = slot.key?.trim()
      if (!key || slot.modified) continue
      next[normalizeBindKey(key)] = value
    }
  }

  return next
}
