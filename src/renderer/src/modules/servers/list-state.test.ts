import { describe, expect, it } from 'vitest'
import type { ServersScanState } from '@shared/modules/servers'
import { deriveListState, describeScanProgress } from './list-state'

const BASE: ServersScanState = {
  running: false,
  phase: 'idle',
  stage1Done: 0,
  stage1Total: 0,
  stage2Done: 0,
  stage2Total: 0,
  sourceFailures: [],
  startedAt: null,
  finishedAt: null,
  blockedReason: null,
  scope: null,
}

describe('deriveListState', () => {
  it('derives loading, empty, idle and populated', () => {
    expect(deriveListState({ ...BASE, running: true }, 3)).toBe('loading')
    expect(deriveListState({ ...BASE, running: false, finishedAt: 'x' }, 0)).toBe('empty')
    expect(deriveListState({ ...BASE, running: false, finishedAt: null }, 0)).toBe('idle')
    expect(deriveListState({ ...BASE, running: false, finishedAt: 'x' }, 4)).toBe('populated')
  })
})

describe('describeScanProgress', () => {
  it('progress reports found and still-being-queried counts, then stage 2', () => {
    expect(
      describeScanProgress({ ...BASE, running: true, stage1Total: 10, stage1Done: 4 }),
    ).toEqual([{ key: 'servers.list.loading.stage1', params: { found: 10, pending: 6 } }])

    expect(describeScanProgress({ ...BASE, running: true, stage1Total: 0 })).toEqual([
      { key: 'servers.list.loading.sources' },
    ])

    expect(
      describeScanProgress({
        ...BASE,
        running: true,
        phase: 'stage2',
        stage1Total: 10,
        stage1Done: 10,
        stage2Total: 5,
        stage2Done: 2,
      }),
    ).toEqual([
      { key: 'servers.list.loading.stage1', params: { found: 10, pending: 0 } },
      { key: 'servers.list.loading.stage2', params: { done: 2, total: 5 } },
    ])
  })
})
