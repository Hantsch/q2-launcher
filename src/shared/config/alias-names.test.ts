import { describe, expect, it } from 'vitest'
import { MAX_OWN_ALIAS_NAME_LENGTH, reservedAliasNames, validateAliasName } from './alias-names'

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
