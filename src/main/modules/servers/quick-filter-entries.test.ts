import { describe, expect, it } from 'vitest'
import {
  QUICK_FILTER_MAX,
  QUICK_FILTER_NAME_MAX,
  type QuickFilter,
  type QuickFilterCriteria,
} from '@shared/servers/quick-filters'
import { removeQuickFilter, renameQuickFilter, saveQuickFilter } from './quick-filter-entries'

const NONE: QuickFilterCriteria = {
  mod: null,
  gamemode: null,
  map: null,
  empty: false,
  hideBotsOnly: false,
  waitingForOpponent: false,
}
const CTF: QuickFilterCriteria = { ...NONE, mod: 'ctf' }
const EMPTY_ONLY: QuickFilterCriteria = { ...NONE, empty: true }

function ids(): () => string {
  let n = 0
  return () => `id-${++n}`
}

function entry(id: string, name: string, criteria = CTF): QuickFilter {
  return { id, name, criteria }
}

describe('saveQuickFilter', () => {
  it('save refuses an empty or taken name and overwrites only when asked', () => {
    const list = [entry('a', 'My CTF')]
    const reason = (r: ReturnType<typeof saveQuickFilter>): string | null =>
      r.ok ? null : r.reasonKey

    expect(reason(saveQuickFilter(list, { name: '   ', criteria: CTF, overwrite: false }))).toBe(
      'servers.quickFilter.error.empty',
    )
    expect(
      reason(saveQuickFilter(list, { name: ' my ctf ', criteria: EMPTY_ONLY, overwrite: false })),
    ).toBe('servers.quickFilter.error.taken')
    const overwritten = saveQuickFilter(list, {
      name: 'my ctf',
      criteria: EMPTY_ONLY,
      overwrite: true,
    })
    expect(overwritten).toEqual({ ok: true, list: [entry('a', 'My CTF', EMPTY_ONLY)] })
  })

  it('refuses criteria that filter nothing', () => {
    expect(saveQuickFilter([], { name: 'x', criteria: NONE, overwrite: false })).toEqual({
      ok: false,
      reasonKey: 'servers.quickFilter.error.noCriteria',
    })
  })

  it('refuses a name over the limit', () => {
    const name = 'x'.repeat(QUICK_FILTER_NAME_MAX + 1)
    expect(saveQuickFilter([], { name, criteria: CTF, overwrite: false })).toEqual({
      ok: false,
      reasonKey: 'servers.quickFilter.error.tooLong',
    })
  })

  it('stores the trimmed name and appends in creation order', () => {
    const mint = ids()
    const first = saveQuickFilter([], { name: '  One ', criteria: CTF, overwrite: false }, mint)
    if (!first.ok) throw new Error('expected ok')
    const second = saveQuickFilter(
      first.list,
      { name: 'Two', criteria: EMPTY_ONLY, overwrite: false },
      mint,
    )
    expect(second).toEqual({
      ok: true,
      list: [entry('id-1', 'One'), entry('id-2', 'Two', EMPTY_ONLY)],
    })
  })

  it('overwrite keeps the id and position of the entry it replaces', () => {
    const list = [entry('a', 'A'), entry('b', 'B'), entry('c', 'C')]
    const result = saveQuickFilter(list, { name: 'B', criteria: EMPTY_ONLY, overwrite: true })
    expect(result).toEqual({
      ok: true,
      list: [entry('a', 'A'), entry('b', 'B', EMPTY_ONLY), entry('c', 'C')],
    })
  })

  it('refuses a new entry at the cap but still allows overwriting at the cap', () => {
    const full = Array.from({ length: QUICK_FILTER_MAX }, (_, i) => entry(`id${i}`, `Filter ${i}`))
    expect(saveQuickFilter(full, { name: 'New', criteria: CTF, overwrite: false })).toEqual({
      ok: false,
      reasonKey: 'servers.quickFilter.error.cap',
    })
    const overwrite = saveQuickFilter(full, {
      name: 'Filter 0',
      criteria: EMPTY_ONLY,
      overwrite: true,
    })
    expect(overwrite.ok && overwrite.list).toHaveLength(QUICK_FILTER_MAX)
  })
})

describe('renameQuickFilter', () => {
  const list = [entry('a', 'Alpha'), entry('b', 'Beta')]

  it('renames in place with the trimmed name', () => {
    expect(renameQuickFilter(list, { id: 'b', name: ' Gamma ' })).toEqual({
      ok: true,
      list: [entry('a', 'Alpha'), entry('b', 'Gamma')],
    })
  })

  it('allows a case-only rename of itself', () => {
    expect(renameQuickFilter(list, { id: 'a', name: 'ALPHA' })).toEqual({
      ok: true,
      list: [entry('a', 'ALPHA'), entry('b', 'Beta')],
    })
  })

  it('refuses unknown, empty, too long and taken', () => {
    const reason = (id: string, name: string): string | null => {
      const r = renameQuickFilter(list, { id, name })
      return r.ok ? null : r.reasonKey
    }
    expect(reason('zzz', 'X')).toBe('servers.quickFilter.error.notFound')
    expect(reason('a', ' ')).toBe('servers.quickFilter.error.empty')
    expect(reason('a', 'x'.repeat(QUICK_FILTER_NAME_MAX + 1))).toBe(
      'servers.quickFilter.error.tooLong',
    )
    expect(reason('a', 'beta')).toBe('servers.quickFilter.error.taken')
  })
})

describe('removeQuickFilter', () => {
  it('removes the entry and is idempotent for an unknown id', () => {
    const list = [entry('a', 'A'), entry('b', 'B')]
    expect(removeQuickFilter(list, { id: 'a' })).toEqual({ ok: true, list: [entry('b', 'B')] })
    expect(removeQuickFilter(list, { id: 'zzz' })).toEqual({ ok: true, list })
  })
})
