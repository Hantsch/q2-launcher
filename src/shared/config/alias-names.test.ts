import { describe, expect, it } from 'vitest'
import { MAX_ALIAS_NAME } from './engine-limits'
import {
  MAX_OWN_ALIAS_NAME_LENGTH,
  maxOwnAliasNameLength,
  reservedAliasNames,
  validateAliasName,
} from './alias-names'

describe('validateAliasName', () => {
  it('accepts a plain lowercase name', () => {
    expect(validateAliasName('ssg_sg')).toEqual({ ok: true })
  })

  it('accepts a name carrying a press/release sign', () => {
    expect(validateAliasName('+slow')).toEqual({ ok: true })
  })

  it('rejects an empty name', () => {
    expect(validateAliasName('')).toEqual({ ok: false, reason: 'empty', params: {} })
  })

  it('rejects a whitespace-only name as empty', () => {
    expect(validateAliasName('   ')).toEqual({ ok: false, reason: 'empty', params: {} })
  })

  it('rejects uppercase characters', () => {
    const result = validateAliasName('SSG')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('illegalCharacters')
      expect(result.params).toEqual({ name: 'SSG' })
    }
  })

  it('rejects a space inside the name', () => {
    const result = validateAliasName('ssg sg')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('illegalCharacters')
  })

  it('rejects a hyphen inside the name', () => {
    const result = validateAliasName('ssg-sg')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('illegalCharacters')
  })

  it('rejects a lone sign with nothing after it', () => {
    const result = validateAliasName('+')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('illegalCharacters')
  })

  it('rejects a name past the MAX_ALIAS_NAME budget', () => {
    const name = 'a'.repeat(30)
    const result = validateAliasName(name)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('tooLong')
      expect(result.params).toEqual({ name, length: 30, max: MAX_OWN_ALIAS_NAME_LENGTH })
    }
  })

  it('accepts a name exactly at the budget and rejects one character over it', () => {
    const atBudget = 'a'.repeat(MAX_OWN_ALIAS_NAME_LENGTH)
    const overBudget = 'a'.repeat(MAX_OWN_ALIAS_NAME_LENGTH + 1)
    expect(validateAliasName(atBudget)).toEqual({ ok: true })
    const result = validateAliasName(overBudget)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('tooLong')
  })

  it('rejects a known engine command from the action catalogue', () => {
    const result = validateAliasName('weapnext')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('reserved')
      expect(result.params).toEqual({ name: 'weapnext' })
    }
  })

  it('rejects the sign-stripped form of a movement command', () => {
    const result = validateAliasName('forward')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('reserved')
  })

  it('rejects the raw signed form of a movement command', () => {
    const result = validateAliasName('+forward')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('reserved')
  })

  it('rejects a cvar name from the cvar catalogue', () => {
    const result = validateAliasName('fov')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('reserved')
  })

  it('rejects a name matching another entry in context, case-insensitively', () => {
    const result = validateAliasName('ssg_sg', ['Ssg_Sg'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('duplicate')
      expect(result.params).toEqual({ name: 'ssg_sg' })
    }
  })

  it('accepts a name that matches nothing in context', () => {
    expect(validateAliasName('ssg_sg', ['railgun', 'drop_all'])).toEqual({ ok: true })
  })

  it('checks reasons in precedence order: empty, illegalCharacters, tooLong, reserved, duplicate', () => {
    // A too-long name that is also reserved-looking would still report tooLong first.
    const tooLongAndWeird = `${'a'.repeat(MAX_OWN_ALIAS_NAME_LENGTH + 1)}`
    const result = validateAliasName(tooLongAndWeird, [tooLongAndWeird])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('tooLong')
  })
})

/**
 * Story 045, D3: the two kinds that render as an alias family rather than as one body - a
 * press/release entry stores the sign-free base only, and a toggle's name has to survive both a
 * state suffix and a chunk suffix.
 */
describe('validateAliasName - two-part kinds', () => {
  it('rejects a signed press/release base name, either sign', () => {
    for (const name of ['+slow', '-slow']) {
      const result = validateAliasName(name, [], 'press-release')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('signedBaseName')
        expect(result.params).toEqual({ name, base: 'slow' })
      }
    }
    // The base itself is fine - render time is what adds the `+`/`-`.
    expect(validateAliasName('slow', [], 'press-release')).toEqual({ ok: true })
  })

  it('leaves a signed name accepted for every other kind, and for a caller passing no kind', () => {
    expect(validateAliasName('+slow')).toEqual({ ok: true })
    expect(validateAliasName('+slow', [], 'alias')).toEqual({ ok: true })
    expect(validateAliasName('+slow', [], 'toggle')).toEqual({ ok: true })
  })

  it('reports illegalCharacters before signedBaseName for a lone sign', () => {
    const result = validateAliasName('+', [], 'press-release')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('illegalCharacters')
  })

  it('budgets a toggle name for the stacked _s1_p<n> suffix and a press/release one for its sign', () => {
    expect(maxOwnAliasNameLength()).toBe(MAX_OWN_ALIAS_NAME_LENGTH)
    expect(maxOwnAliasNameLength('bind')).toBe(MAX_OWN_ALIAS_NAME_LENGTH)
    expect(maxOwnAliasNameLength('toggle')).toBe(24)
    expect(maxOwnAliasNameLength('press-release')).toBe(26)

    // What the two numbers are *for*: the longest name each kind accepts still fits every alias
    // name its family renders, terminator included (`MAX_ALIAS_NAME` counts that).
    const toggle = 'a'.repeat(maxOwnAliasNameLength('toggle'))
    expect(`${toggle}_s2_p12`.length).toBeLessThan(MAX_ALIAS_NAME)
    const base = 'a'.repeat(maxOwnAliasNameLength('press-release'))
    expect(`+${base}_p12`.length).toBeLessThan(MAX_ALIAS_NAME)
  })

  it('rejects a toggle name that only a single-body kind would have room for', () => {
    const name = 'a'.repeat(MAX_OWN_ALIAS_NAME_LENGTH)
    expect(validateAliasName(name)).toEqual({ ok: true })
    const result = validateAliasName(name, [], 'toggle')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('tooLong')
      expect(result.params).toEqual({ name, length: name.length, max: 24 })
    }
  })

  /**
   * Story-045 review, finding 3. Reserving *room* for the `_s<n>` suffix (the two budgets above) is
   * not the same as reserving the *name*: the file keeps one definition per name, so a toggle called
   * `zoom` next to a user alias called `zoom_s1` means one of the two bodies is simply gone after the
   * next save. The rename dialog feeds this function the whole occupied name space
   * (`alias-render.ts#renderedAliasNames`), and this is where the refusal happens.
   */
  it('refuses a toggle name whose derived _s1/_s2 state would overwrite an existing alias', () => {
    for (const taken of ['zoom_s1', 'zoom_s2', 'ZOOM_S1']) {
      const result = validateAliasName('zoom', [taken], 'toggle')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('duplicate')
        // The colliding name, not the typed one - the only spelling that says what the clash is.
        expect(result.params).toEqual({ name: taken.toLowerCase() })
      }
    }
    // The dispatch name itself still collides the way it always did, and an unrelated neighbour
    // does not.
    expect(validateAliasName('zoom', ['zoom'], 'toggle').ok).toBe(false)
    expect(validateAliasName('zoom', ['zoomer', 'zoom_s10'], 'toggle')).toEqual({ ok: true })
  })

  it('refuses a press/release base whose +/- half would overwrite an existing alias', () => {
    for (const taken of ['+slow', '-slow']) {
      const result = validateAliasName('slow', [taken], 'press-release')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('duplicate')
    }
    // The sign-free base defines nothing on its own, so an entry that resolves to bare `slow` is not
    // a partner this kind can collide with.
    expect(validateAliasName('slow', ['slow'], 'press-release')).toEqual({ ok: true })
  })

  it('leaves the single-body kinds checking exactly one name, as before', () => {
    expect(validateAliasName('zoom', ['zoom_s1'])).toEqual({ ok: true })
    expect(validateAliasName('zoom', ['zoom_s1'], 'alias')).toEqual({ ok: true })
    expect(validateAliasName('zoom', ['zoom'], 'alias').ok).toBe(false)
  })
})

describe('reservedAliasNames', () => {
  it('includes known engine commands and cvars, lower-cased', () => {
    const reserved = reservedAliasNames()
    expect(reserved.has('weapnext')).toBe(true)
    expect(reserved.has('forward')).toBe(true)
    expect(reserved.has('+forward')).toBe(true)
    expect(reserved.has('fov')).toBe(true)
    expect(reserved.has('name')).toBe(true)
  })

  it('does not include an ordinary user-chosen name', () => {
    expect(reservedAliasNames().has('ssg_sg')).toBe(false)
  })

  it('returns the same set on repeated calls (built once)', () => {
    expect(reservedAliasNames()).toBe(reservedAliasNames())
  })
})
