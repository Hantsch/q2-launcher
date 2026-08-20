import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { mergeProfileUpdate } from './useProfileDraft'

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

  it('carries an external same-id update through for fields nothing ever patches locally', () => {
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

    const merged = mergeProfileUpdate(prev, fresh)

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

    const merged = mergeProfileUpdate(prev, fresh)

    expect(merged?.cvars).toEqual({ sensitivity: '7' })
    expect(merged?.categories).toEqual(prev.categories)
    expect(merged?.actions).toEqual(prev.actions)
    expect(merged?.name).toBe('New name')
  })
})
