import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  DEFAULT_MASTER_SOURCES,
  DEFAULT_SERVERS_STATE,
  SERVERS_HANDLERS,
  SERVERS_HANDLER_SCHEMAS,
  masterSourceSchema,
  serversOverviewSchema,
  serversStateSchema,
} from './servers'

describe('servers module contract (story 106 D1)', () => {
  it('every servers handler has a zod schema', () => {
    for (const name of Object.values(SERVERS_HANDLERS)) {
      expect(SERVERS_HANDLER_SCHEMAS[name]).toBeDefined()
    }
  })

  it('names every handler exactly, including story 111 D1\'s five sources.* handlers', () => {
    expect(SERVERS_HANDLERS).toEqual({
      overviewRead: 'overview.read',
      sourcesList: 'sources.list',
      sourcesAdd: 'sources.add',
      sourcesRemove: 'sources.remove',
      sourcesUpdate: 'sources.update',
      sourcesReorder: 'sources.reorder',
    })
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

describe('servers persisted state (story 110 D1)', () => {
  it('the persisted servers state has a zod schema in the module\'s shared contract', () => {
    const parsed = serversStateSchema.parse(DEFAULT_SERVERS_STATE)
    expect(parsed).toEqual(DEFAULT_SERVERS_STATE)
    expect(Object.keys(serversStateSchema.shape).sort()).toEqual(
      ['favourites', 'history', 'manualServers', 'scan', 'sources'].sort(),
    )
  })

  it('no part of the persisted servers state accepts an installation id', () => {
    const withInstallationId = {
      ...DEFAULT_SERVERS_STATE,
      installationId: 'some-installation',
      sources: [{ id: 'a', type: 'udp-master', address: '1.2.3.4:27900', enabled: true, installationId: 'x' }],
      favourites: [{ address: '1.2.3.4:27910', addedAt: '2026-09-24T00:00:00.000Z', installationId: 'x' }],
      manualServers: [{ address: '1.2.3.4:27911', addedAt: '2026-09-24T00:00:00.000Z', installationId: 'x' }],
      history: [{ address: '1.2.3.4:27912', lastConnectedAt: '2026-09-24T00:00:00.000Z', installationId: 'x' }],
      scan: { ...DEFAULT_SERVERS_STATE.scan, installationId: 'x' },
    }

    const parsed = serversStateSchema.parse(withInstallationId)
    expect(Object.keys(parsed)).not.toContain('installationId')
    expect(Object.keys(parsed.sources[0])).not.toContain('installationId')
    expect(Object.keys(parsed.favourites[0])).not.toContain('installationId')
    expect(Object.keys(parsed.manualServers[0])).not.toContain('installationId')
    expect(Object.keys(parsed.history[0])).not.toContain('installationId')
    expect(Object.keys(parsed.scan)).not.toContain('installationId')

    // The schema definition itself has no installationId key at any level.
    expect(Object.keys(serversStateSchema.shape)).not.toContain('installationId')
    const sourceShape = (serversStateSchema.shape.sources as z.ZodArray<z.ZodTypeAny>).element as z.ZodObject<
      z.ZodRawShape
    >
    expect(Object.keys(sourceShape.shape)).not.toContain('installationId')
  })
})

describe('master sources (story 111 D1)', () => {
  it('every sources.* handler has a payload schema registered', () => {
    for (const name of [
      SERVERS_HANDLERS.sourcesList,
      SERVERS_HANDLERS.sourcesAdd,
      SERVERS_HANDLERS.sourcesRemove,
      SERVERS_HANDLERS.sourcesUpdate,
      SERVERS_HANDLERS.sourcesReorder,
    ]) {
      expect(SERVERS_HANDLER_SCHEMAS[name]).toBeDefined()
    }
  })

  it('DEFAULT_MASTER_SOURCES is exactly the concept\'s three defaults, correctly typed and enabled', () => {
    expect(DEFAULT_MASTER_SOURCES).toEqual([
      {
        id: 'default-q2servers-udp',
        type: 'udp-master',
        address: 'master.q2servers.com:27900',
        enabled: true,
      },
      {
        id: 'default-quakeservers-udp',
        type: 'udp-master',
        address: 'master.quakeservers.net:27900',
        enabled: true,
      },
      {
        id: 'default-q2servers-http',
        type: 'http-list',
        address: 'https://q2servers.com/?raw=1',
        enabled: true,
      },
    ])
    for (const source of DEFAULT_MASTER_SOURCES) {
      expect(masterSourceSchema.safeParse(source).success).toBe(true)
    }
    // Ids are fixed and unique, never randomly generated.
    expect(new Set(DEFAULT_MASTER_SOURCES.map((source) => source.id)).size).toBe(
      DEFAULT_MASTER_SOURCES.length,
    )
  })

  it('sourcesAdd accepts { type, address } and rejects a missing address', () => {
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.sourcesAdd].safeParse({
        type: 'udp-master',
        address: 'master.q2servers.com:27900',
      }).success,
    ).toBe(true)
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.sourcesAdd].safeParse({ type: 'udp-master' }).success,
    ).toBe(false)
  })

  it('sourcesRemove accepts { id }', () => {
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.sourcesRemove].safeParse({ id: 'default-q2servers-udp' })
        .success,
    ).toBe(true)
    expect(SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.sourcesRemove].safeParse({}).success).toBe(false)
  })

  it('sourcesUpdate accepts either an address edit or an enabled toggle', () => {
    const schema = SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.sourcesUpdate]
    expect(
      schema.safeParse({ id: 'default-q2servers-udp', type: 'udp-master', address: 'x:27900' }).success,
    ).toBe(true)
    expect(schema.safeParse({ id: 'default-q2servers-udp', enabled: false }).success).toBe(true)
    expect(schema.safeParse({ id: 'default-q2servers-udp' }).success).toBe(false)
  })

  it('sourcesReorder accepts a list of ids', () => {
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.sourcesReorder].safeParse({
        ids: DEFAULT_MASTER_SOURCES.map((source) => source.id),
      }).success,
    ).toBe(true)
    expect(SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.sourcesReorder].safeParse({ ids: 'nope' }).success).toBe(
      false,
    )
  })
})
