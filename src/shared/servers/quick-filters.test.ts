import { describe, expect, it } from 'vitest'
import { EMPTY_SERVER_LIST_FILTER } from './list-filter'
import {
  applyCriteria,
  clearCriteria,
  criteriaOf,
  hasCriteria,
  sameCriteria,
  validateQuickFilterName,
  QUICK_FILTER_NAME_MAX,
  type QuickFilter,
} from './quick-filters'

const none = criteriaOf(EMPTY_SERVER_LIST_FILTER)
const q = (id: string, name: string): QuickFilter => ({
  id,
  name,
  criteria: { ...none, empty: true },
})

describe('quick filter criteria', () => {
  it('criteriaOf drops the search and keeps the rest', () => {
    const c = criteriaOf({ ...EMPTY_SERVER_LIST_FILTER, search: 'x', mod: 'ctf', empty: true })
    expect(c).toEqual({ ...none, mod: 'ctf', empty: true })
    expect('search' in c).toBe(false)
  })

  it('hasCriteria is true for any select or toggle and false for none', () => {
    expect(hasCriteria(none)).toBe(false)
    expect(hasCriteria({ ...none, mod: 'a' })).toBe(true)
    expect(hasCriteria({ ...none, gamemode: 'coop' })).toBe(true)
    expect(hasCriteria({ ...none, map: 'q2dm1' })).toBe(true)
    expect(hasCriteria({ ...none, empty: true })).toBe(true)
    expect(hasCriteria({ ...none, hideBotsOnly: true })).toBe(true)
    expect(hasCriteria({ ...none, waitingForOpponent: true })).toBe(true)
  })

  it('sameCriteria compares mod and map case-insensitively and the rest exactly', () => {
    expect(
      sameCriteria({ ...none, mod: 'CTF', map: 'Q2DM1' }, { ...none, mod: 'ctf', map: 'q2dm1' }),
    ).toBe(true)
    expect(sameCriteria({ ...none, mod: 'ctf' }, none)).toBe(false)
    expect(sameCriteria({ ...none, gamemode: 'ctf' }, { ...none, gamemode: 'team' })).toBe(false)
    expect(sameCriteria({ ...none, hideBotsOnly: true }, none)).toBe(false)
  })

  it('applyCriteria replaces the criteria and keeps the search', () => {
    const f = { ...EMPTY_SERVER_LIST_FILTER, search: 'foo', mod: 'old', empty: true }
    const r = applyCriteria(f, { ...none, map: 'q2dm1' })
    expect(r).toEqual({ ...EMPTY_SERVER_LIST_FILTER, search: 'foo', map: 'q2dm1' })
  })

  it('clearCriteria resets every criterion and keeps the search', () => {
    const f = { ...EMPTY_SERVER_LIST_FILTER, search: 'foo', mod: 'old', hideBotsOnly: true }
    expect(clearCriteria(f)).toEqual({ ...EMPTY_SERVER_LIST_FILTER, search: 'foo' })
  })
})

describe('validateQuickFilterName', () => {
  const list = [q('1', 'Alpha'), q('2', 'Beta')]

  it('accepts a fresh name, trimmed', () => {
    expect(validateQuickFilterName('  Gamma ', list)).toBeNull()
  })
  it('rejects empty and whitespace-only names', () => {
    expect(validateQuickFilterName('', list)).toBe('empty')
    expect(validateQuickFilterName('   ', list)).toBe('empty')
  })
  it('rejects names over the limit but accepts exactly the limit', () => {
    expect(validateQuickFilterName('x'.repeat(QUICK_FILTER_NAME_MAX), list)).toBeNull()
    expect(validateQuickFilterName('x'.repeat(QUICK_FILTER_NAME_MAX + 1), list)).toBe('tooLong')
  })
  it('rejects a taken name case-insensitively, except for the entry being renamed', () => {
    expect(validateQuickFilterName(' ALPHA ', list)).toBe('taken')
    expect(validateQuickFilterName('alpha', list, '1')).toBeNull()
    expect(validateQuickFilterName('beta', list, '1')).toBe('taken')
  })
})
