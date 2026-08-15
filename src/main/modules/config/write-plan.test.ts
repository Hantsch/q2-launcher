import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import type { LaunchState } from '@shared/types'
import { defaultProfileFor, isInstallationRunning } from './write-plan'

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
