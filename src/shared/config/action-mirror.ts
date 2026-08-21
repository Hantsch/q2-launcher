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
import { ACTION_ALIAS_PREFIX, aliasNameFor } from '@shared/config/alias-render'
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
 * Matched by value against `bindValueFor`, never by which key it happens to sit
 * on - a key is a slot, not an identity (`modifier-layers.ts` makes the same
 * point). Used wherever a reader has to tell a generated entry apart from a
 * hand-typed one; before story 034 a `startsWith(ACTION_ALIAS_PREFIX)` test was
 * enough for that, and it no longer is, since a continuous catalogue row now
 * mirrors as its own command text.
 */
export function isMirroredValue(value: string, actions: readonly ConfigAction[]): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  return actions.some((action) => bindValueFor(action) === trimmed)
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
 * 1. Strip. Every entry whose value starts with `ACTION_ALIAS_PREFIX` (only a
 *    mirror pass can have written one), plus every entry whose value is
 *    `bindValueFor` of an action in `previousActions` *on the key that action
 *    held*. The second half exists because a direct `+forward` mirror is
 *    indistinguishable from a hand-typed one by value alone: scoping it to the
 *    key the previous action actually carried keeps a user's own `bind r
 *    "+attack"` on an unrelated key untouched while still letting a cleared
 *    Controls slot really clear its bind.
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
    if (command.startsWith(ACTION_ALIAS_PREFIX)) continue
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
