// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuickFilter } from '@shared/servers/quick-filters'

const client = vi.hoisted(() => ({
  listQuickFilters: vi.fn(),
  saveQuickFilter: vi.fn(),
  renameQuickFilter: vi.fn(),
  removeQuickFilter: vi.fn(),
}))
vi.mock('./client', () => client)

import { useQuickFilters } from './useQuickFilters'

const filter = (id: string): QuickFilter => ({ id, name: id, criteria: {} }) as QuickFilter

describe('useQuickFilters', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a saved filter replaces the list and a refusal leaves it', async () => {
    client.listQuickFilters.mockResolvedValue({ ok: true, value: [filter('a')] })
    const { result } = renderHook(() => useQuickFilters())
    await waitFor(() => expect(result.current.list).toHaveLength(1))

    client.saveQuickFilter.mockResolvedValueOnce({
      ok: true,
      value: { ok: true, list: [filter('a'), filter('b')] },
    })
    await act(async () => {
      await result.current.save({ name: 'b', criteria: {} as never, overwrite: false })
    })
    expect(result.current.list.map((f) => f.id)).toEqual(['a', 'b'])

    const refusal = { ok: false, reasonKey: 'servers.quickFilter.error.duplicate' }
    client.saveQuickFilter.mockResolvedValueOnce({ ok: true, value: refusal })
    let returned: unknown
    await act(async () => {
      returned = await result.current.save({ name: 'b', criteria: {} as never, overwrite: false })
    })
    expect(returned).toEqual(refusal)
    expect(result.current.list.map((f) => f.id)).toEqual(['a', 'b'])
  })
})
