import { describe, expect, it } from 'vitest'
import type { ServerHistoryEntry } from '@shared/modules/servers'
import { SERVER_HISTORY_CAP } from '@shared/modules/servers'
import { capServerHistory, readServerHistory, recordServerVisit } from './history-log'

/** Builds a log already in newest-first order (index 0 is the most recently connected). */
function buildLog(count: number): ServerHistoryEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    address: `10.0.0.${i}:27910`,
    connectedAt: new Date(2026, 0, 1, 0, 0, count - i).toISOString(),
  }))
}

describe('recordServerVisit', () => {
  it('a 201st entry evicts the oldest and the log never exceeds the cap', () => {
    const log = buildLog(SERVER_HISTORY_CAP)
    const oldest = log[log.length - 1]
    expect(oldest).toBeDefined()

    const result = recordServerVisit(log, { address: 'newserver.example.com:27910' })

    expect(result).toHaveLength(SERVER_HISTORY_CAP)
    expect(result[0]?.address).toBe('newserver.example.com:27910')
    expect(result.some((entry) => entry.address === oldest?.address)).toBe(false)
  })

  it('records a repeat visit by moving the address to the front and updating connectedAt, without adding a row', () => {
    const log = recordServerVisit([], {
      address: 'a.example.com:27910',
      connectedAt: '2026-01-01T00:00:00.000Z',
    })
    const withSecond = recordServerVisit(log, {
      address: 'b.example.com:27910',
      connectedAt: '2026-01-01T00:01:00.000Z',
    })

    const revisited = recordServerVisit(withSecond, {
      address: 'a.example.com:27910',
      connectedAt: '2026-01-01T00:02:00.000Z',
    })

    expect(revisited).toHaveLength(2)
    expect(revisited[0]).toEqual({
      address: 'a.example.com:27910',
      connectedAt: '2026-01-01T00:02:00.000Z',
    })
    expect(revisited.filter((entry) => entry.address === 'a.example.com:27910')).toHaveLength(1)
  })

  it('defaults connectedAt to the current time when not passed', () => {
    const before = Date.now()
    const result = recordServerVisit([], { address: 'c.example.com:27910' })
    const after = Date.now()

    const parsed = new Date(result[0]?.connectedAt ?? '').getTime()
    expect(parsed).toBeGreaterThanOrEqual(before)
    expect(parsed).toBeLessThanOrEqual(after)
  })
})

describe('readServerHistory', () => {
  it('history reads back most-recent-first', () => {
    let log: ServerHistoryEntry[] = []
    log = recordServerVisit(log, {
      address: 'first.example.com:27910',
      connectedAt: '2026-01-01T00:00:00.000Z',
    })
    log = recordServerVisit(log, {
      address: 'second.example.com:27910',
      connectedAt: '2026-01-01T00:01:00.000Z',
    })
    log = recordServerVisit(log, {
      address: 'third.example.com:27910',
      connectedAt: '2026-01-01T00:02:00.000Z',
    })

    const result = readServerHistory(log)

    expect(result.map((entry) => entry.address)).toEqual([
      'third.example.com:27910',
      'second.example.com:27910',
      'first.example.com:27910',
    ])
  })
})

describe('capServerHistory', () => {
  it('given a log longer than the cap, returns exactly the cap, keeping the first entries of the input order', () => {
    const log = buildLog(SERVER_HISTORY_CAP + 50)

    const result = capServerHistory(log)

    expect(result).toHaveLength(SERVER_HISTORY_CAP)
    expect(result).toEqual(log.slice(0, SERVER_HISTORY_CAP))
  })

  it('leaves a log at or under the cap unchanged', () => {
    const log = buildLog(10)

    expect(capServerHistory(log)).toEqual(log)
  })
})
