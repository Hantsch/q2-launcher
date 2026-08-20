import { describe, expect, it } from 'vitest'
import type { ConfigAction } from '@shared/modules/config'
import { buildMovementRows } from './catalog-binds'
import { restoreDefaultActions } from './restore-defaults'

function catalogAction(overrides: Partial<ConfigAction> & { catalogId: string }): ConfigAction {
  return {
    id: crypto.randomUUID(),
    categoryId: 'movement',
    name: overrides.catalogId,
    kind: 'bind',
    commands: [{ kind: 'raw', text: '+forward' }],
    ...overrides,
  }
}

describe('restoreDefaultActions', () => {
  it("resets a catalogue row with a suggested key to suggestedKeys[0], clearing its secondary", () => {
    // `movement:forward` (MOVEMENT_ACTIONS 'forward') has suggestedKeys: ['w'].
    const forwardRow = buildMovementRows().find((row) => row.catalogId === 'movement:forward')!
    const actions: ConfigAction[] = [
      catalogAction({
        catalogId: forwardRow.catalogId,
        key: 'x',
        secondaryKey: 'y',
        secondaryKeyModifier: 'ALT',
      }),
    ]

    const result = restoreDefaultActions(actions)
    const restored = result.find((action) => action.catalogId === forwardRow.catalogId)

    expect(restored?.key).toBe('w')
    expect(restored?.keyModifier).toBeUndefined()
    expect(restored?.secondaryKey).toBeUndefined()
    expect(restored?.secondaryKeyModifier).toBeUndefined()
  })

  it('clears a catalogue row with no suggestedKeys entirely rather than leaving it as-is', () => {
    // `movement:left` (MOVEMENT_ACTIONS 'left') carries no suggestedKeys - there is no default.
    const leftRow = buildMovementRows().find((row) => row.catalogId === 'movement:left')!
    const actions: ConfigAction[] = [
      catalogAction({ catalogId: leftRow.catalogId, key: 'j', secondaryKey: 'k' }),
    ]

    const result = restoreDefaultActions(actions)

    // No key, no secondary and no message left on it - `isEmptyAction` prunes the row entirely.
    expect(result.find((action) => action.catalogId === leftRow.catalogId)).toBeUndefined()
  })

  it("clears a custom/legacy action's key data but leaves commands, name, kind and categoryId untouched", () => {
    const custom: ConfigAction = {
      id: crypto.randomUUID(),
      categoryId: 'my-custom-category',
      name: 'Say GG',
      kind: 'bind',
      commands: [{ kind: 'message', channel: 'say', text: 'gg' }],
      key: 'F1',
      secondaryKey: 'F2',
      keyModifier: 'CTRL',
      secondaryKeyModifier: 'SHIFT',
    }

    const result = restoreDefaultActions([custom])
    const restored = result.find((action) => action.id === custom.id)

    expect(restored).toBeDefined()
    expect(restored?.key).toBeUndefined()
    expect(restored?.secondaryKey).toBeUndefined()
    expect(restored?.keyModifier).toBeUndefined()
    expect(restored?.secondaryKeyModifier).toBeUndefined()
    expect(restored?.commands).toEqual(custom.commands)
    expect(restored?.name).toBe('Say GG')
    expect(restored?.kind).toBe('bind')
    expect(restored?.categoryId).toBe('my-custom-category')
  })

  it('clears stray key data off an alias entry without throwing', () => {
    const alias: ConfigAction = {
      id: crypto.randomUUID(),
      categoryId: 'my-custom-category',
      name: 'quad',
      kind: 'alias',
      commands: [{ kind: 'raw', text: 'use quad damage' }],
      // Review-fix scenario elsewhere in this codebase: an alias entry may still carry stale
      // key data from before it became an alias (story 019).
      key: 'F9',
      secondaryKey: 'F10',
    }

    expect(() => restoreDefaultActions([alias])).not.toThrow()
    const result = restoreDefaultActions([alias])
    const restored = result.find((action) => action.id === alias.id)

    expect(restored?.key).toBeUndefined()
    expect(restored?.secondaryKey).toBeUndefined()
    expect(restored?.kind).toBe('alias')
  })

  it('never mutates the input array', () => {
    const actions: ConfigAction[] = [
      catalogAction({ catalogId: 'movement:forward', key: 'x' }),
    ]
    const snapshot = JSON.parse(JSON.stringify(actions))

    restoreDefaultActions(actions)

    expect(actions).toEqual(snapshot)
  })
})
