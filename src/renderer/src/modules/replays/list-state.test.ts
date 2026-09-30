import { describe, expect, it } from 'vitest'
import type { ReplaysScanProgress } from '@shared/modules/replays'
import { deriveReplaysListState, describeReplaysScanProgress } from './list-state'

function progress(overrides: Partial<ReplaysScanProgress> = {}): ReplaysScanProgress {
  return { running: false, sources: [], sourceErrors: [], ...overrides }
}

describe('deriveReplaysListState (story 151 D3)', () => {
  it('loading wins while a scan runs, even with rows', () => {
    expect(deriveReplaysListState({ scanning: true, rowCount: 5 })).toBe('loading')
  })

  it('empty only after the scan finished with no rows', () => {
    expect(deriveReplaysListState({ scanning: false, rowCount: 0 })).toBe('empty')
    expect(deriveReplaysListState({ scanning: true, rowCount: 0 })).toBe('loading')
    expect(deriveReplaysListState({ scanning: false, rowCount: 3 })).toBe('populated')
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
