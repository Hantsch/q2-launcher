import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import type { LaunchState } from '@shared/types'
import { assignedProfilesFor, defaultProfileFor, isInstallationRunning } from './write-plan'

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

describe('defaultProfileFor', () => {
  it('finds the profile whose assignment is the default for the given installation', () => {
    const profiles = [
      profile({ id: 'p1', assignments: [{ installationId: 'i1', isDefault: false }] }),
      profile({ id: 'p2', assignments: [{ installationId: 'i1', isDefault: true }] }),
      profile({ id: 'p3', assignments: [{ installationId: 'i2', isDefault: true }] }),
    ]

    expect(defaultProfileFor(profiles, 'i1')?.id).toBe('p2')
    expect(defaultProfileFor(profiles, 'i2')?.id).toBe('p3')
  })

  it('returns null when no profile has a default assignment for the installation', () => {
    const profiles = [
      profile({ id: 'p1', assignments: [{ installationId: 'i1', isDefault: false }] }),
      profile({ id: 'p2', assignments: [] }),
    ]

    expect(defaultProfileFor(profiles, 'i1')).toBeNull()
    expect(defaultProfileFor([], 'i1')).toBeNull()
  })
})

describe('assignedProfilesFor', () => {
  it('filters to only profiles assigned to the given installation, preserving list order', () => {
    const profiles = [
      profile({ id: 'p1', name: 'One', assignments: [{ installationId: 'i1', isDefault: true }] }),
      profile({ id: 'p2', name: 'Two', assignments: [{ installationId: 'i2', isDefault: true }] }),
      profile({ id: 'p3', name: 'Three', assignments: [{ installationId: 'i1', isDefault: false }] }),
    ]

    expect(assignedProfilesFor(profiles, 'i1')).toEqual([
      { id: 'p1', name: 'One' },
      { id: 'p3', name: 'Three' },
    ])
  })

  it('returns an empty array when the installation has no assignments', () => {
    const profiles = [profile({ id: 'p1', assignments: [{ installationId: 'i2', isDefault: true }] })]

    expect(assignedProfilesFor(profiles, 'i1')).toEqual([])
  })

  it('returns {id, name} shape only, dropping cvars/binds/assignments', () => {
    const profiles = [
      profile({
        id: 'p1',
        name: 'One',
        cvars: { sensitivity: '3' },
        assignments: [{ installationId: 'i1', isDefault: true }],
      }),
    ]

    expect(assignedProfilesFor(profiles, 'i1')).toEqual([{ id: 'p1', name: 'One' }])
  })
})

function launchState(overrides: Partial<LaunchState> = {}): LaunchState {
  return { phase: 'idle', installationId: null, ...overrides }
}

describe('isInstallationRunning', () => {
  it('is true for the matching installation while starting or running', () => {
    expect(isInstallationRunning(launchState({ phase: 'starting', installationId: 'i1' }), 'i1')).toBe(
      true,
    )
    expect(isInstallationRunning(launchState({ phase: 'running', installationId: 'i1' }), 'i1')).toBe(
      true,
    )
  })

  it('is false for exited, failed or idle phases', () => {
    expect(isInstallationRunning(launchState({ phase: 'exited', installationId: 'i1' }), 'i1')).toBe(
      false,
    )
    expect(isInstallationRunning(launchState({ phase: 'failed', installationId: 'i1' }), 'i1')).toBe(
      false,
    )
    expect(isInstallationRunning(launchState({ phase: 'idle', installationId: null }), 'i1')).toBe(
      false,
    )
  })

  it('is false when a different installation is running', () => {
    expect(isInstallationRunning(launchState({ phase: 'running', installationId: 'i2' }), 'i1')).toBe(
      false,
    )
  })
})
