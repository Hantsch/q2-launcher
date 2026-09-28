import { describe, expect, it } from 'vitest'
import { compileNameTemplate } from './name-template'
import { parseDemoName, SHIPPED_NAME_PATTERNS } from './name-patterns'

describe('parseDemoName', () => {
  it('r1q2 autorecord name yields date and map', () => {
    const result = parseDemoName('2026-09-26-2130-q2dm1.dm2', SHIPPED_NAME_PATTERNS)
    expect(result).toEqual({
      status: 'matched',
      patternId: 'r1q2-autorecord',
      facts: { date: { year: 2026, month: 9, day: 26, hour: 21, minute: 30 }, map: 'q2dm1' },
    })
  })

  it('Q2PRO beginmapcmd name yields date, seconds and map', () => {
    const result = parseDemoName('q2dm1_2026-09-26_21-30-00.dm2', SHIPPED_NAME_PATTERNS)
    expect(result).toEqual({
      status: 'matched',
      patternId: 'q2pro-beginmapcmd',
      facts: {
        date: { year: 2026, month: 9, day: 26, hour: 21, minute: 30, second: 0 },
        map: 'q2dm1',
      },
    })
  })

  it('OpenTDM name yields pov, teams, host, map and date', () => {
    const fileName = 'Alice-Red-Blue-TDMServer-q2dm1_2026-09-26_21-30-00.dm2'
    const result = parseDemoName(fileName, SHIPPED_NAME_PATTERNS)
    expect(result).toEqual({
      status: 'matched',
      patternId: 'opentdm',
      facts: {
        pov: 'Alice',
        teamA: 'Red',
        teamB: 'Blue',
        host: 'TDMServer',
        map: 'q2dm1',
        date: { year: 2026, month: 9, day: 26, hour: 21, minute: 30, second: 0 },
      },
    })
    expect(result.status === 'matched' && result.patternId).not.toBe('q2pro-beginmapcmd')
  })

  it('AQ2-TNG mvd2 name yields date and map', () => {
    const result = parseDemoName('20260926-213000-urban.mvd2', SHIPPED_NAME_PATTERNS)
    expect(result).toEqual({
      status: 'matched',
      patternId: 'aq2tng-mvd2',
      facts: { date: { year: 2026, month: 9, day: 26, hour: 21, minute: 30, second: 0 }, map: 'urban' },
    })
  })

  it('a .gz suffix matches as the uncompressed name', () => {
    const names = [
      '2026-09-26-2130-q2dm1.dm2',
      'q2dm1_2026-09-26_21-30-00.dm2',
      'Alice-Red-Blue-TDMServer-q2dm1_2026-09-26_21-30-00.dm2',
      '20260926-213000-urban.mvd2',
    ]
    for (const name of names) {
      const plain = parseDemoName(name, SHIPPED_NAME_PATTERNS)
      const gzipped = parseDemoName(`${name}.gz`, SHIPPED_NAME_PATTERNS)
      expect(gzipped).toEqual(plain)
    }
  })

  it('an OpenTDM name with two possible splits yields no name facts', () => {
    const fileName = 'Alice-Red-Blue-TDM-Server-q2dm1_2026-09-26_21-30-00.dm2'
    const result = parseDemoName(fileName, SHIPPED_NAME_PATTERNS)
    expect(result).toEqual({ status: 'ambiguous', patternId: 'opentdm' })
    expect(result.status).not.toBe('matched')
  })

  it('an unmatched name yields no facts and a match names its pattern', () => {
    const none = parseDemoName('final.dm2', SHIPPED_NAME_PATTERNS)
    expect(none).toEqual({ status: 'none' })

    const matched = parseDemoName('2026-09-26-2130-q2dm1.dm2', SHIPPED_NAME_PATTERNS)
    expect(matched.status).toBe('matched')
    expect(matched.status === 'matched' && matched.patternId).toBe('r1q2-autorecord')
  })

  it('every shipped pattern compiles in the user template syntax', () => {
    for (const pattern of SHIPPED_NAME_PATTERNS) {
      const result = compileNameTemplate(pattern.template)
      expect(result.ok).toBe(true)
    }
  })

  it('a user-supplied pattern above a shipped one wins for a name both would match', () => {
    const patterns = [{ id: 'user', template: '{map}_{date}_{time}.dm2' }, ...SHIPPED_NAME_PATTERNS]
    const result = parseDemoName('q2dm1_2026-09-26_21-30-00.dm2', patterns)
    expect(result.status).toBe('matched')
    expect(result.status === 'matched' && result.patternId).toBe('user')
  })
})
