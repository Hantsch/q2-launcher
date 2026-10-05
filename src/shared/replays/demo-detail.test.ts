import { describe, expect, it } from 'vitest'

import type { DemoRow } from '../modules/replays'
import type { SidecarFields } from './sidecar'
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
    source: {
      kind: 'installation',
      installationId: 'inst-1',
      installationName: 'Main',
      gameDir: 'baseq2',
    },
    archiveEntry: null,
    map: 'q2dm1',
    unparsableReason: null,
    readable: true,
    unreadable: null,
    gameDir: 'baseq2',
    pov: 'Ranger',
    players: ['Ranger', 'Reaper'],
    durationMs: 12_345,
    roster: null,
    fileTime: { birthtimeMs: 1_000, mtimeMs: 2_000 },
    nameFacts,
    sidecar: { state: 'ok', values: sidecarValues },
    effective,
    ...overrides,
  }
}

describe('buildDemoDetail', () => {
  it('the detail lists the file facts, then the match facts, in order', () => {
    const row = baseRow()
    const detail = buildDemoDetail(row, row.sidecar.values)

    expect(detail.fields.map((f) => [f.id, f.group])).toEqual([
      ['fileName', 'file'],
      ['duration', 'file'],
      ['date', 'file'],
      ['map', 'match'],
      ['mod', 'match'],
      ['gamemode', 'match'],
      ['sides', 'match'],
      ['pov', 'match'],
    ])

    const byId = new Map(detail.fields.map((f) => [f.id, f]))
    expect(byId.get('fileName')).toMatchObject({ value: 'final.dm2', source: null })
    expect(byId.get('duration')).toMatchObject({ value: 12_345, source: null })
    expect(byId.get('map')).toMatchObject({ value: 'q2dm1', source: 'demo' })

    const ids: string[] = detail.fields.map((f) => f.id)
    for (const removed of [
      'name',
      'host',
      'format',
      'source',
      'levelName',
      'description',
      'tags',
      'favourite',
      'rating',
    ]) {
      expect(ids).not.toContain(removed)
    }
  })

  it('a fact with no value anywhere is omitted', () => {
    const row = baseRow({
      durationMs: undefined,
      pov: null,
      nameFacts: { map: 'q2dm3', players: [] },
    })
    const detail = buildDemoDetail(
      { ...row, effective: { ...row.effective, pov: { value: null, source: null } } },
      {},
    )
    const ids = detail.fields.map((f) => f.id)
    expect(ids).not.toContain('pov')
    expect(ids).not.toContain('duration')
    expect(ids).toContain('fileName')
    for (const f of detail.fields) expect(f.value).not.toBe('')
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
      group: 'match',
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

  describe('player groups', () => {
    const roster = {
      teams: [
        { name: 'Home', players: ['Ranger', 'Reaper'] },
        { name: 'Away', players: ['Zed'] },
      ],
      spectators: ['Watcher'],
    }

    function rosterRow(sidecar: Partial<SidecarFields> = {}, pov = 'Ranger'): DemoRow {
      const sidecarValues = sidecar
      return baseRow({
        roster,
        sidecar: { state: 'ok', values: sidecarValues },
        effective: resolveEffectiveValues({
          fileName: 'final.dm2',
          sidecar: sidecarValues,
          header: { ...header({ pov }), roster },
          nameFacts: null,
          fileTime: { birthtimeMs: 1_000, mtimeMs: 2_000 },
        }),
      })
    }

    it('a roster demo is grouped by team with its spectators apart', () => {
      const row = rosterRow()
      const { playerGroups } = buildDemoDetail(row, row.sidecar.values)
      expect(playerGroups.groups).toEqual([
        {
          heading: { team: 'Home', index: 1 },
          players: [
            { name: 'Ranger', pov: true },
            { name: 'Reaper', pov: false },
          ],
        },
        { heading: { team: 'Away', index: 2 }, players: [{ name: 'Zed', pov: false }] },
      ])
      expect(playerGroups.spectators).toEqual([{ name: 'Watcher', pov: false }])
    })

    it('a demo without a roster lists its players ungrouped', () => {
      const row = baseRow()
      const { playerGroups } = buildDemoDetail(row, row.sidecar.values)
      expect(playerGroups.groups).toHaveLength(1)
      expect(playerGroups.groups[0]?.heading).toBeNull()
      expect(playerGroups.spectators).toEqual([])
    })

    it('an unnamed side among several is headed by its number', () => {
      const row = rosterRow({
        sides: [{ team: 'Red', result: 'win', players: ['Zed'] }, { players: ['Ranger'] }],
      })
      const { playerGroups } = buildDemoDetail(row, row.sidecar.values)
      expect(playerGroups.groups.map((g) => g.heading)).toEqual([
        { team: 'Red', result: 'win', index: 1 },
        { index: 2 },
      ])
    })

    it('sidecar sides override the roster but spectators already shown are not repeated', () => {
      const row = rosterRow({ sides: [{ team: 'Red', players: ['Zed', 'Watcher'] }] })
      const { playerGroups } = buildDemoDetail(row, row.sidecar.values)
      expect(playerGroups.groups.map((g) => g.players.map((p) => p.name))).toEqual([
        ['Zed', 'Watcher'],
      ])
      expect(playerGroups.spectators).toEqual([])
    })

    it('only the exact point-of-view name is flagged', () => {
      const row = rosterRow({ sides: [{ team: 'Red', players: ['Zed', 'zed2'] }] }, ' Zed ')
      const { playerGroups } = buildDemoDetail(row, row.sidecar.values)
      expect(playerGroups.groups[0]?.players).toEqual([
        { name: 'Zed', pov: true },
        { name: 'zed2', pov: false },
      ])
    })
  })
})
