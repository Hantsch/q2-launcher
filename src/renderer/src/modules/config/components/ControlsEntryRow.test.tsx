// @vitest-environment jsdom
import { renderWithProviders } from '../test/render'
import { act, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { profileFixture } from '../test/fixtures'
import { stubBridge } from '../test/bridge'
import { findBindConflicts, indexBindConflicts } from '../lib/bind-conflicts'
import { deriveRowState, type RowState } from '../lib/catalog-binds'
import { controlsRowEntryFor } from '../lib/controls-row-entries'
import { ControlsEntryRow, type ControlsEntryRowContext } from './ControlsEntryRow'

/** The fixture's catalogue entry (`movement:forward`) and its free-named one. */
const CATALOG_ID = 'f'
const PLAIN_ID = 'free'

function profileWithKeys(keysById: Record<string, string[]>): ConfigProfile {
  const base = profileFixture()
  return {
    ...base,
    actions: base.actions!.map((action) => ({
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
    editedActionIds: new Set(),
    revealedMessageRows: new Set(),
    expandedKeyRows: new Set(),
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
      grip={null}
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
