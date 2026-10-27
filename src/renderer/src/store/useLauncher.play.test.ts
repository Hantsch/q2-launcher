import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { makeInstallation } from '../../../test-support/fixtures'
import { invoke } from '../lib/bridge'
import { useLauncher } from './useLauncher'

vi.mock('../lib/bridge', () => ({
  invoke: vi.fn(async () => ({ ok: true, value: null })),
  onEvent: vi.fn(() => () => {}),
}))

const launchPayloads = (): unknown[] =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([channel]) => channel === 'launch:start')
    .map(([, payload]) => payload)

const seed = (activeMap: string): void => {
  useLauncher.setState({
    installations: [makeInstallation({ activeMap })],
    settings: { ...DEFAULT_SETTINGS, activeInstallationId: 'inst-1' },
  })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useLauncher play', () => {
  it('plain Play passes the saved map', async () => {
    seed('q2dm1')
    await useLauncher.getState().play('inst-1')
    expect(launchPayloads()).toEqual([{ installationId: 'inst-1', map: 'q2dm1' }])
  })

  it('plain Play of the active installation passes its saved map', async () => {
    seed('q2dm1')
    await useLauncher.getState().play()
    expect(launchPayloads()).toEqual([{ installationId: 'inst-1', map: 'q2dm1' }])
  })

  it('plain Play without a saved map passes none', async () => {
    seed('')
    await useLauncher.getState().play('inst-1')
    expect(launchPayloads()).toEqual([{ installationId: 'inst-1' }])
  })

  it('a join never carries the saved map', async () => {
    seed('q2dm1')
    await useLauncher.getState().play('inst-1', { connect: '203.0.113.5:27910' })
    expect(launchPayloads()).toEqual([{ installationId: 'inst-1', connect: '203.0.113.5:27910' }])
  })
})
