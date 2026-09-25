import { describe, expect, it } from 'vitest'
import type { ScanTarget, ServerListEntry } from '@shared/modules/servers'
import { mergeStaleRound } from './scan-merge'

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

    const result = mergeStaleRound(entries, [target(existing.address)], new Set([existing.address]), false)

    expect(result.get(existing.address)).toEqual(existing)
  })

  it('flips an unanswered target with a pre-existing entry to stale, keeping every other field (D4 acceptance)', () => {
    const existing = entry({ address: '10.0.0.1:27910', status: 'online', players: 12, name: 'Old School' })
    const entries = new Map([[existing.address, existing]])

    const result = mergeStaleRound(entries, [target(existing.address)], new Set(), false)

    expect(result.get(existing.address)).toEqual({ ...existing, status: 'stale' })
    expect(result.get(existing.address)?.players).toBe(12)
    expect(result.get(existing.address)?.name).toBe('Old School')
  })

  it('creates no row for an unanswered target with no pre-existing entry', () => {
    const entries = new Map<string, ServerListEntry>()

    const result = mergeStaleRound(entries, [target('10.0.0.9:27910')], new Set(), false)

    expect(result.has('10.0.0.9:27910')).toBe(false)
    expect(result.size).toBe(0)
  })

  it('changes nothing at all when the round was aborted, even for an unanswered target with an entry', () => {
    const existing = entry({ address: '10.0.0.1:27910' })
    const entries = new Map([[existing.address, existing]])

    const result = mergeStaleRound(entries, [target(existing.address)], new Set(), true)

    expect(result).toBe(entries)
    expect(result.get(existing.address)).toEqual(existing)
  })

  it('leaves an entry untouched when its address is not in this round\'s targets at all', () => {
    const untouched = entry({ address: '10.0.0.5:27910' })
    const entries = new Map([[untouched.address, untouched]])

    const result = mergeStaleRound(entries, [target('10.0.0.1:27910')], new Set(), false)

    expect(result.get(untouched.address)).toEqual(untouched)
  })
})
