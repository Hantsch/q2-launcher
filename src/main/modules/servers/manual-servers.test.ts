import { describe, expect, it } from 'vitest'
import type { ManualServerEntry } from '@shared/modules/servers'
import { addManualServer, removeManualServer } from './manual-servers'

/**
 * Story 113 D2: the two pure manual-servers ops. Everything here is list in, list/result out - no
 * `StateStore`, no `AppContext` (mirrors `favourites.test.ts`'s scope for this sibling module).
 */

describe('addManualServer', () => {
  it('an address the validator rejects is refused with its reason key and never stored', () => {
    const list: ManualServerEntry[] = []

    const result = addManualServer(list, { address: 'not-a-valid-address' })

    expect(result).toEqual({
      ok: false,
      reasonKey: 'servers.address.reject.missing-port',
    })
    expect(list).toEqual([])
  })

  it('a stored manual server is marked hand-added', () => {
    const result = addManualServer([], { address: '10.0.0.1:27910' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.entry.origin).toBe('manual')
    expect(result.entry.address).toBe('10.0.0.1:27910')
    expect(result.list).toEqual([result.entry])
  })

  it('adding the same normalized address twice does not produce a duplicate', () => {
    const first = addManualServer([], { address: '10.0.0.1:27910' })
    if (!first.ok) throw new Error('expected success')

    const second = addManualServer(first.list, { address: '10.0.0.1:27910' })
    if (!second.ok) throw new Error('expected success')

    expect(second.list).toHaveLength(1)
    expect(second.entry).toEqual(first.entry)
  })

  it('dedupes on the normalized form even when spelled differently', () => {
    const first = addManualServer([], { address: '  10.0.0.1:27910  ' })
    if (!first.ok) throw new Error('expected success')

    const second = addManualServer(first.list, { address: '10.0.0.1:27910' })
    if (!second.ok) throw new Error('expected success')

    expect(second.list).toHaveLength(1)
  })
})

describe('removeManualServer', () => {
  it('removing one manual server leaves other manual entries untouched, and a not-present address is a no-op', () => {
    const first: ManualServerEntry = {
      address: '10.0.0.1:27910',
      origin: 'manual',
      addedAt: '2024-01-01T00:00:00.000Z',
    }
    const second: ManualServerEntry = {
      address: '10.0.0.2:27910',
      origin: 'manual',
      addedAt: '2024-01-02T00:00:00.000Z',
    }
    const list = [first, second]

    const afterRemove = removeManualServer(list, '10.0.0.1:27910')
    expect(afterRemove).toEqual([second])

    const afterNoOp = removeManualServer(afterRemove, '10.0.0.9:27910')
    expect(afterNoOp).toEqual([second])
  })

  it('does not throw when the list is empty', () => {
    expect(() => removeManualServer([], '10.0.0.1:27910')).not.toThrow()
    expect(removeManualServer([], '10.0.0.1:27910')).toEqual([])
  })
})
