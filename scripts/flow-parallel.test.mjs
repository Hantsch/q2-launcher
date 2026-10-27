import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { parseFlowArgs } from './lib/flow-gate.mjs'
import {
  PINNED_FLOWS,
  mergeResults,
  partitionFlows,
  planLines,
  shardRootName,
  unreportedResult,
} from './lib/flow-parallel.mjs'

const flowsDir = join(dirname(fileURLToPath(import.meta.url)), 'flows')

const result = (over = {}) => ({
  ok: true,
  failed: [],
  expectedFails: [],
  unexpectedPasses: [],
  flaky: [],
  configErrors: [],
  notes: [],
  total: 0,
  ...over,
})

describe('flow partition', () => {
  const names = ['a', 'harness-offscreen', 'b', 'c', 'servers-list-states', 'd', 'e']

  test('pinned flows leave the groups and keep their selection order', () => {
    const { groups, pinned } = partitionFlows(names, 2)
    expect(pinned).toEqual(['harness-offscreen', 'servers-list-states'])
    expect(groups).toEqual([
      ['a', 'c', 'e'],
      ['b', 'd'],
    ])
  })

  test('the groups together cover every free flow exactly once', () => {
    for (const count of [1, 2, 3, 5, 10]) {
      const { groups, pinned } = partitionFlows(names, count)
      expect(groups.length).toBeLessThanOrEqual(count)
      for (const group of groups) expect(group.length).toBeGreaterThan(0)
      expect([...groups.flat(), ...pinned].sort()).toEqual([...names].sort())
    }
  })

  test('fewer free flows than groups means fewer groups, never an empty one', () => {
    expect(partitionFlows(['a', 'b'], 4).groups).toEqual([['a'], ['b']])
    expect(partitionFlows(['harness-offscreen'], 4)).toEqual({
      groups: [],
      pinned: ['harness-offscreen'],
    })
    expect(partitionFlows([], 4)).toEqual({ groups: [], pinned: [] })
  })

  test('the pinned list is a parameter, so the partition itself needs no flow sources', () => {
    const custom = { b: 'why' }
    expect(partitionFlows(['a', 'b', 'c'], 2, custom)).toEqual({
      groups: [['a'], ['c']],
      pinned: ['b'],
    })
  })

  test('the plan names every group, its root and every pinned flow with its reason', () => {
    const lines = planLines(partitionFlows(names, 2), 2)
    expect(lines[0]).toBe('parallel: 2 of 2 requested groups, then 2 pinned flow(s) serially')
    expect(lines[1]).toBe(`  shard 1: 3 flow(s) under ${shardRootName(1)}/`)
    expect(lines[2]).toBe('  shard 2: 2 flow(s) under shard-2/')
    expect(lines[3]).toBe(`  pinned: harness-offscreen (${PINNED_FLOWS['harness-offscreen']})`)
    expect(lines).toHaveLength(5)
    expect(planLines(partitionFlows(['a'], 3), 3)).toEqual([
      'parallel: 1 of 3 requested groups',
      '  shard 1: 1 flow(s) under shard-1/',
    ])
  })

  test('--parallel is parsed like --repeat and refused when malformed', () => {
    const known = ['a']
    expect(parseFlowArgs(['a'], known).parallel).toBeNull()
    expect(parseFlowArgs(['a', '--parallel=4'], known)).toMatchObject({
      errors: [],
      parallel: 4,
    })
    for (const bad of ['--parallel=0', '--parallel=', '--parallel=x', '--parallel=1.5']) {
      expect(parseFlowArgs([bad], known).errors, bad).toHaveLength(1)
    }
  })
})

describe('flow result merging', () => {
  test('the merged result adds up totals and lists, in group order', () => {
    const merged = mergeResults([
      result({ total: 3, notes: ['n1'] }),
      result({ total: 2, ok: false, failed: ['x'], flaky: ['f'], notes: ['n2'] }),
      result({ total: 1, expectedFails: ['q'], unexpectedPasses: ['u'] }),
    ])
    expect(merged).toEqual({
      ok: false,
      failed: ['x'],
      expectedFails: ['q'],
      unexpectedPasses: ['u'],
      flaky: ['f'],
      configErrors: [],
      notes: ['n1', 'n2'],
      total: 6,
    })
    expect(mergeResults([result({ total: 2 }), result({ total: 1 })]).ok).toBe(true)
    expect(mergeResults([])).toMatchObject({ ok: true, total: 0, failed: [] })
  })

  test('a config error every child repeats is reported once', () => {
    const merged = mergeResults([
      result({ ok: false, configErrors: ['stale entry', 'bad entry'] }),
      result({ ok: false, configErrors: ['stale entry'] }),
    ])
    expect(merged.configErrors).toEqual(['stale entry', 'bad entry'])
    expect(merged.ok).toBe(false)
  })

  test('a child without a report fails every flow it was given, and says so', () => {
    const gone = unreportedResult(['a', 'b'], 'shard 2', null)
    expect(gone.ok).toBe(false)
    expect(gone.failed).toEqual(['a', 'b'])
    expect(gone.total).toBe(2)
    expect(gone.notes[0]).toContain('shard 2: exited with a signal without a report')
    expect(unreportedResult(['a'], 'shard 1', 3).notes[0]).toContain('status 3')
    expect(mergeResults([result({ total: 1 }), gone])).toMatchObject({
      ok: false,
      failed: ['a', 'b'],
      total: 3,
    })
  })
})

describe('the pinned list against the flows on disk', () => {
  const sources = Object.fromEntries(
    readdirSync(flowsDir)
      .filter((file) => file.endsWith('.mjs'))
      .map((file) => [file.slice(0, -'.mjs'.length), readFileSync(join(flowsDir, file), 'utf8')]),
  )
  // What makes a flow unsafe next to another: binding the stub's fixed loopback ports
  // (`scripts/lib/servers-stub.mjs`), or asserting or driving the harness window's focus.
  const FIXED_PORTS = /\b(startServerResponders|startListServer)\(/
  const FOCUS = /\.isFocused\(\)|\.emit\('(focus|blur)'\)|\.minimize\(\)/

  test('every pinned flow exists', () => {
    for (const name of Object.keys(PINNED_FLOWS)) expect(sources, name).toHaveProperty(name)
  })

  test('every flow that binds a fixed port or touches window focus is pinned, and no other', () => {
    const unsafe = Object.entries(sources)
      .filter(([, source]) => FIXED_PORTS.test(source) || FOCUS.test(source))
      .map(([name]) => name)
      .sort()
    expect(unsafe).toEqual(Object.keys(PINNED_FLOWS).sort())
  })
})
