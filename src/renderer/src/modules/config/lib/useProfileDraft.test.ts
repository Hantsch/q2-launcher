import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { mergeProfileUpdate, type LocallyPatchedField } from './useProfileDraft'

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

describe('mergeProfileUpdate', () => {
  it('takes the fresh profile outright when there is no previous draft', () => {
    const fresh = profile({ cvars: { sensitivity: '3' } })
    expect(mergeProfileUpdate(null, fresh)).toBe(fresh)
  })

  it('takes the fresh profile outright on a profile switch (different id)', () => {
    const prev = profile({ id: 'p1', cvars: { sensitivity: '3' } })
    const next = profile({ id: 'p2', cvars: { sensitivity: '9' } })
    expect(mergeProfileUpdate(prev, next)).toBe(next)
  })

  it('returns null when the incoming profile is null (selection cleared)', () => {
    expect(mergeProfileUpdate(profile(), null)).toBeNull()
  })

  it('carries an external same-id update through when no local edit is in flight', () => {
    // Regression test for the review finding: LayersPanel, OverviewKeyboardPanel and
    // ProfileAssignmentsPanel/RenameProfileDialog save immediately and call `onChanged`
    // without ever calling `patch()`, so their fields must always come from the fresh
    // `profile`, never frozen at whatever the draft had at the last patch.
    const prev = profile({ name: 'Old name', assignments: [], binds: {}, layers: [] })
    const fresh = profile({
      name: 'New name',
      assignments: [{ installationId: 'a', isDefault: true }],
      binds: { MOUSE1: '+attack' },
      layers: [{ id: 'l1', name: 'Zoom', mode: 'toggle', triggerKey: 'v', overrides: {} }],
    })

    const merged = mergeProfileUpdate(prev, fresh, new Set<LocallyPatchedField>())

    expect(merged?.name).toBe('New name')
    expect(merged?.assignments).toEqual(fresh.assignments)
    expect(merged?.binds).toEqual(fresh.binds)
    expect(merged?.layers).toEqual(fresh.layers)
  })

  it('preserves the locally-patched fields (cvars, categories, actions) over a same-id external update', () => {
    // The inverse guarantee: an in-flight debounced save (e.g. a cvar keystroke)
    // must never be clobbered by an external profile update that has not caught up yet.
    const prev = profile({
      cvars: { sensitivity: '7' }, // a keystroke `patch()` already applied, not yet saved
      categories: [{ id: 'c1', name: 'Custom' }],
      actions: [{ id: 'a1', categoryId: 'c1', name: 'Drop', kind: 'bind', commands: [] }],
      name: 'Old name',
    })
    const fresh = profile({
      cvars: { sensitivity: '3' }, // the server's last known value, now stale
      categories: [],
      actions: [],
      name: 'New name', // an unrelated external field genuinely did change
    })

    const merged = mergeProfileUpdate(prev, fresh, new Set<LocallyPatchedField>(['cvars', 'categories', 'actions']))

    expect(merged?.cvars).toEqual({ sensitivity: '7' })
    expect(merged?.categories).toEqual(prev.categories)
    expect(merged?.actions).toEqual(prev.actions)
    expect(merged?.name).toBe('New name')
  })

  it('takes an externally changed actions array when nothing local is in flight (story 034)', () => {
    // Main adopts a raw catalogue bind into an action on every write, so `actions` genuinely
    // changes from outside this draft now - freezing it unconditionally would keep the Controls
    // grid showing "empty" for a key the Overview keyboard has just bound.
    const prev = profile({ actions: [] })
    const fresh = profile({
      actions: [
        {
          id: 'a1',
          categoryId: 'movement',
          name: '+forward',
          kind: 'bind',
          catalogId: 'movement:forward',
          commands: [{ kind: 'raw', text: '+forward' }],
          keys: [{ key: 'w' }],
        },
      ],
    })

    const merged = mergeProfileUpdate(prev, fresh, new Set<LocallyPatchedField>())

    expect(merged?.actions).toEqual(fresh.actions)
  })
})
