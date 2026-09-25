import { describe, expect, it } from 'vitest'
import { buildRuleTable } from './rule-table'

describe('buildRuleTable', () => {
  it('every reported key lands in exactly one section', () => {
    const serverinfo = {
      hostname: 'Test Server',
      maxclients: '8',
      Hostname: 'not the known hostname key',
      customkey: 'foo',
      _password: 'bar'
    }

    const table = buildRuleTable(serverinfo)
    const knownKeys = table.known.map((row) => row.key)
    const rawKeys = table.raw.map((row) => row.key)
    const allInputKeys = Object.keys(serverinfo)

    for (const key of allInputKeys) {
      const inKnown = knownKeys.includes(key as never)
      const inRaw = rawKeys.includes(key)
      expect(inKnown !== inRaw).toBe(true) // exactly one, not both, not neither
    }
    expect(knownKeys.length + rawKeys.length).toBe(allInputKeys.length)
  })

  it('known keys get typed values in table order', () => {
    const serverinfo = {
      port: '27910',
      hostname: 'Test Server',
      maxclients: '8',
      protocol: '34'
    }

    const table = buildRuleTable(serverinfo)
    expect(table.known.map((row) => row.key)).toEqual(['hostname', 'maxclients', 'protocol', 'port'])
    expect(table.known.find((row) => row.key === 'hostname')?.value).toEqual({
      kind: 'text',
      value: 'Test Server'
    })
    expect(table.known.find((row) => row.key === 'protocol')?.value).toEqual({
      kind: 'protocol',
      value: 34,
      engine: 'vanilla'
    })
  })

  it('unknown keys are listed raw and sorted', () => {
    const serverinfo = { Zeta: '1', apple: '2', banana: '3' }
    const table = buildRuleTable(serverinfo)
    expect(table.raw).toEqual([
      { key: 'apple', value: '2' },
      { key: 'banana', value: '3' },
      { key: 'Zeta', value: '1' }
    ])
  })

  it('a malformed known value is unparsed, not dropped or moved', () => {
    const serverinfo = { timelimit: 'abc' }
    const table = buildRuleTable(serverinfo)
    expect(table.known).toEqual([{ key: 'timelimit', value: { kind: 'unparsed', raw: 'abc' } }])
    expect(table.raw).toEqual([])
  })

  it('an empty map yields an empty table', () => {
    const table = buildRuleTable({})
    expect(table).toEqual({ known: [], raw: [] })
    expect(table.dmflags).toBeUndefined()
  })
})
