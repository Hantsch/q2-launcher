import { describe, expect, it } from 'vitest'
import {
  compileNameTemplate,
  matchNameTemplate,
  NAME_TEMPLATE_ERROR,
  type CompiledNameTemplate,
  type NameFacts,
  type NameTemplateErrorKey,
} from './name-template'

function compile(text: string): CompiledNameTemplate {
  const r = compileNameTemplate(text)
  if (!r.ok) throw new Error(`expected ${text} to compile, got ${r.error.key}`)
  return r.template
}

function rejection(text: string): NameTemplateErrorKey | null {
  const r = compileNameTemplate(text)
  return r.ok ? null : r.error.key
}

function match(template: string, fileName: string): ReturnType<typeof matchNameTemplate> {
  return matchNameTemplate(compile(template), fileName)
}

describe('compileNameTemplate rejections', () => {
  it('rejects an empty template', () => {
    expect(rejection('')).toBe(NAME_TEMPLATE_ERROR.empty)
  })

  it('rejects an unclosed brace, including one reopened before it closes', () => {
    expect(rejection('{map')).toBe(NAME_TEMPLATE_ERROR.unclosedBrace)
    expect(rejection('{ma{p}')).toBe(NAME_TEMPLATE_ERROR.unclosedBrace)
  })

  it('rejects a stray closing brace', () => {
    expect(rejection('map}')).toBe(NAME_TEMPLATE_ERROR.strayBrace)
    expect(rejection('{map}}')).toBe(NAME_TEMPLATE_ERROR.strayBrace)
  })

  it('rejects a token outside the vocabulary, naming it', () => {
    const r = compileNameTemplate('{mapp}-{host}')
    expect(r).toEqual({
      ok: false,
      error: { key: NAME_TEMPLATE_ERROR.unknownToken, params: { token: 'mapp' } },
    })
    expect(rejection('{}')).toBe(NAME_TEMPLATE_ERROR.unknownToken)
  })

  it('rejects a duplicated token, counting shorthands as their parts, but lets {skip} repeat', () => {
    expect(rejection('{map}-{map}')).toBe(NAME_TEMPLATE_ERROR.duplicateToken)
    expect(rejection('{map}_{date}_{date}')).toBe(NAME_TEMPLATE_ERROR.duplicateToken)
    expect(rejection('{map}_{date}_{year}')).toBe(NAME_TEMPLATE_ERROR.duplicateToken)
    expect(rejection('{skip}-{skip}-{map}')).toBeNull()
  })

  it('rejects two text tokens with nothing between them, but allows digit tokens adjacent', () => {
    expect(rejection('{map}{host}')).toBe(NAME_TEMPLATE_ERROR.adjacentTextTokens)
    expect(rejection('{skip}{map}')).toBe(NAME_TEMPLATE_ERROR.adjacentTextTokens)
    expect(rejection('{map}{year}{month}{day}')).toBeNull()
  })

  it('rejects a template that captures nothing', () => {
    expect(rejection('demo-{skip}')).toBe(NAME_TEMPLATE_ERROR.capturesNothing)
    expect(rejection('demo')).toBe(NAME_TEMPLATE_ERROR.capturesNothing)
  })

  it('rejects a partial date', () => {
    expect(rejection('{year}-{month}-{map}')).toBe(NAME_TEMPLATE_ERROR.incompleteDate)
    expect(rejection('{day}-{map}')).toBe(NAME_TEMPLATE_ERROR.incompleteDate)
  })

  it('rejects time parts without a date, and an hour without minutes', () => {
    expect(rejection('{hour}{min}-{map}')).toBe(NAME_TEMPLATE_ERROR.timeWithoutDate)
    expect(rejection('{time}-{map}')).toBe(NAME_TEMPLATE_ERROR.timeWithoutDate)
    expect(rejection('{date}-{hour}-{map}')).toBe(NAME_TEMPLATE_ERROR.timeWithoutDate)
  })

  it('rejects a demo extension anywhere but the trailing suffix', () => {
    expect(rejection('{map}.dm2-{host}')).toBe(NAME_TEMPLATE_ERROR.misplacedExtension)
    expect(rejection('{map}.MVD2_{host}')).toBe(NAME_TEMPLATE_ERROR.misplacedExtension)
    expect(rejection('{map}.dm2.dm2')).toBe(NAME_TEMPLATE_ERROR.misplacedExtension)
    expect(rejection('{map}.dm2')).toBeNull()
  })
})

describe('matchNameTemplate on the shipped shapes', () => {
  it('reads a {year}-{month}-{day}-{hour}{min}-{map}.dm2 name', () => {
    expect(match('{year}-{month}-{day}-{hour}{min}-{map}.dm2', '2026-09-26-2130-q2dm1.dm2')).toStrictEqual({
      kind: 'match',
      facts: { date: { year: 2026, month: 9, day: 26, hour: 21, minute: 30 }, map: 'q2dm1' },
    })
  })

  it('reads a {map}_{date}_{time}.dm2 name including seconds', () => {
    expect(match('{map}_{date}_{time}.dm2', 'q2dm1_2026-09-26_21-30-00.dm2')).toStrictEqual({
      kind: 'match',
      facts: {
        date: { year: 2026, month: 9, day: 26, hour: 21, minute: 30, second: 0 },
        map: 'q2dm1',
      },
    })
  })

  it('reads an OpenTDM-shaped name with every fact, keeping the name casing', () => {
    expect(
      match(
        '{pov}-{teamA}-{teamB}-{host}-{map}_{date}_{time}',
        'Kosta-RED-blue-Q2TdmServer-q2dm1_2026-09-26_21-30-05.mvd2',
      ),
    ).toStrictEqual({
      kind: 'match',
      facts: {
        date: { year: 2026, month: 9, day: 26, hour: 21, minute: 30, second: 5 },
        map: 'q2dm1',
        pov: 'Kosta',
        teamA: 'RED',
        teamB: 'blue',
        host: 'Q2TdmServer',
      },
    })
  })

  it('reads a {year}{month}{day}-{hour}{min}{sec}-{map}.mvd2 name', () => {
    expect(match('{year}{month}{day}-{hour}{min}{sec}-{map}.mvd2', '20260926-213000-urban.mvd2')).toStrictEqual({
      kind: 'match',
      facts: {
        date: { year: 2026, month: 9, day: 26, hour: 21, minute: 30, second: 0 },
        map: 'urban',
      },
    })
  })

  it('collects players in index order and ignores {skip}', () => {
    expect(match('{skip}_{p2}-vs-{p1}_{map}', 'duel_Bob-VS-alice_q2dm1')).toStrictEqual({
      kind: 'match',
      facts: { map: 'q2dm1', players: ['alice', 'Bob'] },
    })
  })
})

describe('matchNameTemplate normalisation', () => {
  it('drops a .gz suffix and compares the extension and literals case-insensitively', () => {
    const facts = { date: { year: 2026, month: 9, day: 26, hour: 21, minute: 30, second: 0 }, map: 'Q2DM1' }
    expect(match('{map}_{date}_{time}.dm2', 'Q2DM1_2026-09-26_21-30-00.DM2.gz')).toStrictEqual({ kind: 'match', facts })
    expect(match('{map}_{date}_{time}.dm2', 'Q2DM1_2026-09-26_21-30-00.dm2.GZ')).toStrictEqual({ kind: 'match', facts })
    expect(match('Demo-{map}', 'DEMO-q2dm1.dm2')).toStrictEqual({ kind: 'match', facts: { map: 'q2dm1' } })
  })

  it('requires the template extension: .dm2 does not match .mvd2 and vice versa', () => {
    expect(match('{map}_{date}.dm2', 'q2dm1_2026-09-26.mvd2')).toEqual({ kind: 'none' })
    expect(match('{map}_{date}.mvd2', 'q2dm1_2026-09-26.dm2')).toEqual({ kind: 'none' })
    expect(match('{map}_{date}.dm2', 'q2dm1_2026-09-26')).toEqual({ kind: 'none' })
  })

  it('accepts .dm2, .mvd2 or no extension when the template names none, never capturing it', () => {
    for (const name of ['q2dm1_2026-09-26.dm2', 'q2dm1_2026-09-26.MVD2', 'q2dm1_2026-09-26']) {
      expect(match('{map}_{date}', name)).toStrictEqual({
        kind: 'match',
        facts: { date: { year: 2026, month: 9, day: 26 }, map: 'q2dm1' },
      })
    }
  })
})

describe('matchNameTemplate range checks', () => {
  it('treats an out-of-range date or time component as no match', () => {
    expect(match('{map}_{date}', 'q2dm1_2026-13-01')).toEqual({ kind: 'none' })
    expect(match('{map}_{date}', 'q2dm1_2026-00-01')).toEqual({ kind: 'none' })
    expect(match('{map}_{date}', 'q2dm1_2026-02-30')).toEqual({ kind: 'none' })
    expect(match('{map}_{date}', 'q2dm1_2026-04-31')).toEqual({ kind: 'none' })
    expect(match('{map}_{date}_{time}', 'q2dm1_2026-09-26_24-00-00')).toEqual({ kind: 'none' })
    expect(match('{map}_{date}_{time}', 'q2dm1_2026-09-26_23-60-00')).toEqual({ kind: 'none' })
  })

  it('handles Feb 29 by leap-year rules, whichever order the date parts come in', () => {
    expect(match('{map}_{date}', 'q2dm1_2024-02-29').kind).toBe('match')
    expect(match('{map}_{date}', 'q2dm1_2000-02-29').kind).toBe('match')
    expect(match('{map}_{date}', 'q2dm1_2025-02-29').kind).toBe('none')
    expect(match('{map}_{date}', 'q2dm1_1900-02-29').kind).toBe('none')
    expect(match('{day}.{month}.{year}-{map}', '29.02.2024-q2dm1').kind).toBe('match')
    expect(match('{day}.{month}.{year}-{map}', '29.02.2023-q2dm1').kind).toBe('none')
  })

  it('does not let an out-of-range reading make a name ambiguous', () => {
    // `{map}` could end at either `-`, but only the second reading has a real month.
    expect(match('{map}-{year}{month}{day}', 'a-20261301-20260101')).toStrictEqual({
      kind: 'match',
      facts: { date: { year: 2026, month: 1, day: 1 }, map: 'a-20261301' },
    })
    // Every reading lands on month 13: no match rather than a fallback.
    expect(match('{map}-{year}{month}{day}', 'dm-1-20261301')).toEqual({ kind: 'none' })
  })
})

describe('matchNameTemplate ambiguity', () => {
  it('reports two split points as ambiguous', () => {
    expect(match('{teamA}-{host}', 'red-blue-server')).toEqual({ kind: 'ambiguous' })
  })

  it('reports three readings (greedy, lazy and middle) as ambiguous', () => {
    expect(match('{teamA}-{teamB}-{host}', 'a-b-c-d')).toEqual({ kind: 'ambiguous' })
  })

  it('reports a single split as a match even when the separator occurs elsewhere', () => {
    expect(match('{teamA}-{teamB}-{host}', 'a-b-c')).toStrictEqual({
      kind: 'match',
      facts: { teamA: 'a', teamB: 'b', host: 'c' },
    })
    // Greedy and lazy agree: the `_` pins `{teamB}`'s end, and only one `-` precedes it.
    expect(match('{teamA}-{teamB}_{host}', 'red-blue_srv-eu')).toStrictEqual({
      kind: 'match',
      facts: { teamA: 'red', teamB: 'blue', host: 'srv-eu' },
    })
    // Two `-` are candidates for `{teamA}`'s end, but only one leaves four digits for the year.
    expect(match('{teamA}-{year}{month}{day}', 'a-b-20260926')).toStrictEqual({
      kind: 'match',
      facts: { teamA: 'a-b', date: { year: 2026, month: 9, day: 26 } },
    })
  })
})

// Independent brute-force oracle: enumerates every split directly, no memo, no cap.
type Part = { lit: string } | { tok: string }

function bruteSplits(parts: Part[], name: string): string[][] {
  const out: string[][] = []
  const rec = (k: number, pos: number, caps: string[]): void => {
    if (k === parts.length) {
      if (pos === name.length) out.push(caps)
      return
    }
    const p = parts[k]
    if ('lit' in p) {
      if (name.slice(pos, pos + p.lit.length).toLowerCase() === p.lit.toLowerCase()) {
        rec(k + 1, pos + p.lit.length, caps)
      }
      return
    }
    for (let end = pos + 1; end <= name.length; end++) rec(k + 1, end, [...caps, name.slice(pos, end)])
  }
  rec(0, 0, [])
  return out
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('matchNameTemplate against a brute-force oracle', () => {
  const cases: { template: string; parts: Part[]; pick: (f: NameFacts) => (string | undefined)[] }[] = [
    {
      template: '{teamA}-{teamB}',
      parts: [{ tok: 'teamA' }, { lit: '-' }, { tok: 'teamB' }],
      pick: (f) => [f.teamA, f.teamB],
    },
    {
      template: '{teamA}-{teamB}_{host}',
      parts: [{ tok: 'teamA' }, { lit: '-' }, { tok: 'teamB' }, { lit: '_' }, { tok: 'host' }],
      pick: (f) => [f.teamA, f.teamB, f.host],
    },
    {
      template: '{p1}_{p2}-{p3}',
      parts: [{ tok: 'p1' }, { lit: '_' }, { tok: 'p2' }, { lit: '-' }, { tok: 'p3' }],
      pick: (f) => f.players ?? [],
    },
    {
      template: 'x{map}-{host}',
      parts: [{ lit: 'x' }, { tok: 'map' }, { lit: '-' }, { tok: 'host' }],
      pick: (f) => [f.map, f.host],
    },
    {
      template: '{pov}--{host}',
      parts: [{ tok: 'pov' }, { lit: '--' }, { tok: 'host' }],
      pick: (f) => [f.pov, f.host],
    },
    {
      template: '{teamA}-{teamB}-{host}',
      parts: [{ tok: 'teamA' }, { lit: '-' }, { tok: 'teamB' }, { lit: '-' }, { tok: 'host' }],
      pick: (f) => [f.teamA, f.teamB, f.host],
    },
  ]
  const alphabet = 'aX-_1x-'

  it('agrees on none / exactly one / ambiguous for 1800 random names', () => {
    const rand = mulberry32(139)
    const seen = { none: 0, match: 0, ambiguous: 0 }
    for (const c of cases) {
      const compiled = compile(c.template)
      for (let iter = 0; iter < 300; iter++) {
        const len = 4 + Math.floor(rand() * 9)
        let name = ''
        for (let k = 0; k < len; k++) name += alphabet[Math.floor(rand() * alphabet.length)]
        const splits = bruteSplits(c.parts, name)
        const got = matchNameTemplate(compiled, name)
        const expected = splits.length === 0 ? 'none' : splits.length === 1 ? 'match' : 'ambiguous'
        expect(got.kind, `${c.template} vs ${name}`).toBe(expected)
        if (got.kind === 'match') expect(c.pick(got.facts), `${c.template} vs ${name}`).toEqual(splits[0])
        seen[got.kind]++
      }
    }
    expect(seen.none).toBeGreaterThan(0)
    expect(seen.match).toBeGreaterThan(0)
    expect(seen.ambiguous).toBeGreaterThan(0)
  })
})

describe('matchNameTemplate performance', () => {
  it('classifies a 250-character name with 120 separators against five text tokens in under 100 ms', () => {
    const chunks = Array.from({ length: 121 }, (_, k) => (k < 9 ? 'ab' : 'a'))
    const name = chunks.join('-')
    expect(name.length).toBe(250)
    expect(name.split('-').length - 1).toBe(120)

    const ambiguous = compile('{p1}-{p2}-{p3}-{p4}-{p5}')
    const none = compile('{p1}-{p2}-{p3}-{p4}-{p5}_end')
    const pinned = compile('{p1}-{p2}-{p3}-{p4}-{p5}_{date}')

    const start = performance.now()
    expect(matchNameTemplate(ambiguous, name)).toEqual({ kind: 'ambiguous' })
    expect(matchNameTemplate(none, name)).toEqual({ kind: 'none' })
    expect(matchNameTemplate(pinned, `${name}_2026-09-26`)).toEqual({ kind: 'ambiguous' })
    expect(performance.now() - start).toBeLessThan(100)
  })
})
