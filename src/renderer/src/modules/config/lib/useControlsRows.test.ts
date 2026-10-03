// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import { deriveRowState } from './catalog-binds'
import { useControlsRows } from './useControlsRows'

vi.mock('./catalog-binds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./catalog-binds')>()
  return { ...actual, deriveRowState: vi.fn(actual.deriveRowState) }
})

function entry(overrides: Partial<ConfigAction> & { id: string }): ConfigAction {
  return { categoryId: 'movement', name: overrides.id, kind: 'bind', commands: [], ...overrides }
}

function actions(): ConfigAction[] {
  return [
    entry({
      id: 'f',
      catalogId: 'movement:forward',
      commands: [{ kind: 'raw', text: '+forward' }],
      keys: [{ key: 'w' }],
    }),
    entry({ id: 'b', catalogId: 'movement:back' }),
    entry({ id: 'free', name: 'My own bind' }),
    entry({ id: 'other', categoryId: 'weapons', catalogId: 'weaponUse:use_railgun' }),
  ]
}

describe('useControlsRows', () => {
  beforeEach(() => {
    vi.mocked(deriveRowState).mockClear()
  })

  it('computes groups, move targets and bound count in one pass', () => {
    const { result } = renderHook(() => useControlsRows('movement', actions(), undefined, ''))

    expect(result.current.entries.map((e) => e.action.id)).toEqual(['f', 'b', 'free'])
    expect(result.current.filteredCount).toBe(3)
    expect(result.current.groups.flatMap((g) => g.entries.map((e) => e.action.id))).toEqual([
      'f',
      'b',
      'free',
    ])
    expect(result.current.boundCount).toBe(1)
    expect(result.current.moveTargets.get('b')).toEqual({ up: 'f', down: 'free' })
    expect(result.current.moveTargets.get('f')).toEqual({ up: undefined, down: 'b' })
  })

  it('narrows groups and bound count to the filter, within the category', () => {
    const { result } = renderHook(() => useControlsRows('movement', actions(), undefined, 'own'))

    const ids = result.current.groups.flatMap((g) => g.entries.map((e) => e.action.id))
    expect(ids).toEqual(['free'])
  })

  it('derives row state once per entry', () => {
    const list = actions()
    const { result, rerender } = renderHook(() => useControlsRows('movement', list, undefined, ''))

    expect(deriveRowState).toHaveBeenCalledTimes(2)
    expect([...result.current.rowState.keys()].sort()).toEqual(['b', 'f'])

    rerender()
    expect(deriveRowState).toHaveBeenCalledTimes(2)
  })
})
