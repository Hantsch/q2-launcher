// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EMPTY_SERVER_LIST_FILTER, type ServerListFilter } from '@shared/servers/list-filter'
import type { QuickFilter } from '@shared/servers/quick-filters'
import { initI18n } from '../../i18n'

let ServerListFilterBar: typeof import('./ServerListFilterBar').ServerListFilterBar

beforeAll(async () => {
  await initI18n('en')
  ;({ ServerListFilterBar } = await import('./ServerListFilterBar'))
})

afterEach(() => {
  cleanup()
})

function renderBar(
  filter: ServerListFilter,
  onChange: (f: ServerListFilter) => void,
  shown = 2,
  total = 2,
) {
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

    fireEvent.click(screen.getByTestId('servers-filter-empty'))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_SERVER_LIST_FILTER, empty: true })

    fireEvent.click(screen.getByTestId('servers-filter-hide-bots'))
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_SERVER_LIST_FILTER, hideBotsOnly: true })

    fireEvent.click(screen.getByTestId('servers-filter-waiting'))
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY_SERVER_LIST_FILTER,
      waitingForOpponent: true,
    })
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

describe('ServerListFilterBar - saved quick filters (story 197 D3)', () => {
  const crit = { ...criteriaFor() }
  function criteriaFor() {
    const { search: _search, ...rest } = EMPTY_SERVER_LIST_FILTER
    void _search
    return rest
  }
  const ctf: QuickFilter = {
    id: 'q1',
    name: 'CTF night',
    criteria: { ...crit, mod: 'ctf', waitingForOpponent: true },
  }

  function renderWith(
    filter: ServerListFilter,
    onChange = vi.fn(),
    quickFilters: QuickFilter[] = [ctf],
  ) {
    render(
      createElement(ServerListFilterBar, {
        filter,
        onChange,
        options: { mods: ['baseq2', 'ctf'], maps: ['q2dm1'] },
        shown: 1,
        total: 1,
        quickFilters,
        onSaveQuickFilter: vi.fn(),
      }),
    )
    return onChange
  }

  it('save as quick filter is disabled with a reason without criteria or at the cap', () => {
    renderWith(EMPTY_SERVER_LIST_FILTER, vi.fn(), [])
    expect((screen.getByTestId('servers-quickfilter-save') as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.getByTestId('servers-quickfilter-save-reason').textContent).toContain('Set a mod')
    cleanup()

    renderWith({ ...EMPTY_SERVER_LIST_FILTER, mod: 'ctf' }, vi.fn(), [])
    expect((screen.getByTestId('servers-quickfilter-save') as HTMLButtonElement).disabled).toBe(
      false,
    )
    expect(screen.queryByTestId('servers-quickfilter-save-reason')).toBeNull()
    cleanup()

    const eight = Array.from({ length: 8 }, (_, i) => ({ ...ctf, id: `q${i}`, name: `n${i}` }))
    renderWith({ ...EMPTY_SERVER_LIST_FILTER, mod: 'ctf' }, vi.fn(), eight)
    expect((screen.getByTestId('servers-quickfilter-save') as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.getByTestId('servers-quickfilter-save-reason').textContent).toContain(
      'delete one first',
    )
  })

  it('a quick filter chip shows pressed with a check mark when the filter equals it', () => {
    renderWith({ ...EMPTY_SERVER_LIST_FILTER, ...ctf.criteria, search: 'x' })
    const chip = screen.getByTestId('servers-quickfilter-chip')
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(chip.querySelector('svg.lucide-check')).not.toBeNull()
    cleanup()

    renderWith({ ...EMPTY_SERVER_LIST_FILTER, mod: 'ctf' })
    const other = screen.getByTestId('servers-quickfilter-chip')
    expect(other.getAttribute('aria-pressed')).toBe('false')
    expect(other.querySelector('svg.lucide-check')).toBeNull()
  })

  it('applying a chip replaces the criteria and keeps the search', () => {
    const onChange = renderWith({ ...EMPTY_SERVER_LIST_FILTER, map: 'q2dm1', search: 'zulu' })
    fireEvent.click(screen.getByTestId('servers-quickfilter-chip'))
    expect(onChange).toHaveBeenCalledWith({ ...ctf.criteria, search: 'zulu' })
  })

  it('clicking a pressed chip clears the criteria and keeps the search', () => {
    const onChange = renderWith({ ...EMPTY_SERVER_LIST_FILTER, ...ctf.criteria, search: 'zulu' })
    fireEvent.click(screen.getByTestId('servers-quickfilter-chip'))
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_SERVER_LIST_FILTER, search: 'zulu' })
  })

  it('built-in chips still toggle their own field with custom chips present', () => {
    const onChange = renderWith(EMPTY_SERVER_LIST_FILTER)
    fireEvent.click(screen.getByTestId('servers-filter-empty'))
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_SERVER_LIST_FILTER, empty: true })
  })
})

describe('ServerListFilterBar - quick filter chip menu (story 197 D4)', () => {
  it('deleting a quick filter never calls onChange', async () => {
    const { QuickFilterChipMenu } = await import('./QuickFilterChipMenu')
    const { search: _search, ...crit } = EMPTY_SERVER_LIST_FILTER
    void _search
    const qf: QuickFilter = { id: 'q1', name: 'CTF night', criteria: { ...crit, mod: 'ctf' } }
    const onChange = vi.fn()
    const onDelete = vi.fn()
    render(
      createElement(ServerListFilterBar, {
        filter: { ...EMPTY_SERVER_LIST_FILTER, mod: 'ctf' },
        onChange,
        options: { mods: ['baseq2', 'ctf'], maps: ['q2dm1'] },
        shown: 1,
        total: 1,
        quickFilters: [qf],
        renderQuickFilterActions: (item: QuickFilter) =>
          createElement(QuickFilterChipMenu, { quickFilter: item, onRename: vi.fn(), onDelete }),
      }),
    )
    fireEvent.click(screen.getByTestId('servers-quickfilter-menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith(qf)
    expect(onChange).not.toHaveBeenCalled()
  })
})
