import { describe, expect, it } from 'vitest'
import { classifyModifierCapture, resolveModifierCapture, resolveModifierRelease } from './modifier-capture'

type FakeKeyboardEvent = Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'shiftKey'>

function keydown(overrides: Partial<FakeKeyboardEvent> & { code: string }): FakeKeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...overrides,
  }
}

describe('resolveModifierCapture', () => {
  it('resolves a plain key with no modifier held', () => {
    const result = resolveModifierCapture(keydown({ code: 'KeyR' }))

    expect(result).toEqual({ kind: 'plain', key: 'r' })
  })

  it('resolves Alt+R as a modifier capture, key and modifier reported separately', () => {
    const result = resolveModifierCapture(keydown({ code: 'KeyR', altKey: true }))

    expect(result).toEqual({ kind: 'modifier', key: 'r', modifier: 'ALT' })
  })

  it('resolves Ctrl+R as a modifier capture', () => {
    const result = resolveModifierCapture(keydown({ code: 'KeyR', ctrlKey: true }))

    expect(result).toEqual({ kind: 'modifier', key: 'r', modifier: 'CTRL' })
  })

  it('resolves Shift+R as a modifier capture', () => {
    const result = resolveModifierCapture(keydown({ code: 'KeyR', shiftKey: true }))

    expect(result).toEqual({ kind: 'modifier', key: 'r', modifier: 'SHIFT' })
  })

  it('keeps capture pending when Alt goes down alone (its own keydown fires first), naming which modifier', () => {
    const result = resolveModifierCapture(keydown({ code: 'AltLeft', altKey: true }))

    expect(result).toEqual({ kind: 'pending', modifier: 'ALT' })
  })

  it('keeps capture pending when Ctrl goes down alone, proving the rule is not Alt-special-cased', () => {
    const result = resolveModifierCapture(keydown({ code: 'ControlLeft', ctrlKey: true }))

    expect(result).toEqual({ kind: 'pending', modifier: 'CTRL' })
  })

  it('refuses Alt+Ctrl+R as multipleModifiers', () => {
    const result = resolveModifierCapture(
      keydown({ code: 'KeyR', altKey: true, ctrlKey: true }),
    )

    expect(result).toEqual({ kind: 'refused', reason: 'multipleModifiers' })
  })

  it('refuses Alt+Shift (Shift is the pressed key) as modifierOnly, not pending', () => {
    const result = resolveModifierCapture(keydown({ code: 'ShiftLeft', altKey: true }))

    expect(result).toEqual({ kind: 'refused', reason: 'modifierOnly' })
  })

  it('returns null for a code resolveQuakeKeyName does not recognize', () => {
    const result = resolveModifierCapture(keydown({ code: 'IntlBackslash' }))

    expect(result).toBeNull()
  })

  it('returns null for an unmapped code even when modifiers are held', () => {
    const result = resolveModifierCapture(keydown({ code: 'IntlBackslash', altKey: true }))

    expect(result).toBeNull()
  })
})

/**
 * Story 016 D3: `BindSlot` classifies from `useKeyCapture`'s already-resolved
 * `{ key, modifiers }` rather than from a raw event, so the same decision table
 * is covered again through that entry point - no event shape involved.
 */
describe('classifyModifierCapture', () => {
  function held(overrides: Partial<{ alt: boolean; ctrl: boolean; shift: boolean }> = {}): {
    alt: boolean
    ctrl: boolean
    shift: boolean
  } {
    return { alt: false, ctrl: false, shift: false, ...overrides }
  }

  it('classifies a plain key with no modifier held', () => {
    expect(classifyModifierCapture('r', held())).toEqual({ kind: 'plain', key: 'r' })
  })

  it('classifies Alt+R, Ctrl+R and Shift+R with key and modifier reported separately', () => {
    expect(classifyModifierCapture('r', held({ alt: true }))).toEqual({
      kind: 'modifier',
      key: 'r',
      modifier: 'ALT',
    })
    expect(classifyModifierCapture('r', held({ ctrl: true }))).toEqual({
      kind: 'modifier',
      key: 'r',
      modifier: 'CTRL',
    })
    expect(classifyModifierCapture('r', held({ shift: true }))).toEqual({
      kind: 'modifier',
      key: 'r',
      modifier: 'SHIFT',
    })
  })

  it('stays pending for each modifier going down on its own, naming which modifier', () => {
    expect(classifyModifierCapture('ALT', held({ alt: true }))).toEqual({
      kind: 'pending',
      modifier: 'ALT',
    })
    expect(classifyModifierCapture('CTRL', held({ ctrl: true }))).toEqual({
      kind: 'pending',
      modifier: 'CTRL',
    })
    expect(classifyModifierCapture('SHIFT', held({ shift: true }))).toEqual({
      kind: 'pending',
      modifier: 'SHIFT',
    })
  })

  it('refuses two modifiers held at once as multipleModifiers', () => {
    expect(classifyModifierCapture('r', held({ alt: true, ctrl: true }))).toEqual({
      kind: 'refused',
      reason: 'multipleModifiers',
    })
    expect(classifyModifierCapture('r', held({ ctrl: true, shift: true }))).toEqual({
      kind: 'refused',
      reason: 'multipleModifiers',
    })
    // The chord's own last keydown resolves to a modifier name - still the
    // chord refusal, not `modifierOnly` (the heldCount-first ordering).
    expect(classifyModifierCapture('CTRL', held({ alt: true, ctrl: true }))).toEqual({
      kind: 'refused',
      reason: 'multipleModifiers',
    })
  })

  it('refuses a different modifier as the pressed key as modifierOnly, not pending', () => {
    expect(classifyModifierCapture('SHIFT', held({ alt: true }))).toEqual({
      kind: 'refused',
      reason: 'modifierOnly',
    })
    expect(classifyModifierCapture('ALT', held({ shift: true }))).toEqual({
      kind: 'refused',
      reason: 'modifierOnly',
    })
  })

  it('agrees with resolveModifierCapture for the same gesture', () => {
    const event = keydown({ code: 'KeyR', altKey: true })

    expect(resolveModifierCapture(event)).toEqual(classifyModifierCapture('r', held({ alt: true })))
  })
})

/**
 * Review-fix (post-D3): restores the pre-story capability to bind a bare
 * modifier as a plain key (e.g. `bind SHIFT +speed`), which the keydown-only
 * decision table above can never produce on its own - see this function's
 * own doc comment in `modifier-capture.ts` for why.
 */
describe('resolveModifierRelease', () => {
  it('resolves the release when the keyup matches the tracked pending modifier', () => {
    expect(resolveModifierRelease('SHIFT', 'SHIFT')).toBe('SHIFT')
    expect(resolveModifierRelease('ALT', 'ALT')).toBe('ALT')
    expect(resolveModifierRelease('CTRL', 'CTRL')).toBe('CTRL')
  })

  it('returns null when nothing is pending', () => {
    expect(resolveModifierRelease(null, 'SHIFT')).toBeNull()
  })

  it('returns null for a keyup of a different key than the one pending', () => {
    // e.g. Alt is pending and the user releases some other key without ever
    // pressing it down through this capture (should not normally happen, but
    // the function must not misfire on it).
    expect(resolveModifierRelease('ALT', 'r')).toBeNull()
    expect(resolveModifierRelease('ALT', 'CTRL')).toBeNull()
  })
})
