import { describe, expect, it } from 'vitest'
import type { ReplaysScanProgress } from '@shared/modules/replays'
import { deriveReplaysListState, describeReplaysScanProgress } from './list-state'

function progress(overrides: Partial<ReplaysScanProgress> = {}): ReplaysScanProgress {
  return { running: false, sources: [], sourceErrors: [], ...overrides }
}

describe('deriveReplaysListState', () => {
  const base = { scanning: false, rowCount: 0, scope: 'all', installationCount: 2 } as const

  it('loading wins while a scan runs, even with rows', () => {
    expect(deriveReplaysListState({ ...base, scanning: true, rowCount: 5 })).toBe('loading')
    expect(deriveReplaysListState({ ...base, scanning: true, scope: 'none' })).toBe('loading')
  })

  it('a list with rows is populated whatever the scope', () => {
    expect(deriveReplaysListState({ ...base, rowCount: 3 })).toBe('populated')
    expect(deriveReplaysListState({ ...base, rowCount: 3, scope: 'installation' })).toBe(
      'populated',
    )
  })

  it('every installation shown and nothing found is the plain empty state', () => {
    expect(deriveReplaysListState(base)).toBe('empty')
  })

  it('no installation registered says so', () => {
    expect(deriveReplaysListState({ ...base, scope: 'none', installationCount: 0 })).toBe(
      'noInstallation',
    )
  })

  it('installations registered but none selected says so', () => {
    expect(deriveReplaysListState({ ...base, scope: 'none' })).toBe('noneSelected')
  })

  it('a selected installation without demos is empty for that installation', () => {
    expect(deriveReplaysListState({ ...base, scope: 'installation' })).toBe('emptyForInstallation')
  })
})

describe('describeReplaysScanProgress (story 151 D3)', () => {
  it('progress sums every source and has no numbers before discovery', () => {
    expect(describeReplaysScanProgress(progress({ sources: [] }))).toEqual({
      key: 'replays.list.loading',
    })

    expect(
      describeReplaysScanProgress(
        progress({
          sources: [
            { sourceKey: 'a', scanned: 0, total: 0 },
            { sourceKey: 'b', scanned: 0, total: 0 },
          ],
        }),
      ),
    ).toEqual({ key: 'replays.list.loading' })

    expect(
      describeReplaysScanProgress(
        progress({
          sources: [
            { sourceKey: 'a', scanned: 3, total: 10 },
            { sourceKey: 'b', scanned: 2, total: 5 },
          ],
        }),
      ),
    ).toEqual({ key: 'replays.list.loadingProgress', params: { scanned: 5, total: 15 } })
  })
})
