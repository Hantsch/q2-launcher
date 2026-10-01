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
  mode: 'online',
}

describe('deriveListState', () => {
  it('derives loading, empty, idle and populated', () => {
    expect(deriveListState({ ...BASE, running: true }, 3)).toBe('loading')
    expect(deriveListState({ ...BASE, running: false, finishedAt: 'x' }, 0)).toBe('empty')
    expect(deriveListState({ ...BASE, running: false, finishedAt: null }, 0)).toBe('idle')
    expect(deriveListState({ ...BASE, running: false, finishedAt: 'x' }, 4)).toBe('populated')
  })
})

describe('deriveListState in LAN mode', () => {
  const LAN = { ...BASE, mode: 'lan' as const }

  it('a finished LAN scan with no rows is the LAN empty state', () => {
    expect(deriveListState(LAN, 0, 'lan', '2026-01-01T00:00:00Z')).toBe('lanEmpty')
  })

  it('is loading while a LAN scan runs and idle before any LAN round', () => {
    expect(deriveListState({ ...LAN, running: true }, 0, 'lan', null)).toBe('loading')
    expect(deriveListState(LAN, 0, 'lan', null)).toBe('idle')
    // an Online round finishing does not make the LAN list "empty"
    expect(deriveListState({ ...BASE, finishedAt: 'x' }, 0, 'lan', null)).toBe('idle')
    expect(deriveListState(LAN, 2, 'lan', 'x')).toBe('populated')
  })

  it('a finished LAN scan is not an Online result: Online never scanned stays idle', () => {
    expect(deriveListState({ ...LAN, finishedAt: 'x' }, 0, 'online')).toBe('idle')
    expect(deriveListState({ ...BASE, finishedAt: 'x' }, 0, 'online')).toBe('empty')
  })

  it('a running LAN scan does not make the Online list load', () => {
    expect(deriveListState({ ...LAN, running: true }, 0, 'online')).not.toBe('loading')
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
