import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ScanBlockedReason, ServersScanState } from './servers'
import {
  DEFAULT_MASTER_SOURCES,
  DEFAULT_SERVERS_STATE,
  SCAN_BLOCKED_GAME_RUNNING_REASON_KEY,
  SERVER_HISTORY_CAP,
  SERVERS_HANDLERS,
  SERVERS_HANDLER_SCHEMAS,
  detailReadInputSchema,
  manualServerEntrySchema,
  masterSourceSchema,
  scanPatchSettingsInputSchema,
  scanScopeSchema,
  scanStartInputSchema,
  serverHistoryEntrySchema,
  serversOverviewSchema,
  serversStateSchema,
} from './servers'

describe('servers module contract (story 106 D1)', () => {
  it('every servers handler has a zod schema', () => {
    for (const name of Object.values(SERVERS_HANDLERS)) {
      expect(SERVERS_HANDLER_SCHEMAS[name]).toBeDefined()
    }
  })

  it('names every handler exactly, including story 111 D1\'s five sources.* handlers, story 112 D1\'s three favourites.* handlers, story 113 D1\'s four manual.*/history.* handlers, story 114 D1\'s two scan.* handlers and story 115 D1\'s three scan.*Settings/setViewActive handlers', () => {
    expect(SERVERS_HANDLERS).toEqual({
      overviewRead: 'overview.read',
      sourcesList: 'sources.list',
      sourcesAdd: 'sources.add',
      sourcesRemove: 'sources.remove',
      sourcesUpdate: 'sources.update',
      sourcesReorder: 'sources.reorder',
      favouritesList: 'favourites.list',
      favouritesAdd: 'favourites.add',
      favouritesRemove: 'favourites.remove',
      manualList: 'manual.list',
      manualAdd: 'manual.add',
      manualRemove: 'manual.remove',
      historyRead: 'history.read',
      scanStart: 'scan.start',
      scanRead: 'scan.read',
      scanGetSettings: 'scan.getSettings',
      scanPatchSettings: 'scan.patchSettings',
      scanSetViewActive: 'scan.setViewActive',
      listGetSort: 'list.getSort',
      listSetSort: 'list.setSort',
      detailRead: 'detail.read',
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
      ['favourites', 'history', 'manualServers', 'scan', 'sources', 'watchlist'].sort(),
    )
  })

  it('no part of the persisted servers state accepts an installation id', () => {
    const withInstallationId = {
      ...DEFAULT_SERVERS_STATE,
      installationId: 'some-installation',
      sources: [{ id: 'a', type: 'udp-master', address: '1.2.3.4:27900', enabled: true, installationId: 'x' }],
      favourites: [{ address: '1.2.3.4:27910', addedAt: '2026-09-24T00:00:00.000Z', installationId: 'x' }],
      manualServers: [
        { address: '1.2.3.4:27911', origin: 'manual', addedAt: '2026-09-24T00:00:00.000Z', installationId: 'x' },
      ],
      history: [{ address: '1.2.3.4:27912', connectedAt: '2026-09-24T00:00:00.000Z', installationId: 'x' }],
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

  it('DEFAULT_MASTER_SOURCES is exactly the one shipped default, correctly typed and enabled', () => {
    expect(DEFAULT_MASTER_SOURCES).toEqual([
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

describe('favourites (story 112 D1)', () => {
  it('every favourites.* handler has a payload schema registered', () => {
    for (const name of [
      SERVERS_HANDLERS.favouritesList,
      SERVERS_HANDLERS.favouritesAdd,
      SERVERS_HANDLERS.favouritesRemove,
    ]) {
      expect(SERVERS_HANDLER_SCHEMAS[name]).toBeDefined()
    }
  })

  it('favouritesList accepts undefined (no payload)', () => {
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.favouritesList].safeParse(undefined).success,
    ).toBe(true)
  })

  it('favouritesAdd/favouritesRemove accept a well-formed ip:port address', () => {
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.favouritesAdd].safeParse('1.2.3.4:27910').success,
    ).toBe(true)
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.favouritesRemove].safeParse('1.2.3.4:27910').success,
    ).toBe(true)
  })

  it('favouritesAdd/favouritesRemove reject a malformed address', () => {
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.favouritesAdd].safeParse('not-an-address').success,
    ).toBe(false)
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.favouritesRemove].safeParse('not-an-address').success,
    ).toBe(false)
  })
})

describe('manual servers and history (story 113 D1)', () => {
  it('every manual.*/history.* handler has a payload schema registered', () => {
    for (const name of [
      SERVERS_HANDLERS.manualList,
      SERVERS_HANDLERS.manualAdd,
      SERVERS_HANDLERS.manualRemove,
      SERVERS_HANDLERS.historyRead,
    ]) {
      expect(SERVERS_HANDLER_SCHEMAS[name]).toBeDefined()
    }
  })

  it('manualList/historyRead accept undefined (no payload)', () => {
    expect(SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.manualList].safeParse(undefined).success).toBe(
      true,
    )
    expect(SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.historyRead].safeParse(undefined).success).toBe(
      true,
    )
  })

  it('manualAdd/manualRemove accept { address } as raw, unvalidated input - including a malformed one, unlike favouritesAdd/favouritesRemove', () => {
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.manualAdd].safeParse({ address: '1.2.3.4:27910' })
        .success,
    ).toBe(true)
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.manualAdd].safeParse({ address: 'not-an-address' })
        .success,
    ).toBe(true)
    expect(SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.manualAdd].safeParse({}).success).toBe(false)

    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.manualRemove].safeParse({ address: '1.2.3.4:27910' })
        .success,
    ).toBe(true)
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.manualRemove].safeParse({ address: 'not-an-address' })
        .success,
    ).toBe(true)
    expect(SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.manualRemove].safeParse({}).success).toBe(false)
  })

  it('SERVER_HISTORY_CAP is 200', () => {
    expect(SERVER_HISTORY_CAP).toBe(200)
  })

  it('manualServerEntrySchema (the shared row manual.list/manual.add resolve to, per D-K) requires origin: \'manual\'', () => {
    expect(
      manualServerEntrySchema.safeParse({
        address: '1.2.3.4:27911',
        origin: 'manual',
        addedAt: '2026-09-24T00:00:00.000Z',
      }).success,
    ).toBe(true)
    expect(
      manualServerEntrySchema.safeParse({ address: '1.2.3.4:27911', addedAt: '2026-09-24T00:00:00.000Z' })
        .success,
    ).toBe(false)
    expect(
      manualServerEntrySchema.safeParse({
        address: '1.2.3.4:27911',
        origin: 'scanned',
        addedAt: '2026-09-24T00:00:00.000Z',
      }).success,
    ).toBe(false)
  })

  it('serverHistoryEntrySchema (the shared row history.read resolves to, per D-K) uses connectedAt', () => {
    expect(
      serverHistoryEntrySchema.safeParse({
        address: '1.2.3.4:27912',
        connectedAt: '2026-09-24T00:00:00.000Z',
      }).success,
    ).toBe(true)
    expect(
      serverHistoryEntrySchema.safeParse({
        address: '1.2.3.4:27912',
        lastConnectedAt: '2026-09-24T00:00:00.000Z',
      }).success,
    ).toBe(false)
  })
})

describe('scan settings (story 115 D1)', () => {
  it('every scan.*Settings/scan.setViewActive handler has a payload schema registered', () => {
    for (const name of [
      SERVERS_HANDLERS.scanGetSettings,
      SERVERS_HANDLERS.scanPatchSettings,
      SERVERS_HANDLERS.scanSetViewActive,
    ]) {
      expect(SERVERS_HANDLER_SCHEMAS[name]).toBeDefined()
    }
  })

  it('scanGetSettings accepts undefined (no payload)', () => {
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.scanGetSettings].safeParse(undefined).success,
    ).toBe(true)
  })

  it('scanSetViewActive accepts { active }', () => {
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.scanSetViewActive].safeParse({ active: true }).success,
    ).toBe(true)
    expect(
      SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.scanSetViewActive].safeParse({}).success,
    ).toBe(false)
  })

  it('scanPatchSettingsInputSchema accepts an empty patch and a valid partial patch', () => {
    expect(scanPatchSettingsInputSchema.safeParse({}).success).toBe(true)
    expect(scanPatchSettingsInputSchema.safeParse({ concurrency: 8 }).success).toBe(true)
  })

  it('scanPatchSettingsInputSchema rejects an out-of-range numeric field', () => {
    expect(scanPatchSettingsInputSchema.safeParse({ concurrency: 999 }).success).toBe(false)
    expect(scanPatchSettingsInputSchema.safeParse({ timeoutMs: 999_999 }).success).toBe(false)
    expect(scanPatchSettingsInputSchema.safeParse({ retries: -1 }).success).toBe(false)
    expect(scanPatchSettingsInputSchema.safeParse({ minSpacingMs: -1 }).success).toBe(false)
    expect(
      scanPatchSettingsInputSchema.safeParse({ autoRefreshIntervalMs: 1 }).success,
    ).toBe(false)
  })
})

describe('scan guard (story 116 D1)', () => {
  it('ScanBlockedReason accepts \'game-running\'', () => {
    const reason: ScanBlockedReason = 'game-running'
    expect(reason).toBe('game-running')
  })

  it('ServersScanState accepts blockedReason as either a ScanBlockedReason or null', () => {
    const blocked: ServersScanState = {
      running: false,
      phase: 'idle',
      stage1Done: 0,
      stage1Total: 0,
      stage2Done: 0,
      stage2Total: 0,
      sourceFailures: [],
      startedAt: null,
      finishedAt: null,
      blockedReason: 'game-running',
      scope: null,
    }
    const unblocked: ServersScanState = { ...blocked, blockedReason: null }

    expect(blocked.blockedReason).toBe('game-running')
    expect(unblocked.blockedReason).toBeNull()
  })

  it('SCAN_BLOCKED_GAME_RUNNING_REASON_KEY is the distinct blocked-state i18n key, not the error-state convention', () => {
    expect(SCAN_BLOCKED_GAME_RUNNING_REASON_KEY).toBe('servers.scan.blocked.gameRunning')
  })
})

describe('scan scope (story 117 D1)', () => {
  it('scanScopeSchema accepts all three valid shapes', () => {
    expect(scanScopeSchema.safeParse({ kind: 'all' }).success).toBe(true)
    expect(scanScopeSchema.safeParse({ kind: 'favourites' }).success).toBe(true)
    expect(scanScopeSchema.safeParse({ kind: 'server', address: '1.2.3.4:27910' }).success).toBe(
      true,
    )
  })

  it('scanScopeSchema rejects a server scope with a malformed address', () => {
    expect(scanScopeSchema.safeParse({ kind: 'server', address: 'not-an-address' }).success).toBe(
      false,
    )
    expect(scanScopeSchema.safeParse({ kind: 'server', address: '' }).success).toBe(false)
    expect(scanScopeSchema.safeParse({ kind: 'server' }).success).toBe(false)
  })

  it('scanScopeSchema rejects an unknown kind', () => {
    expect(scanScopeSchema.safeParse({ kind: 'nope' }).success).toBe(false)
  })

  it('scanStartInputSchema still accepts no payload, selectedAddress only, scope only, and both together', () => {
    expect(scanStartInputSchema.safeParse(undefined).success).toBe(true)
    expect(
      scanStartInputSchema.safeParse({ selectedAddress: '1.2.3.4:27910' }).success,
    ).toBe(true)
    expect(scanStartInputSchema.safeParse({ scope: { kind: 'favourites' } }).success).toBe(true)
    expect(
      scanStartInputSchema.safeParse({
        selectedAddress: '1.2.3.4:27910',
        scope: { kind: 'server', address: '1.2.3.4:27910' },
      }).success,
    ).toBe(true)
  })

  it('scanStartInputSchema rejects a malformed scope', () => {
    expect(
      scanStartInputSchema.safeParse({ scope: { kind: 'server', address: 'not-an-address' } })
        .success,
    ).toBe(false)
  })
})

describe('server detail (story 122 D2)', () => {
  it('detailReadInputSchema accepts a well-formed address and rejects a missing one', () => {
    expect(detailReadInputSchema.safeParse('127.0.0.1:27910').success).toBe(true)
    expect(detailReadInputSchema.safeParse({}).success).toBe(false)
  })

  it('every servers handler (including detail.read) has a payload schema registered', () => {
    expect(SERVERS_HANDLER_SCHEMAS[SERVERS_HANDLERS.detailRead]).toBeDefined()
  })
})
