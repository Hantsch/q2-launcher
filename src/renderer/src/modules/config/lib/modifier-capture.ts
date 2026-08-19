/**
 * Modifier-aware capture resolution for the dual-bind editor (story 016,
 * acceptance criterion 1).
 *
 * Quake II has no real modifier keys (see `src/shared/config/alt-layers.ts`'s
 * doc comment): the engine sees ALT and R as two unrelated keys, so there is
 * no `bind` that means "ALT+R". What the dual-bind editor actually wants from
 * a capture slot is a *decision*: is the user asking for a plain key, or for a
 * key-plus-modifier that should route through an alt layer instead of a
 * literal bind? `resolveModifierCapture` is that decision, made from one
 * keydown event and nothing else - no layer lookup, no persistence, no UI.
 *
 * Built on top of `resolveQuakeKeyName` (`./keyboard-layout`), which turns a
 * `code` into the physical key the engine would bind. This module never
 * changes that function or its signature; it only interprets the modifier
 * flags the DOM reports alongside it.
 */

import { resolveQuakeKeyName } from './keyboard-layout'

/** One of the three modifier keys the engine's own keyboard has, spelled the way `bind` would use them if it could. */
export type ModifierKey = 'ALT' | 'CTRL' | 'SHIFT'

/**
 * What a single keydown means for the dual-bind capture slot.
 *
 * - `plain` - an ordinary key, no modifier held. Bind it as-is.
 * - `modifier` - exactly one modifier held while a non-modifier key was
 *   pressed (e.g. Alt+R). `key` and `modifier` are always reported
 *   separately, never combined into one string - the engine has no combined
 *   token to store, and keeping them apart is what lets a later step (not
 *   this one) decide which alt layer, if any, this maps to.
 * - `pending` - a modifier key went down on its own. Not a result yet: users
 *   press Alt *before* the actual key, so the first keydown of the gesture is
 *   always the modifier's own key. The capture slot should stay open and wait
 *   for the next keydown. `modifier` names which one, so a caller tracking
 *   capture-session state (`BindSlot`) knows which key a later keyup with no
 *   intervening keydown would mean "release the lone modifier" for (see
 *   `resolveModifierRelease` below - this result on its own does not yet know
 *   whether the gesture is a chord in progress or a bare modifier tap).
 * - `refused` - the event cannot become a bind, with a reason:
 *   - `multipleModifiers` - two or more modifiers were held at once
 *     (Alt+Ctrl+R). The engine has exactly one alt-layer trigger per bind
 *     slot; a chord of two modifiers has no single trigger to attach to.
 *   - `modifierOnly` - one modifier was held and the key that went down was a
 *     *different* modifier (Alt held, Shift pressed). This is not the
 *     "waiting for the real key" case above, and it is not a chord - it is a
 *     capture that will never resolve to a bindable key, so it is refused
 *     rather than left pending forever.
 * - `null` - `resolveQuakeKeyName` did not recognize the event's `code` at
 *   all. There is nothing to accept or refuse; the event is not ours.
 */
export type ModifierCaptureResult =
  | { kind: 'plain'; key: string }
  | { kind: 'modifier'; key: string; modifier: ModifierKey }
  | { kind: 'pending'; modifier: ModifierKey }
  | { kind: 'refused'; reason: 'multipleModifiers' | 'modifierOnly' }
  | null

function isModifierKeyName(key: string): key is ModifierKey {
  return key === 'ALT' || key === 'CTRL' || key === 'SHIFT'
}

/**
 * The same decision table as `resolveModifierCapture`, starting one step
 * later: from an already-resolved Quake key name instead of a raw event.
 *
 * It exists because `useKeyCapture`'s `onCapture` callback - `BindSlot`'s only
 * source of capture events - hands back `{ key, modifiers }` where `key` is
 * already the result of `resolveQuakeKeyName`. There is no raw
 * `KeyboardEvent.code` left to feed `resolveModifierCapture` at that point, and
 * re-deriving one would mean inventing a code for a key name. So the
 * classification lives here and `resolveModifierCapture` is the thin wrapper:
 * resolve, then delegate. One decision table, two entry points.
 *
 * `heldCount` (how many of `alt`/`ctrl`/`shift` are true) is checked *before*
 * asking whether the resolved key is itself a
 * modifier. That ordering matters: two modifiers held at once is a
 * `multipleModifiers` refusal regardless of what the third, physically
 * pressed key resolves to - including the case where the pressed key
 * resolves to a modifier name itself (the last physical keydown of an
 * Alt+Ctrl chord is one of the two keys, so it necessarily *is* one of the
 * modifiers already counted in `heldCount`). Checking "is the resolved key a
 * modifier" first would misclassify that chord as a single-modifier case.
 *
 * Only once `heldCount === 1` does the resolved key's own identity matter:
 * - If it names the *same* modifier as the one held, this is the first
 *   keydown of a hold-then-press gesture (holding Alt necessarily fires a
 *   keydown for Alt's own physical key before any other key can follow) -
 *   `pending`, not a refusal, because the real key is still coming.
 * - If it names a *different* modifier (Alt held, Shift is the pressed key),
 *   the gesture can never produce a bindable key - there is no third key
 *   coming, just two modifiers touched one after another - so it is refused
 *   as `modifierOnly`.
 * - If it names an ordinary key, this is the target case the whole function
 *   exists for: `{ kind: 'modifier', key, modifier }`.
 *
 * `heldCount === 0` is the plain case, and is checked last since every other
 * branch requires at least one modifier held.
 *
 * Never `null`: an unresolvable key is the caller's problem before it gets
 * here (see `resolveModifierCapture`), so every resolved key produces a
 * decision.
 */
export function classifyModifierCapture(
  resolvedKey: string,
  modifiers: { alt: boolean; ctrl: boolean; shift: boolean },
): Exclude<ModifierCaptureResult, null> {
  const heldCount = Number(modifiers.alt) + Number(modifiers.ctrl) + Number(modifiers.shift)

  if (heldCount >= 2) {
    return { kind: 'refused', reason: 'multipleModifiers' }
  }

  if (heldCount === 1) {
    const heldModifier: ModifierKey = modifiers.alt ? 'ALT' : modifiers.ctrl ? 'CTRL' : 'SHIFT'

    if (isModifierKeyName(resolvedKey)) {
      return resolvedKey === heldModifier
        ? { kind: 'pending', modifier: heldModifier }
        : { kind: 'refused', reason: 'modifierOnly' }
    }

    return { kind: 'modifier', key: resolvedKey, modifier: heldModifier }
  }

  return { kind: 'plain', key: resolvedKey }
}

/**
 * Resolve one keydown event into a modifier-aware capture result.
 *
 * The event's `code` is resolved through `resolveQuakeKeyName` first - an
 * unrecognized code (`null`) short-circuits everything else, since there is
 * no physical key to reason about. Everything after that is
 * `classifyModifierCapture` above, which is where the decision table and its
 * reasoning live.
 */
export function resolveModifierCapture(
  event: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'shiftKey'>,
): ModifierCaptureResult {
  const resolvedKey = resolveQuakeKeyName(event)
  if (resolvedKey === null) return null

  return classifyModifierCapture(resolvedKey, {
    alt: event.altKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
  })
}

/**
 * Review-fix (post-D3): on its own, `classifyModifierCapture` can never
 * return `plain` for a bare modifier key, because the modifier's *own*
 * keydown always sets its own DOM flag (pressing Shift makes `shiftKey` true
 * on that very keydown) - so `heldCount` is always >= 1 for a lone modifier
 * tap, which `pending` (decisions 2/3) always wins. Taken alone, that
 * silently regressed a capability story 015 had: binding a bare modifier as
 * an ordinary key is a real stock Quake II bind (e.g. `bind SHIFT +speed`,
 * shift-to-run), and there is nothing chord-like about pressing Shift and
 * letting go without ever pressing a second key.
 *
 * The fix is not in the keydown decision table at all - a single keydown
 * event cannot distinguish "the real key is coming" from "that was the whole
 * gesture" for a bare modifier tap, no matter how the table is ordered. The
 * distinguishing signal is the *next* thing that happens: does another
 * keydown arrive before the modifier's own keyup? `BindSlot` is the one
 * source of that: it already tracks `pending`'s `modifier` as capture-session
 * state (`heldModifier`), and clears it the moment any other keydown resolves
 * the capture out of `pending`. This function is the pure other half - given
 * that tracked modifier and a keyup's resolved key, is this the release of
 * the very same lone modifier with nothing having happened in between? If so,
 * the caller applies `releasedKey` through the exact same path a `plain`
 * classification would have taken. Returns `null` for every other keyup
 * (nothing pending, or a keyup for some other key), so a caller can treat a
 * non-null result as "yes, apply this as a plain key" and ignore the rest.
 */
export function resolveModifierRelease(
  heldModifier: ModifierKey | null,
  releasedKey: string,
): string | null {
  return heldModifier !== null && releasedKey === heldModifier ? releasedKey : null
}
