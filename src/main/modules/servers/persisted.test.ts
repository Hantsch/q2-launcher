import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STATE_SCHEMA_VERSION } from '@shared/constants'
import {
  DEFAULT_MASTER_SOURCES,
  DEFAULT_SERVERS_STATE,
  SERVER_HISTORY_CAP,
  type ManualServerEntry,
  type ServerHistoryEntry,
  type ServersState,
} from '@shared/modules/servers'
import { StateStore } from '../../services/state'
import { homeState } from '../home/persisted'
import { parseServersState, serversState } from './persisted'

// Story 110 D2.
describe('parseServersState (story 110 D2)', () => {
  const validSource1 = {
    id: 's1',
    type: 'udp-master',
    address: '203.0.113.10:27900',
    enabled: true,
  }
  const validSource2 = {
    id: 's2',
    type: 'http-list',
    address: 'https://example.com/list?raw=1',
    enabled: false,
  }
  const malformedSource = { id: 's3', type: 'udp-master', address: '203.0.113.12:27900' } // missing enabled

  const validFavourite1 = { address: '203.0.113.20:27910', addedAt: '2026-01-01T00:00:00.000Z' }
  const validFavourite2 = { address: '203.0.113.21:27910', addedAt: '2026-01-02T00:00:00.000Z' }
  const malformedFavourite = { address: '203.0.113.22:27910' } // missing addedAt

  it('a genuinely foreign (non-object) servers value falls back to the shipped default (three sources, everything else empty)', () => {
    const cases: unknown[] = ['not an object', 42]

    for (const raw of cases) {
      expect(() => parseServersState(raw)).not.toThrow()
      const result = parseServersState(raw)
      expect(result).toEqual(DEFAULT_SERVERS_STATE)

      // Prove it's a fresh clone, not a shared reference: mutating the result must not mutate the
      // shared `DEFAULT_SERVERS_STATE` constant.
      result.sources.push({
        id: 'mutated',
        type: 'udp-master',
        address: '1.2.3.4:27910',
        enabled: true,
      })
      result.scan.concurrency = 999
      expect(DEFAULT_SERVERS_STATE.sources).toEqual(DEFAULT_MASTER_SOURCES)
      expect(DEFAULT_SERVERS_STATE.scan.concurrency).toBe(24)
    }
  })

  it('parseServersState skips a damaged quick filter and keeps the others', () => {
    const crit = {
      mod: 'ctf',
      gamemode: null,
      map: null,
      empty: false,
      hideBotsOnly: false,
      waitingForOpponent: false,
    }
    const row = (id: string, name: string) => ({ id, name, criteria: crit })
    const raw = {
      quickFilters: [
        row('a', 'Alpha'),
        { id: 'b', name: 'Bad mode', criteria: { ...crit, gamemode: 'bogus' } },
        { id: 'c', criteria: crit },
        { id: 'd', name: 'Empty', criteria: { ...crit, mod: null } },
        'not an object',
        row('e', 'alpha'),
        row('f', 'Foxtrot'),
        row('g1', 'G1'),
        row('g2', 'G2'),
        row('g3', 'G3'),
        row('g4', 'G4'),
        row('g5', 'G5'),
        row('g6', 'G6'),
      ],
    }
    expect(() => parseServersState(raw)).not.toThrow()
    const names = parseServersState(raw).quickFilters.map((q) => q.name)
    // damaged rows and the case-insensitive duplicate are gone, order kept, capped at 8
    expect(names).toEqual(['Alpha', 'Foxtrot', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'])
    expect(parseServersState({}).quickFilters).toEqual([])
    expect(parseServersState(undefined).quickFilters).toEqual([])
    expect(parseServersState({ quickFilters: 'junk' }).quickFilters).toEqual([])
  })

  it('a quick filter saved before story 247 loads with no ping limit', () => {
    const criteria = {
      mod: 'ctf',
      gamemode: null,
      map: null,
      empty: false,
      hideBotsOnly: false,
      waitingForOpponent: false,
    }
    const parsed = parseServersState({ quickFilters: [{ id: 'a', name: 'Old', criteria }] })
    expect(parsed.quickFilters).toEqual([
      { id: 'a', name: 'Old', criteria: { ...criteria, mod: ['ctf'], map: [], maxPingMs: null } },
    ])
  })

  it('a legacy single-mod quick filter loads as a set of one', () => {
    const legacy = {
      mod: 'x',
      gamemode: null,
      map: null,
      maxPingMs: null,
      empty: false,
      hideBotsOnly: false,
      waitingForOpponent: false,
    }
    const parsed = parseServersState({
      quickFilters: [
        { id: 'a', name: 'One', criteria: legacy },
        { id: 'b', name: 'None', criteria: { ...legacy, mod: null, empty: true } },
        { id: 'c', name: 'Blank', criteria: { ...legacy, mod: null } },
      ],
    })
    expect(parsed.quickFilters.map((q) => q.name)).toEqual(['One', 'None'])
    expect(parsed.quickFilters[0].criteria.mod).toEqual(['x'])
    expect(parsed.quickFilters[0].criteria.map).toEqual([])
    expect(parsed.quickFilters[1].criteria.mod).toEqual([])
  })

  it('a quick filter with an unknown ping step is dropped', () => {
    const criteria = {
      mod: null,
      gamemode: null,
      map: null,
      maxPingMs: 100,
      empty: false,
      hideBotsOnly: false,
      waitingForOpponent: false,
    }
    const parsed = parseServersState({
      quickFilters: [
        { id: 'a', name: 'Good', criteria },
        { id: 'b', name: 'Odd', criteria: { ...criteria, maxPingMs: 75 } },
        { id: 'c', name: 'Also good', criteria: { ...criteria, maxPingMs: 50 } },
      ],
    })
    expect(parsed.quickFilters.map((q) => q.name)).toEqual(['Good', 'Also good'])
  })

  // Story 111 D2.
  it('a state.json without the `servers` key at all yields the three shipped default sources', () => {
    const result = parseServersState(undefined)
    expect(result.sources).toEqual(DEFAULT_MASTER_SOURCES)
    expect(result.favourites).toEqual([])
  })

  it('a `servers` value present but with no `sources` sub-field also yields the three defaults', () => {
    const result = parseServersState({
      favourites: [],
      manualServers: [],
      history: [],
      scan: DEFAULT_SERVERS_STATE.scan,
    })
    expect(result.sources).toEqual(DEFAULT_MASTER_SOURCES)
  })

  it('an explicitly stored empty `sources` array stays empty, not re-seeded to the defaults', () => {
    const result = parseServersState({
      sources: [],
      favourites: [],
      manualServers: [],
      history: [],
      scan: DEFAULT_SERVERS_STATE.scan,
    })
    expect(result.sources).toEqual([])
  })

  it('one malformed source row alongside a valid one is dropped, the valid sibling survives', () => {
    const result = parseServersState({
      sources: [validSource1, malformedSource],
      favourites: [],
      manualServers: [],
      history: [],
      scan: DEFAULT_SERVERS_STATE.scan,
    })
    expect(result.sources).toEqual([validSource1])
  })

  it('a malformed favourite and a malformed source are dropped, their siblings survive', () => {
    expect(() =>
      parseServersState({
        sources: [validSource1, validSource2, malformedSource],
        favourites: [validFavourite1, validFavourite2, malformedFavourite],
        manualServers: [],
        history: [],
        scan: DEFAULT_SERVERS_STATE.scan,
      }),
    ).not.toThrow()

    const result = parseServersState({
      sources: [validSource1, validSource2, malformedSource],
      favourites: [validFavourite1, validFavourite2, malformedFavourite],
      manualServers: [],
      history: [],
      scan: DEFAULT_SERVERS_STATE.scan,
    })

    expect(result.sources).toHaveLength(2)
    expect(result.sources.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(result.favourites).toHaveLength(2)
    expect(result.favourites.map((f) => f.address)).toEqual([
      '203.0.113.20:27910',
      '203.0.113.21:27910',
    ])
  })

  it('a row whose address fails parseServerAddress is dropped like any other malformed row', () => {
    const result = parseServersState({
      sources: [],
      favourites: [
        validFavourite1,
        { address: 'not a valid address', addedAt: '2026-01-03T00:00:00.000Z' },
      ],
      manualServers: [],
      history: [],
      scan: DEFAULT_SERVERS_STATE.scan,
    })

    expect(result.favourites).toEqual([validFavourite1])
  })

  it('a garbage scan.concurrency falls back to its default while the other knobs are preserved', () => {
    const result = parseServersState({
      sources: [],
      favourites: [],
      manualServers: [],
      history: [],
      scan: {
        concurrency: 'nope',
        timeoutMs: 5000,
        retries: 3,
        minSpacingMs: 15_000,
        autoScanOnOpen: false,
        autoRefreshEnabled: true,
        autoRefreshIntervalMs: 120_000,
      },
    })

    expect(result.scan).toEqual({
      concurrency: DEFAULT_SERVERS_STATE.scan.concurrency,
      timeoutMs: 5000,
      retries: 3,
      minSpacingMs: 15_000,
      autoScanOnOpen: false,
      autoRefreshEnabled: true,
      autoRefreshIntervalMs: 120_000,
    })
  })

  // Story 115 D2: an out-of-range numeric field falls back to its own default (not just a
  // non-number value), same clamp-and-catch convention as `downloadsSettingsSchema`'s
  // `concurrentJobs`. Proves field-level fallback, not whole-object: the sibling valid fields
  // (including a valid new D1 field) survive untouched.
  it('an out-of-range scan.concurrency falls back to its default while the other knobs (including the new fields) are preserved', () => {
    const result = parseServersState({
      sources: [],
      favourites: [],
      manualServers: [],
      history: [],
      scan: {
        concurrency: 999,
        timeoutMs: 1000,
        retries: 2,
        minSpacingMs: 15_000,
        autoScanOnOpen: false,
        autoRefreshEnabled: true,
        autoRefreshIntervalMs: 120_000,
      },
    })

    expect(result.scan).toEqual({
      concurrency: DEFAULT_SERVERS_STATE.scan.concurrency,
      timeoutMs: 1000,
      retries: 2,
      minSpacingMs: 15_000,
      autoScanOnOpen: false,
      autoRefreshEnabled: true,
      autoRefreshIntervalMs: 120_000,
    })
  })

  // Story 115 D2: same field-level fallback proof for one of the three new fields -
  // `autoRefreshIntervalMs` out of range falls back to its own default only.
  it('an out-of-range scan.autoRefreshIntervalMs falls back to its default while the other knobs are preserved', () => {
    const result = parseServersState({
      sources: [],
      favourites: [],
      manualServers: [],
      history: [],
      scan: {
        concurrency: 16,
        timeoutMs: 1000,
        retries: 2,
        minSpacingMs: 15_000,
        autoScanOnOpen: false,
        autoRefreshEnabled: true,
        autoRefreshIntervalMs: 999_999_999,
      },
    })

    expect(result.scan).toEqual({
      concurrency: 16,
      timeoutMs: 1000,
      retries: 2,
      minSpacingMs: 15_000,
      autoScanOnOpen: false,
      autoRefreshEnabled: true,
      autoRefreshIntervalMs: DEFAULT_SERVERS_STATE.scan.autoRefreshIntervalMs,
    })
  })

  it('duplicate sources sharing an id collapse to the first occurrence', () => {
    const result = parseServersState({
      sources: [
        validSource1,
        { id: 's1', type: 'http-list', address: '203.0.113.30:80', enabled: false },
      ],
      favourites: [],
      manualServers: [],
      history: [],
      scan: DEFAULT_SERVERS_STATE.scan,
    })

    expect(result.sources).toEqual([validSource1])
  })

  it('duplicate favourites sharing a normalized address collapse to the first occurrence', () => {
    const result = parseServersState({
      sources: [],
      favourites: [
        validFavourite1,
        { address: '203.0.113.20:27910', addedAt: '2026-01-09T00:00:00.000Z' },
      ],
      manualServers: [],
      history: [],
      scan: DEFAULT_SERVERS_STATE.scan,
    })

    expect(result.favourites).toEqual([validFavourite1])
  })

  // Story 113 D-G: the cap is a store invariant, not just an append-path detail - a hand-edited or
  // foreign `state.json` must not be able to reintroduce an unbounded history.
  it('a history longer than the cap is truncated on parse, oldest (tail) rows dropped', () => {
    const rows = Array.from({ length: SERVER_HISTORY_CAP + 50 }, (_, index) => ({
      address: `203.0.113.${Math.floor(index / 250)}:${27910 + (index % 250)}`,
      connectedAt: '2026-01-10T00:00:00.000Z',
    }))

    const result = parseServersState({
      sources: [],
      favourites: [],
      manualServers: [],
      history: rows,
      scan: DEFAULT_SERVERS_STATE.scan,
    })

    expect(result.history).toHaveLength(SERVER_HISTORY_CAP)
    // The head (newest) survived and the tail went, rather than an arbitrary slice.
    expect(result.history[0]).toEqual(rows[0])
    expect(result.history.at(-1)).toEqual(rows[SERVER_HISTORY_CAP - 1])
  })

  // Story 119 D2.
  it('parseServersState keeps a valid listSort and drops a malformed one without touching the rest', () => {
    const base = {
      sources: [],
      favourites: [],
      manualServers: [],
      history: [],
      scan: DEFAULT_SERVERS_STATE.scan,
    }

    const valid = parseServersState({ ...base, listSort: { column: 'players', direction: 'desc' } })
    expect(valid.listSort).toEqual({ column: 'players', direction: 'desc' })
    expect(valid.sources).toEqual([])
    expect(valid.scan).toEqual(DEFAULT_SERVERS_STATE.scan)

    const malformedColumn = parseServersState({
      ...base,
      listSort: { column: 'nope', direction: 'desc' },
    })
    expect(malformedColumn.listSort).toBeNull()
    expect(malformedColumn.scan).toEqual(DEFAULT_SERVERS_STATE.scan)

    const malformedShape = parseServersState({ ...base, listSort: 'players-desc' })
    expect(malformedShape.listSort).toBeNull()
  })

  it('a state file without listSort parses to the default order', () => {
    const result = parseServersState({
      sources: [],
      favourites: [],
      manualServers: [],
      history: [],
      scan: DEFAULT_SERVERS_STATE.scan,
    })
    expect(result.listSort).toBeNull()

    expect(parseServersState(undefined).listSort).toBeNull()
  })
})

describe('serversState', () => {
  let filePath: string
  let state: StateStore

  beforeEach(async () => {
    filePath = join(tmpdir(), `q2-launcher-state-servers-${randomUUID()}.json`)
    state = new StateStore(filePath, { migrations: 'none' })
    await state.load()
  })

  afterEach(async () => {
    await rm(filePath, { force: true })
    await rm(`${filePath}.tmp`, { force: true })
    await rm(`${filePath}.bak`, { force: true })
  })

  it('starts with the default servers state', () => {
    expect(serversState(state).get()).toEqual(DEFAULT_SERVERS_STATE)
  })

  // Story 111 D2 (AC1): a genuinely fresh install - no state.json on disk yet, so `StateStore`
  // builds its initial value from `defaults()` (`structuredClone(DEFAULT_SERVERS_STATE)`), never
  // through `parseServersState` - must still see the shipped master/list source, not an
  // empty list. This is the one path the schema-level `.default()` in `main/modules/servers/persisted.ts` cannot
  // reach by itself, since there is no `state.json` for it to parse.
  it('a fresh install (no state.json on disk) ships the default master source', () => {
    expect(serversState(state).get().sources).toHaveLength(1)
    expect(serversState(state).get().sources).toEqual(DEFAULT_MASTER_SOURCES)
  })

  it('the servers key is its own top-level state key and LauncherSettings is untouched', () => {
    const settingsBefore = state.settings()

    // servers is a distinct top-level key with its own shape...
    expect(serversState(state).get()).toEqual(DEFAULT_SERVERS_STATE)
    expect(Object.keys(serversState(state).get()).sort()).toEqual(
      [
        'favourites',
        'history',
        'listSort',
        'manualServers',
        'quickFilters',
        'scan',
        'sources',
        'watchlist',
      ].sort(),
    )

    // ...and adding it left LauncherSettings's own shape and values untouched.
    expect(state.settings()).toEqual(settingsBefore)
    expect('servers' in state.settings()).toBe(false)
  })

  it('a set list sort reloads as set, and a cleared one reloads as null, through the real write path', async () => {
    const sort = { column: 'players', direction: 'desc' } as const
    serversState(state).update((current) => ({ ...current, listSort: sort }))
    await state.settle()
    const afterSet = new StateStore(filePath, { migrations: 'none' })
    await afterSet.load()
    expect(serversState(afterSet).get().listSort).toEqual(sort)

    serversState(afterSet).update((current) => ({ ...current, listSort: null }))
    await afterSet.settle()
    const afterClear = new StateStore(filePath, { migrations: 'none' })
    await afterClear.load()
    expect(serversState(afterClear).get().listSort).toBeNull()
  })
  it('servers state round-trips through state.json and touches no other setting', async () => {
    const settingsBefore = state.settings()
    const installationsBefore = state.installations()

    const custom: ServersState = {
      sources: [
        { id: 'src-1', type: 'udp-master', address: 'master.example.com:27900', enabled: true },
      ],
      favourites: [{ address: '1.2.3.4:27910', addedAt: '2026-01-01T00:00:00.000Z' }],
      manualServers: [
        { address: '5.6.7.8:27911', origin: 'manual', addedAt: '2026-01-02T00:00:00.000Z' },
      ],
      history: [{ address: '9.10.11.12:27912', connectedAt: '2026-01-03T00:00:00.000Z' }],
      scan: {
        concurrency: 4,
        timeoutMs: 1500,
        retries: 2,
        minSpacingMs: 15_000,
        autoScanOnOpen: true,
        autoRefreshEnabled: false,
        autoRefreshIntervalMs: 60000,
      },
      listSort: null,
      watchlist: [],
      quickFilters: [],
    }
    const written = serversState(state).update(() => custom)
    await state.settle()

    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()

    expect(serversState(reloaded).get()).toEqual(written)
    expect(serversState(reloaded).get()).toEqual(custom)
    // Other state keys are untouched by this write.
    expect(reloaded.settings()).toEqual(settingsBefore)
    expect(reloaded.installations()).toEqual(installationsBefore)
  })

  // Story 113 AC5: manual servers and history are the two collections story 113 writes, and both
  // live in story 110's `servers` state key - so the proof they survive a restart is a second,
  // independent `StateStore` over the same file reading them back unchanged, rows and order intact.
  it('manual servers and history survive a state store reload', async () => {
    const manualServers: ManualServerEntry[] = [
      { address: '1.2.3.4:27910', origin: 'manual', addedAt: '2026-01-02T00:00:00.000Z' },
      { address: 'q2.example.com:27911', origin: 'manual', addedAt: '2026-01-04T00:00:00.000Z' },
    ]
    const history: ServerHistoryEntry[] = [
      { address: '9.10.11.12:27912', connectedAt: '2026-01-05T00:00:00.000Z' },
      { address: '1.2.3.4:27910', connectedAt: '2026-01-03T00:00:00.000Z' },
    ]

    serversState(state).update((s) => ({ ...s, manualServers, history }))
    await state.settle()

    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()

    expect(serversState(reloaded).get().manualServers).toEqual(manualServers)
    expect(serversState(reloaded).get().history).toEqual(history)
    // The sibling collections in the same key came back untouched too.
    expect(serversState(reloaded).get().sources).toEqual(DEFAULT_MASTER_SOURCES)
    expect(serversState(reloaded).get().favourites).toEqual([])
  })

  it('a state.json written without the servers key loads with the shipped default (three sources, everything else empty), with no schema bump', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: STATE_SCHEMA_VERSION,
      }),
      'utf-8',
    )

    const reloaded = new StateStore(filePath, { migrations: 'none' })
    const doc = await reloaded.load()

    expect(serversState(reloaded).get()).toEqual(DEFAULT_SERVERS_STATE)
    // The file was already on the current schema version - no migration was needed or ran to
    // backfill the missing `servers` key; it degraded through the parser alone.
    expect(doc.schemaVersion).toBe(STATE_SCHEMA_VERSION)
    expect(reloaded.recoveredFrom).toBeNull()
  })

  // Story 131 D1: the persisted contract only - a matcher/service/worker come in later
  // deliverables, so these tests cover exactly what this D adds: round-trip, row-level drop of an
  // unknown mode, and a missing key defaulting to `[]`.
  it('a watchlist entry round-trips with exactly one of the three match modes', async () => {
    const watchlist: ServersState['watchlist'] = [
      { id: 'wl-exact', name: 'Player1', mode: 'exact', tooSlow: false },
      { id: 'wl-substring', name: 'Player2', mode: 'substring', tooSlow: false },
      { id: 'wl-regex', name: '^Player[0-9]+$', mode: 'regex', tooSlow: true },
    ]

    serversState(state).update((s) => ({ ...s, watchlist }))
    await state.settle()

    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()

    expect(serversState(reloaded).get().watchlist).toEqual(watchlist)
  })

  it('a watchlist row with an unknown mode is dropped on reload', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: STATE_SCHEMA_VERSION,
        servers: {
          ...DEFAULT_SERVERS_STATE,
          watchlist: [
            { id: 'wl-good', name: 'Player1', mode: 'exact', tooSlow: false },
            { id: 'wl-bad', name: 'Player2', mode: 'fuzzy', tooSlow: false },
          ],
        },
      }),
      'utf-8',
    )

    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()

    expect(serversState(reloaded).get().watchlist).toEqual([
      { id: 'wl-good', name: 'Player1', mode: 'exact', tooSlow: false },
    ])
  })

  it('a state file without a watchlist key parses to an empty list', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: STATE_SCHEMA_VERSION,
        servers: {
          sources: DEFAULT_MASTER_SOURCES,
          favourites: [],
          manualServers: [],
          history: [],
          scan: DEFAULT_SERVERS_STATE.scan,
        },
      }),
      'utf-8',
    )

    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()

    expect(serversState(reloaded).get().watchlist).toEqual([])
  })

  it('a corrupt servers value degrades without taking siblings down', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        servers: 'not-an-object',
        homeLayout: {
          tiles: [{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }],
        },
      }),
      'utf-8',
    )

    const reloaded = new StateStore(filePath, { migrations: 'none' })
    await reloaded.load()

    expect(serversState(reloaded).get()).toEqual(DEFAULT_SERVERS_STATE)
    // The sibling key survives untouched even though servers was corrupt.
    expect(homeState(reloaded).get().tiles).toEqual([
      { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
    ])
  })
})
