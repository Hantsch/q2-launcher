import { describe, expect, it } from 'vitest'
import {
  parseDownloadFailures,
  parseDownloadsSettings,
  parseHomeLayout,
  parseInstallation,
  parseReplaysState,
  parseServersState,
} from './schemas'
import { DEFAULT_DOWNLOADS_SETTINGS } from '@shared/modules/downloads'
import type { DownloadDiagnostics } from '@shared/modules/downloads'
import { DEFAULT_HOME_LAYOUT } from '@shared/modules/home'
import { EMPTY_DEMO_LIST_FILTER } from '@shared/replays/list-filter'
import {
  DEFAULT_MASTER_SOURCES,
  DEFAULT_SERVERS_STATE,
  SERVER_HISTORY_CAP,
} from '@shared/modules/servers'

/**
 * Story 071 D1: the persisted `downloads` top-level `state.json` key. Mirrors
 * `parseConfigProfiles`'s "forgiving, never throws" contract - a corrupt value falls back to
 * `DEFAULT_DOWNLOADS_SETTINGS` instead of throwing.
 */
describe('parseDownloadsSettings (story 071 D1)', () => {
  it('loads defaults when the key is absent', () => {
    expect(parseDownloadsSettings(undefined)).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
  })

  it('round-trips a valid, in-range concurrentJobs', () => {
    // Story 072 D2: the two sibling fields are absent from the input, so they fall back to their
    // own defaults independently of concurrentJobs - same "one bad/missing field costs only that
    // field" shape as the rest of this schema.
    expect(parseDownloadsSettings({ concurrentJobs: 4 })).toEqual({
      ...DEFAULT_DOWNLOADS_SETTINGS,
      concurrentJobs: 4,
    })
  })

  it('falls back to the default instead of throwing when concurrentJobs is not a number', () => {
    expect(() => parseDownloadsSettings({ concurrentJobs: 'nope' })).not.toThrow()
    expect(parseDownloadsSettings({ concurrentJobs: 'nope' })).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
  })

  it('falls back to the default instead of throwing when concurrentJobs is out of range', () => {
    expect(parseDownloadsSettings({ concurrentJobs: 99 })).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
    expect(parseDownloadsSettings({ concurrentJobs: 0 })).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
  })

  it('falls back to the default instead of throwing when the whole downloads value is corrupt', () => {
    expect(() => parseDownloadsSettings('not an object')).not.toThrow()
    expect(parseDownloadsSettings('not an object')).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
    expect(parseDownloadsSettings(null)).toEqual(DEFAULT_DOWNLOADS_SETTINGS)
  })

  // Story 072 D2
  it('round-trips a valid archiveCacheBudgetGB and downloadWhilePlayingAllowed', () => {
    expect(
      parseDownloadsSettings({
        concurrentJobs: 2,
        archiveCacheBudgetGB: 10,
        downloadWhilePlayingAllowed: false,
      }),
    ).toEqual({ concurrentJobs: 2, archiveCacheBudgetGB: 10, downloadWhilePlayingAllowed: false })
  })

  it('falls back to the default when archiveCacheBudgetGB is not one of the allowed choices', () => {
    expect(parseDownloadsSettings({ concurrentJobs: 2, archiveCacheBudgetGB: 999 })).toEqual({
      ...DEFAULT_DOWNLOADS_SETTINGS,
      concurrentJobs: 2,
    })
  })

  it('falls back to the default when downloadWhilePlayingAllowed is not a boolean', () => {
    expect(
      parseDownloadsSettings({ concurrentJobs: 2, downloadWhilePlayingAllowed: 'yes' }),
    ).toEqual({ ...DEFAULT_DOWNLOADS_SETTINGS, concurrentJobs: 2 })
  })
})

// Story 086 D1 (AC10/AC11).
describe('parseHomeLayout (story 086 D1)', () => {
  it('a record for an unknown module id is dropped', () => {
    const layout = parseHomeLayout({
      tiles: [
        { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
        { moduleId: 'nope', x: 6, y: 0, w: 6, h: 5 },
      ],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
  })

  it('a module missing from the layout is not inserted', () => {
    const layout = parseHomeLayout({
      tiles: [{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
    expect(layout.tiles).toHaveLength(1)
  })

  it('garbage input falls back to the default layout', () => {
    expect(parseHomeLayout(undefined)).toEqual(DEFAULT_HOME_LAYOUT)
    expect(parseHomeLayout(null)).toEqual(DEFAULT_HOME_LAYOUT)
    expect(parseHomeLayout('not an object')).toEqual(DEFAULT_HOME_LAYOUT)
    expect(parseHomeLayout({ tiles: 'not an array' })).toEqual(DEFAULT_HOME_LAYOUT)
  })

  it('drops a tile row missing a required coordinate', () => {
    const layout = parseHomeLayout({
      tiles: [
        { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
        { moduleId: 'configProfiles', x: 6, y: 0, w: 6 }, // missing h
      ],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
  })

  // Review fix (code review of story 086): a non-integer coordinate is as malformed as a missing
  // one, and is dropped the same way.
  it('drops a tile row with a non-integer coordinate', () => {
    const layout = parseHomeLayout({
      tiles: [
        { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
        { moduleId: 'configProfiles', x: 2.5, y: 0, w: 6, h: 5 },
      ],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
  })

  // Review fix (code review of story 086): a negative coordinate is as malformed as a missing one,
  // and is dropped the same way.
  it('drops a tile row with a negative coordinate', () => {
    const layout = parseHomeLayout({
      tiles: [
        { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
        { moduleId: 'configProfiles', x: 6, y: -1, w: 6, h: 5 },
      ],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
  })

  // Review fix (code review of story 086): two rows naming the same moduleId would otherwise
  // produce duplicate React keys in DashboardGrid/DashboardTile's `.map()`. Only the first
  // occurrence is kept.
  it('drops a later row that repeats a moduleId already seen, keeping the first', () => {
    const layout = parseHomeLayout({
      tiles: [
        { moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 },
        { moduleId: 'playtime', x: 6, y: 0, w: 6, h: 5 },
      ],
    })
    expect(layout.tiles).toEqual([{ moduleId: 'playtime', x: 0, y: 0, w: 6, h: 5 }])
  })
})

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
    expect(malformedColumn.listSort).toBeUndefined()
    expect(malformedColumn.scan).toEqual(DEFAULT_SERVERS_STATE.scan)

    const malformedShape = parseServersState({ ...base, listSort: 'players-desc' })
    expect(malformedShape.listSort).toBeUndefined()
  })

  it('a state file without listSort parses to the default order', () => {
    const result = parseServersState({
      sources: [],
      favourites: [],
      manualServers: [],
      history: [],
      scan: DEFAULT_SERVERS_STATE.scan,
    })
    expect(result.listSort).toBeUndefined()

    expect(parseServersState(undefined).listSort).toBeUndefined()
  })
})

// Story 075 D1 (AC6).
describe('parseDownloadFailures - diagnostics (story 075 D1)', () => {
  const baseRow = {
    id: 'f1',
    jobId: 'job-1',
    labelKey: 'downloads.job.engine',
    error: { key: 'downloads.error.network' },
    createdAt: 1000,
  }

  const diagnostics: DownloadDiagnostics = {
    jobId: 'job-1',
    kind: 'bootstrap',
    startedAt: '2026-01-08T00:00:00.000Z',
    finishedAt: '2026-01-08T00:01:00.000Z',
    errorKey: 'downloads.error.installationNotPlayable',
    packages: [
      {
        id: 'demo',
        url: 'https://example.test/demo.zip',
        sizeBytes: 42,
        verified: true,
        extracted: false,
      },
    ],
    target: {
      targetPath: 'C:\\%HOME%\\Games\\Quake2',
      verdict: 'invalid',
      missingChecks: [{ id: 'base-paks', messageKey: 'installation.check.basePaks' }],
    },
    logTail: ['line 1', 'line 2'],
  }

  it('an entry without diagnostics parses unchanged (pre-story row)', () => {
    const [parsed] = parseDownloadFailures([baseRow])

    expect(parsed).toEqual(baseRow)
    expect(parsed?.diagnostics).toBeUndefined()
  })

  it('round-trips a well-formed diagnostics record', () => {
    const [parsed] = parseDownloadFailures([{ ...baseRow, diagnostics }])

    expect(parsed?.diagnostics).toEqual(diagnostics)
  })

  it('a garbage diagnostics value drops only that field, not the row', () => {
    const [parsed] = parseDownloadFailures([{ ...baseRow, diagnostics: 'not an object' }])

    expect(parsed).toBeDefined()
    expect(parsed?.id).toBe('f1')
    expect(parsed?.diagnostics).toBeUndefined()
  })

  it('a diagnostics record missing a required field drops only that field, not the row', () => {
    const { jobId: _jobId, ...malformedDiagnostics } = diagnostics
    const [parsed] = parseDownloadFailures([{ ...baseRow, diagnostics: malformedDiagnostics }])

    expect(parsed).toBeDefined()
    expect(parsed?.id).toBe('f1')
    expect(parsed?.diagnostics).toBeUndefined()
  })

  // Story 078 D1 (AC6): a 075-era record has no `assembly` and no per-package `contents` /
  // `contentsTruncated` / `contributed` fields - it must still parse to the same shape.
  it('a 075-era diagnostics record parses unchanged', () => {
    const [parsed] = parseDownloadFailures([{ ...baseRow, diagnostics }])

    expect(parsed?.diagnostics).toEqual(diagnostics)
    expect(parsed?.diagnostics?.assembly).toBeUndefined()
    expect(parsed?.diagnostics?.packages[0]?.contents).toBeUndefined()
    expect(parsed?.diagnostics?.packages[0]?.contentsTruncated).toBeUndefined()
    expect(parsed?.diagnostics?.packages[0]?.contributed).toBeUndefined()
  })

  // Story 078 D1 (AC6/AC9): a garbage `assembly` or per-package `contents` value drops only that
  // field, via `.catch(undefined)`, not the whole record.
  it('a garbage assembly value drops only that field, not the record', () => {
    const [parsed] = parseDownloadFailures([
      { ...baseRow, diagnostics: { ...diagnostics, assembly: 'not an array' } },
    ])

    expect(parsed?.diagnostics).toBeDefined()
    expect(parsed?.diagnostics?.jobId).toBe('job-1')
    expect(parsed?.diagnostics?.assembly).toBeUndefined()
  })

  it('a garbage per-package contents value drops only that field, not the record', () => {
    const [parsed] = parseDownloadFailures([
      {
        ...baseRow,
        diagnostics: {
          ...diagnostics,
          packages: [{ ...diagnostics.packages[0], contents: 'not an array' }],
        },
      },
    ])

    expect(parsed?.diagnostics).toBeDefined()
    expect(parsed?.diagnostics?.packages).toHaveLength(1)
    expect(parsed?.diagnostics?.packages[0]?.contents).toBeUndefined()
  })

  it('round-trips a record carrying assembly and per-package contents', () => {
    const withNewRecords: DownloadDiagnostics = {
      ...diagnostics,
      packages: [
        {
          ...diagnostics.packages[0]!,
          contents: ['pak0.pak', 'players'],
          contentsTruncated: false,
          contributed: true,
        },
      ],
      assembly: [
        { from: 'base/pak0.pak', to: 'base/pak0.pak', found: true, sourcePackageId: 'demo' },
      ],
    }
    const [parsed] = parseDownloadFailures([{ ...baseRow, diagnostics: withNewRecords }])

    expect(parsed?.diagnostics).toEqual(withNewRecords)
  })
})

/**
 * Story 077 D1: `installationSchema`'s `lastFailure` field - additive and forgiving in exactly the
 * shape `icon` already gets right above it in `./schemas.ts`.
 */
describe('installationSchema - lastFailure (story 077 D1)', () => {
  const baseRow = {
    id: 'install-1',
    rootPath: 'C:\\Games\\Quake2',
    name: 'Quake II',
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'invalid',
    checks: [],
    gameDirs: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
  }

  const lastFailure = { errorKey: 'downloads.error.network', at: 1234567890, jobId: 'job-1' }

  it('AC1 (partial): an installation with a lastFailure round-trips through state.json', () => {
    const raw = { ...baseRow, lastFailure }
    // "Through state.json" for this schema is parse -> serialize -> parse again, since
    // `parseInstallation` is exactly what reads a row back out of the file.
    const parsedOnce = parseInstallation(raw)
    const parsedTwice = parseInstallation(JSON.parse(JSON.stringify(parsedOnce)))

    expect(parsedOnce?.lastFailure).toEqual(lastFailure)
    expect(parsedTwice).toEqual(parsedOnce)
  })

  it('AC8: an installation written before this story parses unchanged', () => {
    // No `lastFailure` key at all - the pre-077 shape.
    const parsed = parseInstallation(baseRow)

    expect(parsed).not.toBeNull()
    expect(parsed?.lastFailure).toBeUndefined()
    expect(parsed?.id).toBe('install-1')
    expect(parsed?.rootPath).toBe('C:\\Games\\Quake2')
  })

  it('AC8: a garbage lastFailure drops the field, not the row', () => {
    const parsed = parseInstallation({ ...baseRow, lastFailure: 'not an object' })

    expect(parsed).not.toBeNull()
    expect(parsed?.id).toBe('install-1')
    expect(parsed?.lastFailure).toBeUndefined()
  })

  it('a lastFailure missing a required member drops the field, not the row', () => {
    const { jobId: _jobId, ...malformed } = lastFailure
    const parsed = parseInstallation({ ...baseRow, lastFailure: malformed })

    expect(parsed).not.toBeNull()
    expect(parsed?.id).toBe('install-1')
    expect(parsed?.lastFailure).toBeUndefined()
  })

  it('a templated lastFailure carries its params through unchanged', () => {
    const withParams = { ...lastFailure, params: { packageId: 'q2-314-demo-x86.exe' } }
    const parsed = parseInstallation({ ...baseRow, lastFailure: withParams })

    expect(parsed?.lastFailure).toEqual(withParams)
  })

  it('a garbage params drops only params, not the rest of lastFailure (one level more forgiving)', () => {
    const parsed = parseInstallation({
      ...baseRow,
      lastFailure: { ...lastFailure, params: 'nope' },
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.lastFailure).toEqual(lastFailure)
    expect(parsed?.lastFailure?.params).toBeUndefined()
  })
})

/**
 * Regression for a one-line fix to `checkSchema`'s `severity` enum: it was missing `'info'` (the
 * real `CheckSeverity` union, `@shared/types/installation`, is
 * `'ok' | 'info' | 'warn' | 'error'`), which meant an installation whose only `checks` entry was
 * info-severity - exactly `validation.pak0NotRetail`, the demo-data marker
 * `src/main/modules/installations/inspector.ts` emits - had its entire `checks` array silently
 * wiped to `[]` by `checks: z.array(checkSchema).catch([])` on load.
 */
describe('installationSchema - checks severity: info (regression)', () => {
  const baseRow = {
    id: 'install-1',
    rootPath: 'C:\\Games\\Quake2',
    name: 'Quake II',
    engineKind: 'r1q2',
    launchArgs: [],
    activeGameDir: '',
    source: 'manual',
    status: 'ok',
    gameDirs: [],
    favorite: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    totalPlaytimeSeconds: 0,
  }

  it('keeps an info-severity check rather than dropping the whole checks array', () => {
    const infoCheck = { id: 'base-paks', severity: 'info', messageKey: 'validation.pak0NotRetail' }
    const parsed = parseInstallation({ ...baseRow, checks: [infoCheck] })

    expect(parsed).not.toBeNull()
    expect(parsed?.checks).toEqual([infoCheck])
  })
})

/**
 * Story 140 D2: `parseReplaysState`'s forgiving parse of the `replays` state key - mirrors
 * `parseServersState`'s envelope/row-level-drop convention (see that describe block above).
 */
describe('parseReplaysState (story 140 D2)', () => {
  it('a missing `replays` key yields the default, empty name-templates state', () => {
    const result = parseReplaysState(undefined)
    expect(result).toEqual({
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
      listFilter: EMPTY_DEMO_LIST_FILTER,
      modWarning: { enabled: true, trustedMods: [] },
    })
  })

  it('modWarning loads forgivingly and round-trips', () => {
    expect(parseReplaysState({}).modWarning).toEqual({ enabled: true, trustedMods: [] })
    expect(
      parseReplaysState({ modWarning: { enabled: 'no', trustedMods: 'x' } }).modWarning,
    ).toEqual({
      enabled: true,
      trustedMods: [],
    })
    const messy = parseReplaysState({
      modWarning: { enabled: false, trustedMods: ['OpenTDM', 'opentdm', 5, '../x', '', 'ctf'] },
    })
    expect(messy.modWarning).toEqual({ enabled: false, trustedMods: ['opentdm', 'ctf'] })
    expect(parseReplaysState(JSON.parse(JSON.stringify(messy)))).toEqual(messy)
  })

  it('a corrupt replays nameTemplates row is dropped, not the list', () => {
    const validUser = { id: 'u1', kind: 'user', template: '{map}_{date}' }
    const validShipped = { id: 's1', kind: 'shipped', shippedId: 'opentdm', template: null }
    const malformedShape = { id: 'bad-shape', kind: 'user' } // missing `template`
    const malformedText = { id: 'bad-text', kind: 'user', template: '{map}/{date}' } // path separator
    const unknownKind = { id: 'bad-kind', kind: 'mystery', template: 'x' }

    const result = parseReplaysState({
      nameTemplates: {
        entries: [validUser, validShipped, malformedShape, malformedText, unknownKind],
        removedShippedIds: [],
      },
    })

    expect(result.nameTemplates.entries).toEqual([validUser, validShipped])
  })

  it('an invalid envelope (not an object) falls back to the default state wholesale', () => {
    const result = parseReplaysState({ nameTemplates: 'not an object' })
    expect(result.nameTemplates).toEqual({ entries: [], removedShippedIds: [] })
  })

  it('duplicate entry ids are deduped, first occurrence wins', () => {
    const first = { id: 'dup', kind: 'user', template: '{map}' }
    const second = { id: 'dup', kind: 'user', template: '{host}' }

    const result = parseReplaysState({
      nameTemplates: { entries: [first, second], removedShippedIds: [] },
    })

    expect(result.nameTemplates.entries).toEqual([first])
  })

  it('a shipped entry whose override text is malformed is dropped', () => {
    const badOverride = {
      id: 's1',
      kind: 'shipped',
      shippedId: 'opentdm',
      template: '{map}\\{date}',
    }
    const result = parseReplaysState({
      nameTemplates: { entries: [badOverride], removedShippedIds: [] },
    })
    expect(result.nameTemplates.entries).toEqual([])
  })

  it('a foreign replays value falls back to the default replays state', () => {
    const result = parseReplaysState('not even an object')
    expect(result).toEqual({
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
      listFilter: EMPTY_DEMO_LIST_FILTER,
      modWarning: { enabled: true, trustedMods: [] },
    })
  })

  it('a malformed extra folder row is dropped, its siblings survive', () => {
    const good = { id: 'f1', path: 'C:\\Demos\\Extra', addedAt: '2026-01-01T00:00:00.000Z' }
    const emptyPath = { id: 'f2', path: '', addedAt: '2026-01-01T00:00:00.000Z' }
    const missingField = { id: 'f3', path: 'C:\\Demos\\Other' }

    const result = parseReplaysState({
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [good, emptyPath, missingField],
    })

    expect(result.extraFolders).toEqual([good])
  })

  // Story 152 D2.
  it('parseReplaysState keeps a valid listSort and drops a malformed one', () => {
    const base = {
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
    }

    const valid = parseReplaysState({ ...base, listSort: { column: 'players', direction: 'desc' } })
    expect(valid.listSort).toEqual({ column: 'players', direction: 'desc' })
    expect(valid.nameTemplates).toEqual(base.nameTemplates)
    expect(valid.extraFolders).toEqual([])

    const malformedColumn = parseReplaysState({
      ...base,
      listSort: { column: 'nope', direction: 'desc' },
    })
    expect(malformedColumn.listSort).toBeUndefined()
    expect(malformedColumn.nameTemplates).toEqual(base.nameTemplates)

    const malformedShape = parseReplaysState({ ...base, listSort: 'players-desc' })
    expect(malformedShape.listSort).toBeUndefined()

    const missingDirection = parseReplaysState({
      ...base,
      listSort: { column: 'players' },
    })
    expect(missingDirection.listSort).toBeUndefined()

    expect(parseReplaysState(undefined).listSort).toBeUndefined()
  })

  // Story 153 D3.
  it('the demo list filter round-trips through state.json', () => {
    const base = {
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
    }

    const filter = {
      ...EMPTY_DEMO_LIST_FILTER,
      search: 'frag',
      favouritesOnly: true,
      tags: ['clutch'],
    }
    const result = parseReplaysState({ ...base, listFilter: filter })

    expect(result.listFilter).toEqual(filter)
    expect(result.nameTemplates).toEqual(base.nameTemplates)
    expect(result.extraFolders).toEqual([])
  })

  // Story 153 D3.
  it('an invalid stored filter degrades to the empty filter', () => {
    const base = {
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
    }

    const malformedShape = parseReplaysState({ ...base, listFilter: 'frag' })
    expect(malformedShape.listFilter).toEqual(EMPTY_DEMO_LIST_FILTER)
    expect(malformedShape.nameTemplates).toEqual(base.nameTemplates)

    const malformedField = parseReplaysState({
      ...base,
      listFilter: { ...EMPTY_DEMO_LIST_FILTER, minRating: 99 },
    })
    expect(malformedField.listFilter).toEqual(EMPTY_DEMO_LIST_FILTER)

    const unknownKey = parseReplaysState({
      ...base,
      listFilter: { ...EMPTY_DEMO_LIST_FILTER, bogus: true },
    })
    expect(unknownKey.listFilter).toEqual(EMPTY_DEMO_LIST_FILTER)

    expect(parseReplaysState(undefined).listFilter).toEqual(EMPTY_DEMO_LIST_FILTER)
  })

  // Story 154 D2.
  it('a stored date filter with from after to parses to no date filter, the other filters survive', () => {
    const base = {
      nameTemplates: { entries: [], removedShippedIds: [] },
      extraFolders: [],
    }

    const stored = {
      ...EMPTY_DEMO_LIST_FILTER,
      mod: 'ctf',
      tags: ['clutch'],
      date: { kind: 'custom', from: '2026-01-12', to: '2026-01-05' },
    }
    const result = parseReplaysState({ ...base, listFilter: stored })

    expect(result.listFilter.date).toBeNull()
    expect(result.listFilter.mod).toEqual('ctf')
    expect(result.listFilter.tags).toEqual(['clutch'])
  })
})
