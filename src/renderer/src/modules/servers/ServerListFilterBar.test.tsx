// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EMPTY_SERVER_LIST_FILTER, type ServerListFilter } from '@shared/servers/list-filter'
import { initI18n } from '../../i18n'

let ServerListFilterBar: typeof import('./ServerListFilterBar').ServerListFilterBar

beforeAll(async () => {
  await initI18n('en')
  ;({ ServerListFilterBar } = await import('./ServerListFilterBar'))
})

afterEach(() => {
  cleanup()
})

function renderBar(filter: ServerListFilter, onChange: (f: ServerListFilter) => void, shown = 2, total = 2) {
  render(
    createElement(ServerListFilterBar, {
      filter,
      onChange,
      options: { mods: ['baseq2', 'ctf'], maps: ['q2dm1', 'q2dm2'] },
      shown,
      total,
    }),
  )
}

describe('ServerListFilterBar - each control writes its own field (story 120 D2)', () => {
  it('search writes on every keystroke', () => {
    const onChange = vi.fn()
    renderBar(EMPTY_SERVER_LIST_FILTER, onChange)

    fireEvent.change(screen.getByTestId('servers-filter-search'), { target: { value: 'zulu' } })

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_SERVER_LIST_FILTER, search: 'zulu' })
  })

  it('mod select writes the selected mod, and "Any" writes null', () => {
    const onChange = vi.fn()
    renderBar({ ...EMPTY_SERVER_LIST_FILTER, mod: 'baseq2' }, onChange)

    fireEvent.change(screen.getByTestId('servers-filter-mod'), { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_SERVER_LIST_FILTER, mod: null })
  })

  it('gamemode select writes the selected gamemode', () => {
    const onChange = vi.fn()
    renderBar(EMPTY_SERVER_LIST_FILTER, onChange)

    fireEvent.change(screen.getByTestId('servers-filter-gamemode'), { target: { value: 'ctf' } })

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_SERVER_LIST_FILTER, gamemode: 'ctf' })
  })

  it('map select writes the selected map', () => {
    const onChange = vi.fn()
    renderBar(EMPTY_SERVER_LIST_FILTER, onChange)

    fireEvent.change(screen.getByTestId('servers-filter-map'), { target: { value: 'q2dm1' } })

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_SERVER_LIST_FILTER, map: 'q2dm1' })
  })

  it('each quick-filter chip toggles only its own field', () => {
    const onChange = vi.fn()
    renderBar(EMPTY_SERVER_LIST_FILTER, onChange)

    fireEvent.click(screen.getByTestId('servers-filter-non-empty'))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_SERVER_LIST_FILTER, nonEmpty: true })

    fireEvent.click(screen.getByTestId('servers-filter-empty'))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_SERVER_LIST_FILTER, empty: true })

    fireEvent.click(screen.getByTestId('servers-filter-hide-bots'))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_SERVER_LIST_FILTER, hideBotsOnly: true })

    fireEvent.click(screen.getByTestId('servers-filter-no-password'))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_SERVER_LIST_FILTER, noPassword: true })

    fireEvent.click(screen.getByTestId('servers-filter-waiting'))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_SERVER_LIST_FILTER, waitingForOpponent: true })
  })

  it('a selected mod/map not present in options still renders as the selected value', () => {
    const onChange = vi.fn()
    renderBar({ ...EMPTY_SERVER_LIST_FILTER, mod: 'vanished-mod' }, onChange)

    const select = screen.getByTestId('servers-filter-mod') as HTMLSelectElement
    expect(select.value).toBe('vanished-mod')
  })
})

describe('ServerListFilterBar - clear and count (story 120 D2)', () => {
  it('clear is disabled while inactive, enabled while active, and resets every field', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      createElement(ServerListFilterBar, {
        filter: EMPTY_SERVER_LIST_FILTER,
        onChange,
        options: { mods: [], maps: [] },
        shown: 0,
        total: 0,
      }),
    )

    expect((screen.getByTestId('servers-filter-clear') as HTMLButtonElement).disabled).toBe(true)

    const activeFilter: ServerListFilter = { ...EMPTY_SERVER_LIST_FILTER, search: 'zulu' }
    rerender(
      createElement(ServerListFilterBar, {
        filter: activeFilter,
        onChange,
        options: { mods: [], maps: [] },
        shown: 1,
        total: 4,
      }),
    )

    const clearButton = screen.getByTestId('servers-filter-clear') as HTMLButtonElement
    expect(clearButton.disabled).toBe(false)

    fireEvent.click(clearButton)
    expect(onChange).toHaveBeenCalledWith(EMPTY_SERVER_LIST_FILTER)
  })

  it('the count only shows while a filter is active', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      createElement(ServerListFilterBar, {
        filter: EMPTY_SERVER_LIST_FILTER,
        onChange,
        options: { mods: [], maps: [] },
        shown: 4,
        total: 4,
      }),
    )

    expect(screen.queryByTestId('servers-filter-count')).toBeNull()

    rerender(
      createElement(ServerListFilterBar, {
        filter: { ...EMPTY_SERVER_LIST_FILTER, search: 'zulu' },
        onChange,
        options: { mods: [], maps: [] },
        shown: 1,
        total: 4,
      }),
    )

    expect(screen.getByTestId('servers-filter-count').textContent).toBe('Showing 1 of 4')
  })
})
