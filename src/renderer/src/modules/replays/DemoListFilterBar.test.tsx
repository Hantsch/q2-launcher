// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EMPTY_DEMO_LIST_FILTER, type DemoListFilter } from '@shared/replays/list-filter'
import { initI18n } from '../../i18n'

let DemoListFilterBar: typeof import('./DemoListFilterBar').DemoListFilterBar

beforeAll(async () => {
  await initI18n('en')
  ;({ DemoListFilterBar } = await import('./DemoListFilterBar'))
})

afterEach(() => {
  cleanup()
})

const OPTIONS = {
  mods: ['baseq2', 'ctf'],
  maps: ['q2dm1', 'q2dm2'],
  gamemodes: [
    { value: 'ctf', labelKey: 'replays.gamemode.ctf' },
    { value: 'freestyle', label: 'freestyle' },
  ],
  tags: ['clutch', 'rocket'],
}

function renderBar(
  filter: DemoListFilter,
  onChange: (f: DemoListFilter) => void,
  shown = 2,
  total = 2,
  options = OPTIONS,
) {
  render(
    createElement(DemoListFilterBar, {
      filter,
      onChange,
      options,
      shown,
      total,
    }),
  )
}

describe('DemoListFilterBar - each control writes its own field (story 153 D4)', () => {
  it('search writes on every keystroke', () => {
    const onChange = vi.fn()
    renderBar(EMPTY_DEMO_LIST_FILTER, onChange)

    fireEvent.change(screen.getByTestId('replays-filter-search'), { target: { value: 'zulu' } })

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_DEMO_LIST_FILTER, search: 'zulu' })
  })

  it('mod select writes the selected mod, and "Any" writes null', () => {
    const onChange = vi.fn()
    renderBar({ ...EMPTY_DEMO_LIST_FILTER, mod: 'baseq2' }, onChange)

    fireEvent.change(screen.getByTestId('replays-filter-mod'), { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_DEMO_LIST_FILTER, mod: null })
  })

  it('gamemode select writes the selected gamemode', () => {
    const onChange = vi.fn()
    renderBar(EMPTY_DEMO_LIST_FILTER, onChange)

    fireEvent.change(screen.getByTestId('replays-filter-gamemode'), { target: { value: 'ctf' } })

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_DEMO_LIST_FILTER, gamemode: 'ctf' })
  })

  it('map select writes the selected map', () => {
    const onChange = vi.fn()
    renderBar(EMPTY_DEMO_LIST_FILTER, onChange)

    fireEvent.change(screen.getByTestId('replays-filter-map'), { target: { value: 'q2dm1' } })

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_DEMO_LIST_FILTER, map: 'q2dm1' })
  })

  it('favourites checkbox toggles only its own field', () => {
    const onChange = vi.fn()
    renderBar(EMPTY_DEMO_LIST_FILTER, onChange)

    fireEvent.click(screen.getByTestId('replays-filter-favourites'))

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_DEMO_LIST_FILTER, favouritesOnly: true })
  })

  it('rating select writes the selected minimum rating, and "Any" writes null', () => {
    const onChange = vi.fn()
    renderBar({ ...EMPTY_DEMO_LIST_FILTER, minRating: 5 }, onChange)

    fireEvent.change(screen.getByTestId('replays-filter-rating'), { target: { value: '8' } })
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_DEMO_LIST_FILTER, minRating: 8 })

    fireEvent.change(screen.getByTestId('replays-filter-rating'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_DEMO_LIST_FILTER, minRating: null })
  })

  it('a selected mod/map not present in options still renders as the selected value', () => {
    const onChange = vi.fn()
    renderBar({ ...EMPTY_DEMO_LIST_FILTER, mod: 'vanished-mod' }, onChange)

    const select = screen.getByTestId('replays-filter-mod') as HTMLSelectElement
    expect(select.value).toBe('vanished-mod')
  })
})

describe('DemoListFilterBar - tags (story 153 D4)', () => {
  it('tags toggle in and out of the chosen set', () => {
    const onChange = vi.fn()
    renderBar({ ...EMPTY_DEMO_LIST_FILTER, tags: ['clutch'] }, onChange)

    const rocketTag = screen
      .getAllByTestId('replays-filter-tag')
      .find((el) => el.getAttribute('data-tag') === 'rocket')!
    fireEvent.click(rocketTag)
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_DEMO_LIST_FILTER,
      tags: ['clutch', 'rocket'],
    })

    const clutchTag = screen
      .getAllByTestId('replays-filter-tag')
      .find((el) => el.getAttribute('data-tag') === 'clutch')!
    fireEvent.click(clutchTag)
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_DEMO_LIST_FILTER, tags: [] })
  })

  it('a stale selected tag not present in options still renders as checkable', () => {
    const onChange = vi.fn()
    renderBar({ ...EMPTY_DEMO_LIST_FILTER, tags: ['vanished-tag'] }, onChange)

    const staleTag = screen
      .getAllByTestId('replays-filter-tag')
      .find((el) => el.getAttribute('data-tag') === 'vanished-tag')!
    expect(staleTag.querySelector('input')).not.toBeNull()

    fireEvent.click(staleTag)
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_DEMO_LIST_FILTER, tags: [] })
  })

  it('shows the no-tags message instead of the group when there are no tag options', () => {
    const onChange = vi.fn()
    renderBar(EMPTY_DEMO_LIST_FILTER, onChange, 2, 2, { ...OPTIONS, tags: [] })

    expect(screen.queryByTestId('replays-filter-tag')).toBeNull()
    expect(screen.queryByRole('group')).toBeNull()
  })
})

describe('DemoListFilterBar - clear and count (story 153 D4)', () => {
  it('clear is disabled while inactive, enabled while active, and resets every field', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      createElement(DemoListFilterBar, {
        filter: EMPTY_DEMO_LIST_FILTER,
        onChange,
        options: OPTIONS,
        shown: 0,
        total: 0,
      }),
    )

    expect((screen.getByTestId('replays-filter-clear') as HTMLButtonElement).disabled).toBe(true)

    const activeFilter: DemoListFilter = { ...EMPTY_DEMO_LIST_FILTER, search: 'zulu' }
    rerender(
      createElement(DemoListFilterBar, {
        filter: activeFilter,
        onChange,
        options: OPTIONS,
        shown: 1,
        total: 4,
      }),
    )

    const clearButton = screen.getByTestId('replays-filter-clear') as HTMLButtonElement
    expect(clearButton.disabled).toBe(false)

    fireEvent.click(clearButton)
    expect(onChange).toHaveBeenCalledWith(EMPTY_DEMO_LIST_FILTER)
  })

  it('the count only shows while a filter is active', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      createElement(DemoListFilterBar, {
        filter: EMPTY_DEMO_LIST_FILTER,
        onChange,
        options: OPTIONS,
        shown: 4,
        total: 4,
      }),
    )

    expect(screen.queryByTestId('replays-filter-count')).toBeNull()

    rerender(
      createElement(DemoListFilterBar, {
        filter: { ...EMPTY_DEMO_LIST_FILTER, search: 'zulu' },
        onChange,
        options: OPTIONS,
        shown: 1,
        total: 4,
      }),
    )

    expect(screen.getByTestId('replays-filter-count').textContent).toBe('Showing 1 of 4')
  })
})
