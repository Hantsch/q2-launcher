import { describe, expect, it } from 'vitest'
import type { WatchlistEntry } from '@shared/modules/servers'
import { addWatchlistEntry, removeWatchlistEntry, updateWatchlistEntry } from './watchlist-entries'

/**
 * Story 131 D2: the three pure watchlist-entry ops. Mirrors `manual-servers.test.ts`'s scope for
 * this sibling module - no `StateStore`, no `AppContext`, list in/result out.
 */

describe('addWatchlistEntry', () => {
  it('adds a new entry with a minted id and tooSlow false', () => {
    const result = addWatchlistEntry([], { name: 'Alice', mode: 'exact' }, () => 'fixed-id')

    expect(result).toEqual({
      ok: true,
      list: [{ id: 'fixed-id', name: 'Alice', mode: 'exact', tooSlow: false }],
    })
  })

  it('uses randomUUID by default when no mintId is injected', () => {
    const result = addWatchlistEntry([], { name: 'Bob', mode: 'substring' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.list).toHaveLength(1)
    expect(typeof result.list[0].id).toBe('string')
    expect(result.list[0].id.length).toBeGreaterThan(0)
  })

  it('trims the stored name', () => {
    const result = addWatchlistEntry([], { name: '  Alice  ', mode: 'exact' }, () => 'id-1')

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.list[0].name).toBe('Alice')
  })

  it('rejects an empty (or whitespace-only) name', () => {
    expect(addWatchlistEntry([], { name: '', mode: 'exact' })).toEqual({
      ok: false,
      reasonKey: 'servers.watchlist.error.empty',
    })
    expect(addWatchlistEntry([], { name: '   ', mode: 'exact' })).toEqual({
      ok: false,
      reasonKey: 'servers.watchlist.error.empty',
    })
  })

  it('rejects a name longer than WATCHLIST_NAME_MAX', () => {
    const tooLong = 'a'.repeat(65)

    const result = addWatchlistEntry([], { name: tooLong, mode: 'exact' })

    expect(result).toEqual({ ok: false, reasonKey: 'servers.watchlist.error.tooLong' })
  })

  it('rejects a regex mode entry whose pattern does not compile', () => {
    const result = addWatchlistEntry([], { name: '(unterminated', mode: 'regex' })

    expect(result).toEqual({ ok: false, reasonKey: 'servers.watchlist.error.invalidRegex' })
  })

  it('accepts a regex mode entry whose pattern does compile', () => {
    const result = addWatchlistEntry([], { name: '^foo.*bar$', mode: 'regex' }, () => 'id-2')

    expect(result.ok).toBe(true)
  })

  it('validates in order: empty before too-long before invalid-regex', () => {
    expect(addWatchlistEntry([], { name: '', mode: 'regex' })).toEqual({
      ok: false,
      reasonKey: 'servers.watchlist.error.empty',
    })
    expect(addWatchlistEntry([], { name: 'a'.repeat(65), mode: 'regex' })).toEqual({
      ok: false,
      reasonKey: 'servers.watchlist.error.tooLong',
    })
  })
})

describe('updateWatchlistEntry', () => {
  const existing: WatchlistEntry = { id: 'e1', name: 'Alice', mode: 'exact', tooSlow: true }

  it('updates name/mode and clears a stale tooSlow verdict', () => {
    const result = updateWatchlistEntry([existing], { id: 'e1', name: 'Bob', mode: 'substring' })

    expect(result).toEqual({
      ok: true,
      list: [{ id: 'e1', name: 'Bob', mode: 'substring', tooSlow: false }],
    })
  })

  it('rejects an unknown id', () => {
    const result = updateWatchlistEntry([existing], {
      id: 'missing',
      name: 'Bob',
      mode: 'exact',
    })

    expect(result).toEqual({ ok: false, reasonKey: 'servers.watchlist.error.notFound' })
  })

  it('rejects an empty name and leaves the list untouched', () => {
    const result = updateWatchlistEntry([existing], { id: 'e1', name: '', mode: 'exact' })

    expect(result).toEqual({ ok: false, reasonKey: 'servers.watchlist.error.empty' })
  })

  it('rejects a too-long name', () => {
    const result = updateWatchlistEntry([existing], {
      id: 'e1',
      name: 'a'.repeat(65),
      mode: 'exact',
    })

    expect(result).toEqual({ ok: false, reasonKey: 'servers.watchlist.error.tooLong' })
  })

  it('rejects an invalid regex pattern', () => {
    const result = updateWatchlistEntry([existing], {
      id: 'e1',
      name: '(unterminated',
      mode: 'regex',
    })

    expect(result).toEqual({ ok: false, reasonKey: 'servers.watchlist.error.invalidRegex' })
  })

  it('does not mutate other entries', () => {
    const other: WatchlistEntry = { id: 'e2', name: 'Carl', mode: 'exact', tooSlow: false }

    const result = updateWatchlistEntry([existing, other], {
      id: 'e1',
      name: 'Bob',
      mode: 'exact',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.list).toContainEqual(other)
  })
})

describe('removeWatchlistEntry', () => {
  it('removes an entry by id', () => {
    const a: WatchlistEntry = { id: 'e1', name: 'Alice', mode: 'exact', tooSlow: false }
    const b: WatchlistEntry = { id: 'e2', name: 'Bob', mode: 'exact', tooSlow: false }

    const result = removeWatchlistEntry([a, b], 'e1')

    expect(result).toEqual({ ok: true, list: [b] })
  })

  it('removing an unknown id is a no-op that still succeeds', () => {
    const a: WatchlistEntry = { id: 'e1', name: 'Alice', mode: 'exact', tooSlow: false }

    const result = removeWatchlistEntry([a], 'missing')

    expect(result).toEqual({ ok: true, list: [a] })
  })
})
