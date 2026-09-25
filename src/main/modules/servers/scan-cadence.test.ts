import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SERVERS_STATE,
  type ServersOverview,
  type ServersScanSettings,
  type ServersState,
} from '@shared/modules/servers'
import * as cadenceModule from './scan-cadence'
import {
  autoRefreshDelayMs,
  createScanCadence,
  decideAutoTrigger,
  type AutoTriggerInput,
  type CadenceClock,
} from './scan-cadence'
import type { TimerHandle } from './udp-master-source'

/**
 * Story 115 D3: the automatic-scan cadence. The pure decisions carry the proof burden (AC1's
 * cadence half, AC4, the minimum-spacing gate); the wrapper tests pin the timer lifetime - a timer
 * that outlives the closed view is the regression this deliverable was marked hard for.
 */

const NOW = Date.parse('2026-09-25T12:00:00.000Z')

function settings(overrides: Partial<ServersScanSettings> = {}): ServersScanSettings {
  return {
    ...DEFAULT_SERVERS_STATE.scan,
    autoScanOnOpen: true,
    autoRefreshEnabled: true,
    autoRefreshIntervalMs: 60_000,
    minSpacingMs: 30_000,
    ...overrides,
  }
}

function isoAgo(ms: number): string {
  return new Date(NOW - ms).toISOString()
}

function input(overrides: Partial<AutoTriggerInput> = {}): AutoTriggerInput {
  return {
    kind: 'refresh',
    now: NOW,
    settings: settings(),
    scanning: false,
    lastScanAt: isoAgo(10 * 60_000),
    ...overrides,
  }
}

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

/** Strips block and line comments so the literal scan below only sees code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('decideAutoTrigger / autoRefreshDelayMs (pure)', () => {
  it('every cadence decision comes from the passed settings', () => {
    // autoScanOnOpen gates the open trigger - and only it.
    expect(decideAutoTrigger(input({ kind: 'open' }))).toEqual({ trigger: true })
    expect(
      decideAutoTrigger(input({ kind: 'open', settings: settings({ autoScanOnOpen: false }) })),
    ).toEqual({ trigger: false, reason: 'disabled' })
    expect(
      decideAutoTrigger(input({ kind: 'refresh', settings: settings({ autoScanOnOpen: false }) })),
    ).toEqual({ trigger: true })

    // autoRefreshEnabled gates the refresh trigger and whether a timer exists at all.
    expect(
      decideAutoTrigger(input({ kind: 'refresh', settings: settings({ autoRefreshEnabled: false }) })),
    ).toEqual({ trigger: false, reason: 'disabled' })
    expect(
      decideAutoTrigger(input({ kind: 'open', settings: settings({ autoRefreshEnabled: false }) })),
    ).toEqual({ trigger: true })
    expect(autoRefreshDelayMs(settings({ autoRefreshEnabled: true }), true)).not.toBeNull()
    expect(autoRefreshDelayMs(settings({ autoRefreshEnabled: false }), true)).toBeNull()

    // autoRefreshIntervalMs is the timer's period, verbatim.
    expect(autoRefreshDelayMs(settings({ autoRefreshIntervalMs: 15_000 }), true)).toBe(15_000)
    expect(autoRefreshDelayMs(settings({ autoRefreshIntervalMs: 300_000 }), true)).toBe(300_000)
    // ...and only while the view is active.
    expect(autoRefreshDelayMs(settings(), false)).toBeNull()

    // minSpacingMs moves the spacing threshold: last scan 20s ago.
    const lastScanAt = isoAgo(20_000)
    expect(decideAutoTrigger(input({ lastScanAt, settings: settings({ minSpacingMs: 15_000 }) }))).toEqual({
      trigger: true,
    })
    expect(decideAutoTrigger(input({ lastScanAt, settings: settings({ minSpacingMs: 30_000 }) }))).toEqual({
      trigger: false,
      reason: 'spacing',
    })
  })

  it('scan-cadence.ts contains no numeric literal standing in for a setting', () => {
    const code = stripComments(readSource('./scan-cadence.ts'))
    // `0` is the only literal allowed (the negative-elapsed guard); anything else would be a
    // hardcoded threshold that should have come from `settings`.
    const literals = code.match(/(?<![\w.])\d[\d_]*(?:\.\d+)?(?![\w])/g) ?? []
    expect(literals.filter((literal) => literal !== '0')).toEqual([])
  })

  it('an automatic scan due while one is running is skipped, not queued', () => {
    // Old enough to pass spacing, both triggers enabled: `scanning` alone is what says no.
    const running = Object.freeze(input({ scanning: true, settings: Object.freeze(settings()) }))
    const expected = { trigger: false, reason: 'scanning' }
    expect(decideAutoTrigger(running)).toEqual(expected)
    expect(decideAutoTrigger({ ...running, kind: 'open' })).toEqual(expected)

    // Stateless: asking again with the same input answers the same, and a refusal leaves no memory
    // behind - the moment the scan is over, the very same inputs (bar `scanning`) just say yes, not
    // "yes, and here is the one you missed".
    expect(decideAutoTrigger(running)).toEqual(expected)
    expect(decideAutoTrigger({ ...running, scanning: false })).toEqual({ trigger: true })
    expect(decideAutoTrigger({ ...running, scanning: false })).toEqual({ trigger: true })
  })

  it('minimum spacing gates an automatic trigger of either kind', () => {
    const tooSoon = input({ lastScanAt: isoAgo(5_000), settings: settings({ minSpacingMs: 30_000 }) })
    expect(decideAutoTrigger({ ...tooSoon, kind: 'open' })).toEqual({ trigger: false, reason: 'spacing' })
    expect(decideAutoTrigger({ ...tooSoon, kind: 'refresh' })).toEqual({ trigger: false, reason: 'spacing' })

    // Exactly at the boundary the window is open again.
    expect(decideAutoTrigger(input({ lastScanAt: isoAgo(30_000), settings: settings({ minSpacingMs: 30_000 }) })))
      .toEqual({ trigger: true })
    // No scan ever run: always passes.
    expect(decideAutoTrigger(input({ lastScanAt: null, settings: settings({ minSpacingMs: 600_000 }) })))
      .toEqual({ trigger: true })
    // Wall clock moved backwards: real elapsed time unknowable, never starve the trigger.
    expect(decideAutoTrigger(input({ lastScanAt: isoAgo(-60_000) }))).toEqual({ trigger: true })
  })

  it('does not gate a manual trigger: nothing here is on the manual path, which stays a bare start()', () => {
    // The module offers no function a manual caller could route through - only the automatic
    // gate (whose `kind` is 'open' | 'refresh', no 'manual') and the auto-refresh period.
    expect(Object.keys(cadenceModule).sort()).toEqual([
      'autoRefreshDelayMs',
      'createScanCadence',
      'decideAutoTrigger',
      'systemCadenceClock',
    ])

    // And index.ts's `scan.start` handler calls the service directly - no cadence, no spacing.
    const indexSource = readSource('./index.ts')
    expect(indexSource).toMatch(
      /handle\(SERVERS_HANDLERS\.scanStart, scanStartInputSchema, \(payload\) =>\s*scanService\.start\(payload\?\.selectedAddress\),?\s*\)/,
    )
  })
})

interface FakeTimer {
  callback: () => void
  ms: number
}

function fakeClock(): { clock: CadenceClock; pending: Map<number, FakeTimer>; fireAll: () => void } {
  let nextId = 1
  const pending = new Map<number, FakeTimer>()
  const clock: CadenceClock = {
    setTimeout: (callback, ms) => {
      const id = nextId++
      pending.set(id, { callback, ms })
      return id as unknown as TimerHandle
    },
    clearTimeout: (handle) => {
      pending.delete(handle as unknown as number)
    },
    now: () => NOW,
  }
  const fireAll = (): void => {
    for (const [id, timer] of [...pending]) {
      pending.delete(id)
      timer.callback()
    }
  }
  return { clock, pending, fireAll }
}

function harness(scan: Partial<ServersScanSettings>, overview: Partial<ServersOverview> = {}) {
  let state: ServersState = { ...DEFAULT_SERVERS_STATE, scan: settings(scan) }
  const current: ServersOverview = { scanning: false, knownServerCount: 0, lastScanAt: null, ...overview }
  const starts: number[] = []
  const { clock, pending, fireAll } = fakeClock()
  const cadence = createScanCadence({
    getServersState: () => state,
    scanService: {
      start: () => {
        starts.push(starts.length)
        return { ok: true }
      },
      overview: () => current,
    },
    clock,
  })
  return {
    cadence,
    pending,
    fireAll,
    overview: current,
    starts,
    setScan: (patch: Partial<ServersScanSettings>) => {
      state = { ...state, scan: { ...state.scan, ...patch } }
    },
  }
}

describe('createScanCadence (timer lifetime)', () => {
  it('auto-scan-on-open starts once per view-open and arms the refresh timer with the configured period', () => {
    const h = harness({ autoScanOnOpen: true, autoRefreshEnabled: true, autoRefreshIntervalMs: 45_000 })
    h.cadence.onViewActive(true)
    expect(h.starts).toHaveLength(1)
    expect([...h.pending.values()].map((t) => t.ms)).toEqual([45_000])

    // A duplicate `true` is idempotent: no second open scan, no second timer.
    h.cadence.onViewActive(true)
    expect(h.starts).toHaveLength(1)
    expect(h.pending.size).toBe(1)
  })

  it('a view becoming inactive tears down the interval timer', () => {
    const h = harness({ autoScanOnOpen: false, autoRefreshEnabled: true })
    h.cadence.onViewActive(true)
    expect(h.pending.size).toBe(1)

    h.cadence.onViewActive(false)
    expect(h.pending.size).toBe(0)
    h.fireAll()
    expect(h.starts).toHaveLength(0)
  })

  it('dispose tears the timer down for good, even against a late view-active signal', () => {
    const h = harness({ autoScanOnOpen: true, autoRefreshEnabled: true })
    h.cadence.onViewActive(true)
    expect(h.starts).toHaveLength(1)
    h.cadence.dispose()
    expect(h.pending.size).toBe(0)

    h.cadence.onViewActive(false)
    h.cadence.onViewActive(true)
    h.cadence.onSettingsChanged()
    expect(h.pending.size).toBe(0)
    expect(h.starts).toHaveLength(1)
  })

  it('each tick starts a scan and re-arms exactly one next tick', () => {
    const h = harness({ autoScanOnOpen: false, autoRefreshEnabled: true, autoRefreshIntervalMs: 20_000 })
    h.cadence.onViewActive(true)
    h.fireAll()
    expect(h.starts).toHaveLength(1)
    expect([...h.pending.values()].map((t) => t.ms)).toEqual([20_000])
  })

  it('a tick while a scan is running is skipped, not queued', () => {
    const h = harness({ autoScanOnOpen: true, autoRefreshEnabled: true }, { scanning: true })
    h.cadence.onViewActive(true)
    h.fireAll()
    expect(h.starts).toHaveLength(0)
    // Only the next natural tick is pending - no retry timer was added for the skipped one.
    expect(h.pending.size).toBe(1)

    // The running scan finishes: nothing fires on its own until that tick does.
    h.overview.scanning = false
    expect(h.starts).toHaveLength(0)
    h.fireAll()
    expect(h.starts).toHaveLength(1)
  })

  it('a changed interval reschedules immediately; an unrelated change leaves the countdown alone', () => {
    const h = harness({ autoScanOnOpen: false, autoRefreshEnabled: true, autoRefreshIntervalMs: 60_000 })
    h.cadence.onViewActive(true)
    const [firstId] = [...h.pending.keys()]

    h.setScan({ concurrency: 16, minSpacingMs: 0 })
    h.cadence.onSettingsChanged()
    expect([...h.pending.keys()]).toEqual([firstId])

    h.setScan({ autoRefreshIntervalMs: 15_000 })
    h.cadence.onSettingsChanged()
    expect(h.pending.has(firstId)).toBe(false)
    expect([...h.pending.values()].map((t) => t.ms)).toEqual([15_000])

    h.setScan({ autoRefreshEnabled: false })
    h.cadence.onSettingsChanged()
    expect(h.pending.size).toBe(0)

    h.setScan({ autoRefreshEnabled: true })
    h.cadence.onSettingsChanged()
    expect([...h.pending.values()].map((t) => t.ms)).toEqual([15_000])
  })

  it('a settings change while the view is inactive arms nothing', () => {
    const h = harness({ autoRefreshEnabled: false })
    h.setScan({ autoRefreshEnabled: true })
    h.cadence.onSettingsChanged()
    expect(h.pending.size).toBe(0)
  })
})
