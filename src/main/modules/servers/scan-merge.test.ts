import { describe, expect, it } from 'vitest'
import type { RttSample, ScanTarget, ServerListEntry } from '@shared/modules/servers'
import { RTT_HISTORY_LIMIT } from '@shared/modules/servers'
import { appendRttSample, mergeStaleRound } from './scan-merge'

const NOW = '2024-06-01T00:00:00.000Z'

/**
 * Story 116 D4: `mergeStaleRound` - pure, map in / map out, no `AppContext` (mirrors
 * `address-set.test.ts`'s scope for this module's other pure helper).
 */

function target(address: string): ScanTarget {
  return { address, origins: ['source'] }
}

function entry(overrides: Partial<ServerListEntry> = {}): ServerListEntry {
  return {
    address: '10.0.0.1:27910',
    origins: ['source'],
    status: 'online',
    name: 'Some Server',
    players: 12,
    lastSeenAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('mergeStaleRound', () => {
  it('leaves an answered target untouched', () => {
    const existing = entry({ address: '10.0.0.1:27910' })
    const entries = new Map([[existing.address, existing]])

    const result = mergeStaleRound(entries, [target(existing.address)], new Set([existing.address]), false, NOW)

    expect(result.get(existing.address)).toEqual(existing)
  })

  it('flips an unanswered target with a pre-existing entry to stale, keeping every other field (D4 acceptance)', () => {
    const existing = entry({ address: '10.0.0.1:27910', status: 'online', players: 12, name: 'Old School' })
    const entries = new Map([[existing.address, existing]])

    const result = mergeStaleRound(entries, [target(existing.address)], new Set(), false, NOW)

    expect(result.get(existing.address)).toEqual({
      ...existing,
      status: 'stale',
      rttHistory: [{ at: NOW, rttMs: null }],
    })
    expect(result.get(existing.address)?.players).toBe(12)
    expect(result.get(existing.address)?.name).toBe('Old School')
  })

  it('creates no row for an unanswered target with no pre-existing entry', () => {
    const entries = new Map<string, ServerListEntry>()

    const result = mergeStaleRound(entries, [target('10.0.0.9:27910')], new Set(), false, NOW)

    expect(result.has('10.0.0.9:27910')).toBe(false)
    expect(result.size).toBe(0)
  })

  it('changes nothing at all when the round was aborted, even for an unanswered target with an entry', () => {
    const existing = entry({ address: '10.0.0.1:27910' })
    const entries = new Map([[existing.address, existing]])

    const result = mergeStaleRound(entries, [target(existing.address)], new Set(), true, NOW)

    expect(result).toBe(entries)
    expect(result.get(existing.address)).toEqual(existing)
  })

  it('leaves an entry untouched when its address is not in this round\'s targets at all', () => {
    const untouched = entry({ address: '10.0.0.5:27910' })
    const entries = new Map([[untouched.address, untouched]])

    const result = mergeStaleRound(entries, [target('10.0.0.1:27910')], new Set(), false, NOW)

    expect(result.get(untouched.address)).toEqual(untouched)
  })

  it('a silent favourite/manual target with no entry becomes a field-less stale row; a silent source-only target gets none', () => {
    const entries = new Map<string, ServerListEntry>()
    const favouriteTarget: ScanTarget = { address: '10.0.0.6:27910', origins: ['favourite'] }
    const manualTarget: ScanTarget = { address: '10.0.0.7:27910', origins: ['manual'] }
    const sourceTarget: ScanTarget = { address: '10.0.0.8:27910', origins: ['source'] }

    const result = mergeStaleRound(entries, [favouriteTarget, manualTarget, sourceTarget], new Set(), false, NOW)

    expect(result.get(favouriteTarget.address)).toEqual({
      address: favouriteTarget.address,
      origins: ['favourite'],
      status: 'stale',
      lastSeenAt: null,
    })
    expect(result.get(manualTarget.address)).toEqual({
      address: manualTarget.address,
      origins: ['manual'],
      status: 'stale',
      lastSeenAt: null,
    })
    expect(result.has(sourceTarget.address)).toBe(false)
    expect(result.size).toBe(2)
  })
})

describe('appendRttSample', () => {
  it('keeps only the newest RTT_HISTORY_LIMIT samples', () => {
    let history: RttSample[] | undefined
    for (let i = 0; i < RTT_HISTORY_LIMIT + 5; i++) {
      history = appendRttSample(history, { at: `t${i}`, rttMs: i })
    }

    expect(history).toHaveLength(RTT_HISTORY_LIMIT)
    expect(history![0]).toEqual({ at: 't5', rttMs: 5 })
    expect(history!.at(-1)).toEqual({ at: `t${RTT_HISTORY_LIMIT + 4}`, rttMs: RTT_HISTORY_LIMIT + 4 })
  })
})

describe('mergeStaleRound - story 124 D1 RTT history', () => {
  it('a stale-flipped server gets a no-answer sample', () => {
    const existing = entry({ address: '10.0.0.1:27910' })
    const entries = new Map([[existing.address, existing]])

    const result = mergeStaleRound(entries, [target(existing.address)], new Set(), false, NOW)

    expect(result.get(existing.address)?.rttHistory).toEqual([{ at: NOW, rttMs: null }])
  })

  it('an aborted round adds no sample', () => {
    const existing = entry({ address: '10.0.0.1:27910' })
    const entries = new Map([[existing.address, existing]])

    const result = mergeStaleRound(entries, [target(existing.address)], new Set(), true, NOW)

    expect(result.get(existing.address)?.rttHistory).toBeUndefined()
  })
})
