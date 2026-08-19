import { describe, expect, it } from 'vitest'
import type { ConfigProfile, ProfileAssignment } from '@shared/modules/config'
import type { Installation } from '@shared/types/installation'
import type { EngineKind } from '@shared/types/engine'
import { pickRawInstallationId } from './raw-view'

function profile(assignments: ProfileAssignment[] = []): ConfigProfile {
  return {
    id: 'p1',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments,
  }
}

function installation(id: string, engineKind: EngineKind = 'r1q2'): Installation {
  return {
    id,
    name: id,
    rootPath: `C:/games/${id}`,
    engineKind,
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    checks: [],
    gameDirs: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
  }
}

describe('pickRawInstallationId', () => {
  it('keeps the current pick when it is still one of the assignments', () => {
    const p = profile([
      { installationId: 'a', isDefault: true },
      { installationId: 'b', isDefault: false },
    ])

    expect(pickRawInstallationId(p, [installation('a'), installation('b')], null, 'b')).toBe('b')
  })

  it('falls back to the default assignment when the current pick is no longer valid', () => {
    const p = profile([
      { installationId: 'a', isDefault: false },
      { installationId: 'b', isDefault: true },
    ])

    expect(pickRawInstallationId(p, [installation('a'), installation('b')], null, 'gone')).toBe(
      'b',
    )
  })

  it('falls back to the active installation when no default is set and it is assigned', () => {
    const p = profile([
      { installationId: 'a', isDefault: false },
      { installationId: 'b', isDefault: false },
    ])

    expect(pickRawInstallationId(p, [installation('a'), installation('b')], 'b', null)).toBe('b')
  })

  it('falls back to the first assignment when no default is set and the active installation is not assigned', () => {
    const p = profile([
      { installationId: 'a', isDefault: false },
      { installationId: 'b', isDefault: false },
    ])

    expect(pickRawInstallationId(p, [installation('a'), installation('b')], 'c', null)).toBe('a')
  })

  it('falls back to the first assignment when there is no active installation at all', () => {
    const p = profile([
      { installationId: 'a', isDefault: false },
      { installationId: 'b', isDefault: false },
    ])

    expect(pickRawInstallationId(p, [installation('a'), installation('b')], null, null)).toBe('a')
  })

  it('returns null when the profile has no assignments', () => {
    const p = profile([])

    expect(pickRawInstallationId(p, [], null, null)).toBeNull()
  })
})
