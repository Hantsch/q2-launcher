import { describe, expect, it } from 'vitest'

import type { DemoRow } from '../modules/replays'
import type { Dm2Header } from '../demos/dm2-header'
import { resolveEffectiveValues } from '../demos/effective-values'
import { buildDemoDetail } from './demo-detail'

function header(overrides: Partial<Dm2Header> = {}): Dm2Header {
  return {
    ok: true,
    protocol: 34,
    layout: 'original',
    gameDir: 'baseq2',
    levelName: 'The Edge',
    map: 'q2dm1',
    pov: 'Ranger',
    players: ['Ranger', 'Reaper'],
    largestBlockBytes: 100,
    bytesConsumed: 100,
    ...overrides,
  }
}

function baseRow(overrides: Partial<DemoRow> = {}): DemoRow {
  const nameFacts = overrides.nameFacts ?? {
    map: 'q2dm3',
    pov: 'Slayer',
    players: ['Alice', 'Bob'],
    host: 'q2dm3-host',
  }

  const sidecarValues = overrides.sidecar?.values ?? {}

  const effective = resolveEffectiveValues({
    fileName: overrides.fileName ?? 'final.dm2',
    sidecar: sidecarValues,
    header: header(),
    nameFacts,
    fileTime: { birthtimeMs: 1_000, mtimeMs: 2_000 },
  })

  return {
    id: 'abc0123456789def',
    fileName: 'final.dm2',
    format: 'dm2',
    gzip: false,
    source: { kind: 'installation', installationId: 'inst-1', installationName: 'Main', gameDir: 'baseq2' },
    archiveEntry: null,
    map: 'q2dm1',
    unparsableReason: null,
    readable: true,
    unreadable: null,
    gameDir: 'baseq2',
    pov: 'Ranger',
    players: ['Ranger', 'Reaper'],
    durationMs: 12_345,
    fileTime: { birthtimeMs: 1_000, mtimeMs: 2_000 },
    nameFacts,
    sidecar: { state: 'ok', values: sidecarValues },
    effective,
    ...overrides,
  }
}

describe('buildDemoDetail', () => {
  it('the detail lists every effective value with its source', () => {
    const row = baseRow({
      sidecar: { state: 'ok', values: { name: 'Grudge match', tags: ['clan-war'], favourite: true, rating: 8 } },
    })

    const detail = buildDemoDetail(row, row.sidecar.values)

    const byId = new Map(detail.fields.map((f) => [f.id, f]))

    expect(byId.get('name')).toEqual({ id: 'name', value: 'Grudge match', source: 'sidecar' })
    expect(byId.get('map')).toEqual({ id: 'map', value: 'q2dm1', source: 'demo' })
    expect(byId.get('mod')).toEqual({ id: 'mod', value: 'baseq2', source: 'demo' })
    expect(byId.get('pov')).toEqual({ id: 'pov', value: 'Ranger', source: 'demo' })
    expect(byId.get('sides')).toEqual({
      id: 'sides',
      value: [{ players: ['Ranger', 'Reaper'] }],
      source: 'demo',
    })
    expect(byId.get('host')).toEqual({ id: 'host', value: 'q2dm3-host', source: 'name' })
    expect(byId.get('tags')).toEqual({ id: 'tags', value: ['clan-war'], source: 'sidecar' })
    expect(byId.get('favourite')).toEqual({ id: 'favourite', value: true, source: 'sidecar' })
    expect(byId.get('rating')).toEqual({ id: 'rating', value: 8, source: 'sidecar' })
    expect(byId.get('fileName')).toEqual({ id: 'fileName', value: 'final.dm2', source: null })
    expect(byId.get('format')).toEqual({ id: 'format', value: 'dm2', source: null })
    expect(byId.get('duration')).toEqual({ id: 'duration', value: 12_345, source: null })
    expect(byId.get('source')).toEqual({
      id: 'source',
      value: 'installation:inst-1:baseq2',
      source: null,
    })

    // no description was ever set - absent entirely.
    expect(byId.has('description')).toBe(false)
    // levelName has no home on DemoRow at all - never present.
    expect(byId.has('levelName')).toBe(false)
  })

  it('known players come from the demo and the file name, not the sidecar', () => {
    const row = baseRow({
      players: ['Ranger', 'Reaper', ' ', 'Ranger'],
      nameFacts: {
        map: 'q2dm3',
        pov: 'Slayer',
        players: ['Alice', '', 'Bob', 'Alice'],
        host: 'q2dm3-host',
      },
      sidecar: {
        state: 'ok',
        values: { sides: [{ team: 'Red', players: ['Someone Else'] }] },
      },
    })
    // Re-resolve effective values so the sidecar's `sides` override actually wins, matching what
    // `buildDemoRow` would have done for this sidecar.
    const rowWithOverride: DemoRow = {
      ...row,
      effective: resolveEffectiveValues({
        fileName: row.fileName,
        sidecar: row.sidecar.values,
        header: header({ players: row.players }),
        nameFacts: row.nameFacts,
        fileTime: row.fileTime,
      }),
    }

    const detail = buildDemoDetail(rowWithOverride, rowWithOverride.sidecar.values)

    // The effective `sides` field reflects the sidecar override.
    const sidesField = detail.fields.find((f) => f.id === 'sides')
    expect(sidesField).toEqual({
      id: 'sides',
      value: [{ team: 'Red', players: ['Someone Else'] }],
      source: 'sidecar',
    })

    // But knownPlayers stays the row's own header/name-fact data, cleaned up.
    expect(detail.knownPlayers).toEqual({
      demo: ['Ranger', 'Reaper'],
      name: ['Alice', 'Bob'],
    })
  })

  it('carries the row sidecar state through as sidecarIssues', () => {
    const row = baseRow({ sidecar: { state: 'error', values: {} } })
    const detail = buildDemoDetail(row, row.sidecar.values)
    expect(detail.sidecarIssues).toEqual({ state: 'error' })
  })
})
