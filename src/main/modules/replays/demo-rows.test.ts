import { describe, expect, it, vi } from 'vitest'
import type { DemoSource, DiscoveredDemo } from '@shared/modules/replays'
import type { SidecarFields } from '@shared/replays/sidecar'
import { type DemoSidecarInput, buildDemoRow, composeDemoRows } from './demo-rows'

const SOURCE: DemoSource = {
  kind: 'installation',
  installationId: 'i1',
  installationName: 'Install',
  gameDir: 'baseq2',
}

function demo(overrides: Partial<DiscoveredDemo> = {}): DiscoveredDemo {
  return {
    id: '0'.repeat(16),
    fileName: 'final.dm2',
    format: 'dm2',
    gzip: false,
    source: SOURCE,
    archiveEntry: null,
    map: 'q2dm1',
    unparsableReason: null,
    readable: true,
    unreadable: null,
    gameDir: 'baseq2',
    pov: 'Recorder',
    players: ['Alice', 'Bob'],
    durationMs: 60000,
    roster: null,
    fileTime: { birthtimeMs: 1000, mtimeMs: 2000 },
    folder: [],
    nameFacts: null,
    ...overrides,
  }
}

function sidecar(values: Partial<SidecarFields>, state: 'ok' | 'error' = 'ok'): DemoSidecarInput {
  return state === 'ok'
    ? { state: { state: 'ok' }, values }
    : { state: { state: 'error', issues: [] }, values }
}

describe('buildDemoRow', () => {
  it('a sidecar name, favourite and rating win over the file name', () => {
    const row = buildDemoRow(demo(), sidecar({ name: 'Grand final', favourite: true, rating: 9 }))

    expect(row.effective.name).toEqual({ value: 'Grand final', source: 'sidecar' })
    expect(row.sidecar).toEqual({
      state: 'ok',
      values: { name: 'Grand final', favourite: true, rating: 9 },
    })
  })

  it('a header-only row resolves map, mod, sides and a guessed gamemode from the demo', () => {
    const row = buildDemoRow(demo(), null)

    expect(row.effective.map).toEqual({ value: 'q2dm1', source: 'demo' })
    expect(row.effective.mod).toEqual({ value: 'baseq2', source: 'demo' })
    expect(row.effective.sides).toEqual({
      value: [{ players: ['Alice', 'Bob'] }],
      source: 'demo',
    })
    expect(row.effective.gamemode.source).not.toBeNull()
  })

  it('an unreadable row with no sidecar resolves name and file-time date only', () => {
    const row = buildDemoRow(
      demo({
        readable: false,
        unparsableReason: 'truncated',
        map: null,
        gameDir: null,
        pov: null,
        players: [],
      }),
      null,
    )

    expect(row.effective.name).toEqual({ value: 'final.dm2', source: 'name' })
    expect(row.effective.date).toEqual({ value: 1000, source: 'file' })
    expect(row.effective.map).toEqual({ value: null, source: null })
    expect(row.effective.mod).toEqual({ value: null, source: null })
    expect(row.effective.sides).toEqual({ value: null, source: null })
  })

  it('an error sidecar keeps its valid values and reports state error', () => {
    const row = buildDemoRow(demo(), sidecar({ map: 'q2dm3' }, 'error'))

    expect(row.sidecar.state).toBe('error')
    expect(row.effective.map).toEqual({ value: 'q2dm3', source: 'sidecar' })
  })

  it('an archive entry has sidecar state none', () => {
    const row = buildDemoRow(
      demo({ archiveEntry: { archivePath: 'C:/demos/pack.zip', entryPath: 'final.dm2' } }),
      null,
    )

    expect(row.sidecar).toEqual({ state: 'none', values: {} })
  })

  it('never throws on a malformed sidecar input', () => {
    expect(() => buildDemoRow(demo(), null)).not.toThrow()
  })
})

describe('composeDemoRows', () => {
  it('3000 demos compose with at most 16 sidecar reads in flight', async () => {
    const demos = Array.from({ length: 3000 }, (_, i) =>
      demo({ id: i.toString(16).padStart(16, '0'), fileName: `demo-${i}.dm2` }),
    )

    let inFlight = 0
    let maxInFlight = 0
    const readSidecar = vi.fn(async (): Promise<DemoSidecarInput> => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight--
      return null
    })

    const rows = await composeDemoRows(demos, readSidecar, 16)

    expect(rows).toHaveLength(3000)
    expect(readSidecar).toHaveBeenCalledTimes(3000)
    expect(maxInFlight).toBeLessThanOrEqual(16)
    expect(rows.map((r) => r.id)).toEqual(demos.map((d) => d.id))
  })
})
