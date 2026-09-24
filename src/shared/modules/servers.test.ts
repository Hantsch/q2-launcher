import { describe, expect, it } from 'vitest'
import { SERVERS_HANDLERS, SERVERS_HANDLER_SCHEMAS, serversOverviewSchema } from './servers'

describe('servers module contract (story 106 D1)', () => {
  it('every servers handler has a zod schema', () => {
    for (const name of Object.values(SERVERS_HANDLERS)) {
      expect(SERVERS_HANDLER_SCHEMAS[name]).toBeDefined()
    }
  })

  it('names overview.read exactly', () => {
    expect(SERVERS_HANDLERS).toEqual({ overviewRead: 'overview.read' })
  })

  it('the no-input overview handler accepts undefined', () => {
    expect(SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.overviewRead].safeParse(undefined).success).toBe(
      true,
    )
  })
})

describe('serversOverviewSchema', () => {
  it('accepts a well-formed overview, including a null lastScanAt', () => {
    expect(
      serversOverviewSchema.safeParse({ scanning: false, knownServerCount: 0, lastScanAt: null })
        .success,
    ).toBe(true)
    expect(
      serversOverviewSchema.safeParse({
        scanning: true,
        knownServerCount: 12,
        lastScanAt: '2026-09-24T00:00:00.000Z',
      }).success,
    ).toBe(true)
  })

  it('rejects a missing field or wrong type', () => {
    expect(serversOverviewSchema.safeParse({ scanning: false, knownServerCount: 0 }).success).toBe(
      false,
    )
    expect(
      serversOverviewSchema.safeParse({ scanning: 'no', knownServerCount: 0, lastScanAt: null })
        .success,
    ).toBe(false)
  })
})
