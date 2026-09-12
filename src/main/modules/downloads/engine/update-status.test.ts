import { describe, expect, it } from 'vitest'
import { computeEngineUpdateStatus } from './update-status'

/**
 * Story 092 D3: `computeEngineUpdateStatus` - the update-check half of AC1, pure comparison over
 * recorded state + a resolved target, no I/O. Mirrors `installation-state.test.ts`'s style.
 */

describe('computeEngineUpdateStatus', () => {
  it('reports no update when the recorded version already matches the target', () => {
    const status = computeEngineUpdateStatus(
      'inst-1',
      'q2pro',
      { version: '2.34' },
      { channel: 'pinned', version: '2.34' },
    )

    expect(status).toEqual({
      installationId: 'inst-1',
      engine: 'q2pro',
      current: '2.34',
      target: '2.34',
      updateAvailable: false,
      channel: 'pinned',
    })
  })

  it('reports an update available when the recorded version differs from the target', () => {
    const status = computeEngineUpdateStatus(
      'inst-1',
      'q2pro',
      { version: '2.33' },
      { channel: 'pinned', version: '2.34' },
    )

    expect(status.updateAvailable).toBe(true)
    expect(status.current).toBe('2.33')
    expect(status.target).toBe('2.34')
  })

  it('reports an update available with current undefined for an unknown recorded version', () => {
    const status = computeEngineUpdateStatus(
      'inst-1',
      'r1q2',
      {},
      { channel: 'pinned', version: '8.42' },
    )

    expect(status.updateAvailable).toBe(true)
    expect(status.current).toBeUndefined()
    expect(status.target).toBe('8.42')
  })

  it('reports no update, without throwing, for an engine with no manifest pin', () => {
    expect(() =>
      computeEngineUpdateStatus('inst-1', 'r1q2', { version: '8.41' }, { channel: 'pinned', version: undefined }),
    ).not.toThrow()

    const status = computeEngineUpdateStatus(
      'inst-1',
      'r1q2',
      { version: '8.41' },
      { channel: 'pinned', version: undefined },
    )
    expect(status.updateAvailable).toBe(false)
    expect(status.target).toBeUndefined()
  })

  it('carries the recorded backup through untouched', () => {
    const backup = { version: '2.33', packageId: 'q2pro-win64', createdAt: 1000 }
    const status = computeEngineUpdateStatus(
      'inst-1',
      'q2pro',
      { version: '2.34', backup },
      { channel: 'pinned', version: '2.34' },
    )

    expect(status.backup).toEqual(backup)
  })
})
