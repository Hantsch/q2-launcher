import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import { getAliasSuggestions } from './alias-suggestions'

function action(overrides: Partial<ConfigAction> & Pick<ConfigAction, 'id' | 'kind' | 'name'>): ConfigAction {
  return { categoryId: 'c1', commands: [], ...overrides }
}

describe('getAliasSuggestions', () => {
  it('lists only alias-kind entries by their rendered name', () => {
    const actions = [
      action({ id: 'a1', kind: 'alias', name: '+test' }),
      action({ id: 'a2', kind: 'alias', name: '-test' }),
      action({ id: 'a3', kind: 'bind', name: 'Jump' }),
      action({ id: 'a4', kind: 'message', name: 'GG' }),
    ]

    expect(getAliasSuggestions(actions)).toEqual(['+test', '-test'])
  })

  it('returns an empty list when there are no aliases', () => {
    const actions = [action({ id: 'a1', kind: 'bind', name: 'Jump' })]

    expect(getAliasSuggestions(actions)).toEqual([])
  })

  it('excludes a bind entry even if its command text looks alias-like', () => {
    const actions = [
      action({ id: 'a1', kind: 'bind', name: '+lookalike', commands: [{ kind: 'raw', text: '+test' }] }),
    ]

    expect(getAliasSuggestions(actions)).toEqual([])
  })
})
