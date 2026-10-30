// @vitest-environment jsdom
import { renderWithProviders } from '../test/render'
import { act, screen } from '@testing-library/react'
import { useMemo, useState, type ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { profileFixture } from '../test/fixtures'
import { stubBridge } from '../test/bridge'
import { findBindConflicts, indexBindConflicts } from '../lib/bind-conflicts'
import { deriveRowState, type RowState } from '../lib/catalog-binds'
import { controlsRowEntryFor } from '../lib/controls-row-entries'
import { ControlsDragZone } from './ControlsDragZone'
import { ControlsEntryRow, type ControlsEntryRowContext } from './ControlsEntryRow'
import { ControlsGrid } from './ControlsGrid'

/** How often each row's content rendered, by row id - `ControlsRow` renders exactly once per
 * `ControlsEntryRow` render, so this counts the memoised row's own renders. */
const rowRenders = new Map<string, number>()

vi.mock('./ControlsRow', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ControlsRow')>()
  return {
    ...original,
    ControlsRow: (props: ComponentProps<typeof original.ControlsRow>) => {
      rowRenders.set(props.rowId, (rowRenders.get(props.rowId) ?? 0) + 1)
      return original.ControlsRow(props)
    },
  }
})

/** The fixture's catalogue entry (`movement:forward`) and its free-named one. */
const CATALOG_ID = 'f'
const PLAIN_ID = 'free'

/** A free-form drop entry (`drop_` alias running `drop …`), so its row carries the drop toggles. */
const DROP_ID = 'drop-rockets'

function profileWithKeys(keysById: Record<string, string[]>): ConfigProfile {
  const base = profileFixture()
  const drop: ConfigAction = {
    id: DROP_ID,
    categoryId: 'movement',
    name: 'Drop rockets',
    kind: 'bind',
    aliasName: 'drop_rockets',
    commands: [{ kind: 'raw', text: 'drop rockets' }],
  }
  return {
    ...base,
    actions: [...base.actions!, drop].map((action) => ({
      ...action,
      keys: (keysById[action.id] ?? []).map((key) => ({ key })),
    })),
  }
}

function contextFor(profile: ConfigProfile, onActionsChange: (next: ConfigAction[]) => void) {
  const rowState = new Map<string, RowState>()
  for (const action of profile.actions ?? []) {
    const entry = controlsRowEntryFor(action)
    if (entry.kind === 'catalog') rowState.set(action.id, deriveRowState(action, entry.row))
  }
  const ctx: ControlsEntryRowContext = {
    draft: profile,
    conflictIndex: indexBindConflicts(findBindConflicts(profile)),
    rowState,
    moveTargets: new Map(),
    unavailableReasonKey: () => undefined,
    onActionsChange,
    onReset: vi.fn(),
    onToggleExpanded: vi.fn(),
    onToggleDropAmmo: vi.fn(),
    onToggleDropMessage: vi.fn(),
    onEditMessage: vi.fn(),
    onMove: vi.fn(),
    onMoveTo: vi.fn(),
    onEdit: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
    setRowElement: vi.fn(),
  }
  return ctx
}

/** Mounts the row for `actionId` and returns the action list it handed to the tab's save path. */
function mountRow(profile: ConfigProfile, actionId: string) {
  stubBridge()
  const onActionsChange = vi.fn<(next: ConfigAction[]) => void>()
  const action = profile.actions!.find((candidate) => candidate.id === actionId)!
  const { container } = renderWithProviders(
    <ControlsEntryRow
      entry={controlsRowEntryFor(action)}
      odd={false}
      edited={false}
      messageRevealed={false}
      keysExpanded={false}
      ctx={contextFor(profile, onActionsChange)}
    />,
    { profile },
  )
  const slots = () => container.querySelectorAll<HTMLButtonElement>('.ctrl-keycell .ctrl-slot')
  const patched = (id: string) => onActionsChange.mock.lastCall?.[0].find((a) => a.id === id)
  return { slots, patched, onActionsChange }
}

async function capture(slot: HTMLButtonElement, key: string, code: string): Promise<void> {
  await act(async () => {
    slot.click()
  })
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }))
  })
}

describe('a Controls entry row writes its key slots the same way for every kind of entry', () => {
  it('assigning a key to a body-less catalogue row also gives it the catalogue commands', async () => {
    const row = mountRow(profileWithKeys({}), CATALOG_ID)
    await capture(row.slots()[0]!, 'g', 'KeyG')
    expect(row.patched(CATALOG_ID)?.keys).toEqual([{ key: 'g' }])
    expect(row.patched(CATALOG_ID)?.commands.length).toBeGreaterThan(0)
  })

  it('assigning a key to a plain row leaves its commands as they were', async () => {
    const row = mountRow(profileWithKeys({}), PLAIN_ID)
    await capture(row.slots()[0]!, 'g', 'KeyG')
    expect(row.patched(PLAIN_ID)?.keys).toEqual([{ key: 'g' }])
    expect(row.patched(PLAIN_ID)?.commands).toEqual([])
  })

  it.each([CATALOG_ID, PLAIN_ID])('clearing the only key of %s empties its slots', async (id) => {
    const row = mountRow(profileWithKeys({ [id]: ['h'] }), id)
    await capture(row.slots()[0]!, 'Delete', 'Delete')
    expect(row.patched(id)?.keys ?? []).toEqual([])
    // A clear never makes a body-less catalogue entry real.
    expect(row.patched(id)?.commands).toEqual([])
  })

  it.each([
    [CATALOG_ID, PLAIN_ID],
    [PLAIN_ID, CATALOG_ID],
  ])('replacing takes the key from the other row for %s', async (id, otherId) => {
    const row = mountRow(profileWithKeys({ [otherId]: ['g'] }), id)
    await capture(row.slots()[0]!, 'g', 'KeyG')
    expect(row.onActionsChange).not.toHaveBeenCalled()
    await act(async () => {
      screen.getByRole('button', { name: 'Replace' }).click()
    })
    expect(row.patched(id)?.keys).toEqual([{ key: 'g' }])
    expect((row.patched(otherId)?.keys ?? []).filter((slot) => slot.key)).toEqual([])
    expect((row.patched(id)?.commands.length ?? 0) > 0).toBe(id === CATALOG_ID)
  })
})

interface GridView {
  profile: ConfigProfile
  /** Changes nothing a row shows; only makes the grid itself render again. */
  tick: number
}

/**
 * The grid wired to its rows the way the Controls tab wires them: one memoised context per draft,
 * per-row view state in the parent, the grip's inputs passed flat. `controller.show` replaces the
 * view from outside, as a parent re-render or a draft edit would.
 */
function GridHarness({
  initial,
  controller,
  onActionsChange,
}: {
  initial: ConfigProfile
  controller: { show?: (view: GridView) => void }
  onActionsChange: (next: ConfigAction[]) => void
}) {
  const [view, setView] = useState<GridView>({ profile: initial, tick: 0 })
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  controller.show = setView
  const ctx = useMemo<ControlsEntryRowContext>(
    () => ({
      ...contextFor(view.profile, onActionsChange),
      onToggleExpanded: (id) => setExpanded((current) => new Set(current).add(id)),
      onToggleDropMessage: (action) => setRevealed((current) => new Set(current).add(action.id)),
    }),
    [view.profile, onActionsChange],
  )
  const groups = useMemo(
    () => [{ subcategory: null, entries: (view.profile.actions ?? []).map(controlsRowEntryFor) }],
    [view.profile],
  )
  return (
    <ControlsDragZone groups={groups}>
      <ControlsGrid
        ariaLabel={`Controls ${view.tick}`}
        groups={groups}
        rowCount={groups[0]!.entries.length}
        boundCount={0}
        renderRow={(entry, index, grip) => (
          <ControlsEntryRow
            entry={entry}
            odd={index % 2 === 0}
            edited={false}
            messageRevealed={revealed.has(entry.action.id)}
            keysExpanded={expanded.has(entry.action.id)}
            gripAttributes={grip.attributes}
            gripListeners={grip.listeners}
            dragDisabled={grip.disabled}
            dragDisabledReason={grip.disabledReason}
            ctx={ctx}
          />
        )}
      />
    </ControlsDragZone>
  )
}

function mountGrid(profile: ConfigProfile) {
  stubBridge()
  const controller: { show?: (view: GridView) => void } = {}
  const onActionsChange = vi.fn<(next: ConfigAction[]) => void>()
  const { container } = renderWithProviders(
    <GridHarness initial={profile} controller={controller} onActionsChange={onActionsChange} />,
    { profile },
  )
  const show = (view: GridView) =>
    act(() => {
      controller.show!(view)
    })
  const rowSlots = (selector: string) =>
    container.querySelectorAll<HTMLButtonElement>(`${selector} .ctrl-slot`)
  const patched = (id: string) => onActionsChange.mock.lastCall?.[0].find((a) => a.id === id)
  return { container, show, rowSlots, patched }
}

const rendersSoFar = () => Object.fromEntries(rowRenders)

describe('a Controls grid re-renders only the rows whose data changed', () => {
  beforeEach(() => rowRenders.clear())

  it('re-rendering the grid with unchanged props re-renders no row', () => {
    const profile = profileWithKeys({ [PLAIN_ID]: ['g'] })
    const grid = mountGrid(profile)
    const before = rendersSoFar()
    expect(Object.keys(before)).toEqual([CATALOG_ID, PLAIN_ID, DROP_ID])

    grid.show({ profile, tick: 1 })

    expect(screen.getByRole('table', { name: 'Controls 1' })).toBeTruthy()
    expect(rendersSoFar()).toEqual(before)
  })

  it('toggling drop on a row changes only that row', async () => {
    const grid = mountGrid(profileWithKeys({}))
    const before = rendersSoFar()

    await act(async () => {
      grid.container
        .querySelector<HTMLButtonElement>(`[data-testid="drop-message-${DROP_ID}"] button`)!
        .click()
    })

    expect(screen.getByTestId(`drop-message-row-${DROP_ID}`)).toBeTruthy()
    expect(rendersSoFar()).toEqual({ ...before, [DROP_ID]: before[DROP_ID]! + 1 })
  })

  it('a compact add row assigns its key', async () => {
    const grid = mountGrid(profileWithKeys({ [PLAIN_ID]: ['g'] }))
    // A later draft edit must reach the row's handlers: the add slot writes after the new keys.
    grid.show({ profile: profileWithKeys({ [PLAIN_ID]: ['g', 'h'] }), tick: 1 })

    const add = grid.container.querySelector<HTMLButtonElement>(
      `[role="rowgroup"][data-row-id="${PLAIN_ID}"] .ctrl-slot-add`,
    )!
    await capture(add, 'j', 'KeyJ')

    expect(grid.patched(PLAIN_ID)?.keys).toEqual([{ key: 'g' }, { key: 'h' }, { key: 'j' }])
  })

  it('an extra-key row writes its own slot', async () => {
    const grid = mountGrid(profileWithKeys({ [PLAIN_ID]: ['g', 'h', 'j'] }))
    await act(async () => {
      grid.container
        .querySelector<HTMLButtonElement>(`[data-row-id="${PLAIN_ID}"] .ctrl-keymore`)!
        .click()
    })

    const secondKey = grid.rowSlots(`.ctrl-keysub-row[data-row-id="${PLAIN_ID}"]`)[0]!
    await capture(secondKey, 'k', 'KeyK')

    expect(grid.patched(PLAIN_ID)?.keys).toEqual([{ key: 'g' }, { key: 'k' }, { key: 'j' }])
  })
})
