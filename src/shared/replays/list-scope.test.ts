import { describe, expect, it } from 'vitest'
import type { DemoRow } from '@shared/modules/replays'
import { scopeDemoRows } from './list-scope'

function row(id: string, source: DemoRow['source'], reachedBy?: string[]): DemoRow {
  return { id, source, ...(reachedBy === undefined ? {} : { reachedBy }) } as DemoRow
}

const inst = (installationId: string): DemoRow['source'] => ({
  kind: 'installation',
  installationId,
  installationName: installationId,
  gameDir: 'baseq2',
})

const ONE = row('one', inst('a'))
const TWO = row('two', inst('b'))
const EXTRA = row('extra', { kind: 'extraFolder', path: '/demos' } as DemoRow['source'], [])

describe('scoping by installation', () => {
  it("scoping keeps the active installation's and extra-folder rows", () => {
    const scoped = scopeDemoRows([ONE, TWO, EXTRA], { kind: 'installation', installationId: 'a' })
    expect(scoped.map((r) => r.id)).toEqual(['one', 'extra'])
  })

  it('a row reached by two installations is in both scopes', () => {
    const shared = row('shared', inst('a'), ['a', 'b'])
    for (const installationId of ['a', 'b']) {
      expect(scopeDemoRows([shared], { kind: 'installation', installationId })).toEqual([shared])
    }
    expect(scopeDemoRows([shared], { kind: 'installation', installationId: 'c' })).toEqual([])
  })

  it('scoping returns the same row objects', () => {
    const scoped = scopeDemoRows([ONE, TWO], { kind: 'installation', installationId: 'b' })
    expect(scoped[0]).toBe(TWO)
  })

  it('all keeps every row and none keeps nothing', () => {
    expect(scopeDemoRows([ONE, TWO, EXTRA], { kind: 'all' })).toHaveLength(3)
    expect(scopeDemoRows([ONE], { kind: 'none' })).toEqual([])
  })
})
