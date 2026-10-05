import { describe, expect, test } from 'vitest'
import {
  currentSprint,
  flowNameOf,
  parseFlowArgs,
  parseRepeat,
  parseShard,
  planFlows,
  repeatFlows,
  runGate,
  selectShard,
  validateQuarantine,
} from './lib/flow-gate.mjs'

const entry = (over = {}) => ({ flow: 'flaky', reason: 'r', story: '1', since: 'S32', ...over })

/** Scripted outcomes per flow: each call to runFlow shifts the next result off the flow's queue. */
function gate(outcomes, entries, extra = {}) {
  const queues = Object.fromEntries(Object.entries(outcomes).map(([k, v]) => [k, [...v]]))
  const calls = []
  const names = Object.keys(outcomes)
  return runGate({
    names,
    entries,
    current: 32,
    runFlow: (name) => {
      calls.push(name)
      return queues[name].shift()
    },
    ...extra,
  }).then((result) => ({ ...result, calls }))
}

describe('flow gate quarantine', () => {
  test('a quarantined flow that fails is an expected fail and the run stays green', async () => {
    const result = await gate({ flaky: [false], solid: [true] }, [entry()])
    expect(result.ok).toBe(true)
    expect(result.expectedFails).toEqual(['flaky'])
    expect(result.notes[0]).toContain('expected fail')
  })

  test('a quarantined flow that passes twice in a row fails the run', async () => {
    const result = await gate({ flaky: [true, true] }, [entry()])
    expect(result.ok).toBe(false)
    expect(result.unexpectedPasses).toEqual(['flaky'])
    expect(result.notes[0]).toContain('remove it from quarantine')
  })

  test('a quarantined flow that passes then fails is reported, not failed', async () => {
    const result = await gate({ flaky: [true, false] }, [entry()])
    expect(result.ok).toBe(true)
    expect(result.flaky).toEqual(['flaky'])
    expect(result.notes[0]).toContain('unexpected pass (flaky)')
    expect(result.calls).toEqual(['flaky', 'flaky'])
  })

  test('an entry older than three sprints fails the run', async () => {
    const old = await gate({ flaky: [false] }, [entry({ since: 'S28' })], { current: 32 })
    expect(old.ok).toBe(false)
    expect(old.configErrors[0]).toContain('quarantined since S28, older than three sprints')
    const edge = await gate({ flaky: [false] }, [entry({ since: 'S29' })], { current: 32 })
    expect(edge.ok).toBe(true)
  })

  test('an entry naming an unknown flow fails the run', async () => {
    expect(validateQuarantine([entry({ flow: 'ghost' })], ['flaky'])[0]).toContain('ghost')
    expect(validateQuarantine([entry({ since: 'next' })], ['flaky'])[0]).toContain('since')
    expect(validateQuarantine([entry({ platform: 'mac' })], ['flaky'])[0]).toContain('platform')
    expect(validateQuarantine([{ flow: 'flaky' }], ['flaky'])).toHaveLength(3)
    const result = await gate({ flaky: [true] }, [entry({ flow: 'ghost' })], {
      knownFlows: ['flaky'],
    })
    expect(result.ok).toBe(false)
    expect(result.configErrors[0]).toContain('ghost')
  })

  test('a platform entry only applies on its platform', async () => {
    const entries = [entry({ platform: 'linux' })]
    const onLinux = await gate({ flaky: [false] }, entries, { platform: 'linux' })
    expect(onLinux.ok).toBe(true)
    const onWindows = await gate({ flaky: [false] }, entries, { platform: 'win32' })
    expect(onWindows.ok).toBe(false)
    expect(onWindows.failed).toEqual(['flaky'])
  })

  test('a linux-scoped entry is not expected to fail on win32', async () => {
    const entries = [entry({ platform: 'linux' })]
    const green = await gate({ flaky: [true] }, entries, { platform: 'win32' })
    expect(green.ok).toBe(true)
    expect(green.unexpectedPasses ?? []).toEqual([])
    const red = await gate({ flaky: [false] }, entries, { platform: 'win32' })
    expect(red.ok).toBe(false)
    expect(red.failed).toEqual(['flaky'])
  })

  test('the run exits 0 only when every non-quarantined flow is green', async () => {
    expect((await gate({ a: [true], flaky: [false] }, [entry()])).ok).toBe(true)
    const red = await gate({ a: [false], flaky: [false] }, [entry()])
    expect(red.ok).toBe(false)
    expect(red.failed).toEqual(['a'])
  })

  test('the current sprint is the lowest open sprint directory', () => {
    expect(currentSprint(['S33', 'S32', 'done', '_TEMPLATE'], ['S31', 'S30'])).toBe(32)
    expect(currentSprint(['done'], ['S9', 'S31', 'S30'])).toBe(32)
    expect(currentSprint([], [])).toBeNull()
  })
})

describe('flow repeat', () => {
  test('--repeat runs each selected flow n times in a row', async () => {
    expect(repeatFlows(['a', 'b'], 3)).toEqual(['a', 'a', 'a', 'b', 'b', 'b'])
    expect(repeatFlows(['a', 'b'], 1)).toEqual(['a', 'b'])
    expect(parseRepeat('20')).toBe(20)
    for (const bad of ['0', '-1', '1.5', 'x', '', '2e1', ' 3']) {
      expect(parseRepeat(bad)).toBeNull()
    }
    const result = await gate({ a: [true, true] }, [], { names: repeatFlows(['a'], 2) })
    expect(result.calls).toEqual(['a', 'a'])
  })
})

describe('flow sharding', () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

  test('a shard takes every n-th flow, 1-based', () => {
    expect(selectShard(names, 1, 3)).toEqual(['a', 'd', 'g'])
    expect(selectShard(names, 2, 3)).toEqual(['b', 'e'])
    expect(selectShard(names, 3, 3)).toEqual(['c', 'f'])
    expect(parseShard('2/3')).toEqual({ index: 2, count: 3 })
  })

  test('the shards together cover every flow exactly once', () => {
    for (const count of [1, 2, 3, 7, 10]) {
      const all = Array.from({ length: count }, (_, k) => selectShard(names, k + 1, count)).flat()
      expect([...all].sort()).toEqual(names)
    }
  })

  test('a malformed --shard is refused', () => {
    for (const bad of ['0/3', '4/3', '1/0', '1.5/3', 'a/b', '1', '1/', '-1/3', '', '1/2/3']) {
      expect(parseShard(bad)).toBeNull()
    }
  })
})

describe('flow arguments', () => {
  const known = ['a', 'b', 'c']

  test('flow file paths and --affected are parsed into flow names', () => {
    for (const arg of [
      'a',
      'scripts/flows/a.mjs',
      String.raw`scripts\flows\a.mjs`,
      './scripts/flows/a.mjs',
    ]) {
      expect(flowNameOf(arg), arg).toBe('a')
    }
    const paths = parseFlowArgs(
      [String.raw`scripts\flows\b.mjs`, 'a', 'scripts/flows/b.mjs'],
      known,
    )
    expect(paths.errors).toEqual([])
    expect(paths.named).toEqual(['b', 'a'])

    for (const bad of ['nope', 'scripts/flows/nope.mjs', 'scripts/flows/a.txt', 'src/a.mjs']) {
      expect(parseFlowArgs([bad], known).errors, bad).toHaveLength(1)
    }

    expect(parseFlowArgs([], known).affected).toBeNull()
    expect(parseFlowArgs(['--affected'], known).affected).toEqual({ ref: null })
    expect(parseFlowArgs(['--affected=main~3'], known).affected).toEqual({ ref: 'main~3' })
    expect(parseFlowArgs(['--affected='], known).errors).toHaveLength(1)
    expect(parseFlowArgs(['--bogus'], known).errors).toHaveLength(1)

    const combined = parseFlowArgs(
      ['a', '--affected', '--shard=2/2', '--repeat=3', '--timeout=9'],
      known,
    )
    expect(combined).toMatchObject({
      errors: [],
      named: ['a'],
      affected: { ref: null },
      shard: { index: 2, count: 2 },
      repeat: 3,
      timeoutSeconds: 9,
    })
    expect(parseFlowArgs(['--shard=3/2', '--repeat=0', '--timeout=0'], known).errors).toHaveLength(
      3,
    )

    const picks = [
      { flow: 'a', reasons: ['x'] },
      { flow: 'c', reasons: ['y'] },
    ]
    const plan = planFlows({ named: ['b', 'a'], affected: { ref: null }, picks, known })
    expect(plan.names).toEqual(['b', 'a', 'c'])
    expect(plan.added).toEqual([{ flow: 'c', reasons: ['y'] }])
    expect(planFlows({ named: [], affected: null, known }).names).toEqual(known)
    expect(planFlows({ named: ['b'], affected: null, picks, known }).names).toEqual(['b'])
    expect(planFlows({ named: [], affected: { ref: null }, picks: [], known }).names).toEqual([])
    expect(planFlows({ named: ['b'], affected: { ref: null }, picks: [], known }).names).toEqual([
      'b',
    ])
    expect(repeatFlows(selectShard(plan.names, 1, 2), 2)).toEqual(['b', 'b', 'c', 'c'])
  })
})
