import { describe, expect, it } from 'vitest'
import { setOrClearListSort } from './list-sort'

describe('list sort', () => {
  it('setOrClearListSort clears to an absent key and sets otherwise', () => {
    const slice: { keep: number; listSort?: string } = { keep: 1, listSort: 'name' }

    const cleared = setOrClearListSort<typeof slice, string>(slice, null)
    expect('listSort' in cleared).toBe(false)
    expect(cleared).toEqual({ keep: 1 })

    expect(setOrClearListSort<typeof slice, string>(cleared, 'date')).toEqual({ keep: 1, listSort: 'date' })
    expect(slice.listSort).toBe('name')
  })
})
