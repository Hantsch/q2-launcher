// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type ContributedAction,
  usePrimaryActionContribution,
  usePrimaryActionStore,
} from './primary-action'

function action(id: string): ContributedAction {
  return { id, labelKey: 'installation.action.view', disabled: false, run: vi.fn() }
}

function Publisher({ owner, contribution }: { owner: string; contribution: ContributedAction }) {
  usePrimaryActionContribution(owner, contribution)
  return null
}

afterEach(() => {
  cleanup()
  usePrimaryActionStore.setState({ owner: null, action: null })
})

describe('usePrimaryActionContribution', () => {
  it('publishes while mounted and clears on unmount', () => {
    const a = action('a')
    const view = render(createElement(Publisher, { owner: '/replays', contribution: a }))
    expect(usePrimaryActionStore.getState()).toMatchObject({ owner: '/replays', action: a })
    view.unmount()
    expect(usePrimaryActionStore.getState()).toMatchObject({ owner: null, action: null })
  })

  it('unmount clears only its own contribution', () => {
    const first = render(createElement(Publisher, { owner: '/replays', contribution: action('a') }))
    const b = action('b')
    render(createElement(Publisher, { owner: '/config', contribution: b }))
    first.unmount()
    expect(usePrimaryActionStore.getState()).toMatchObject({ owner: '/config', action: b })
  })
})
