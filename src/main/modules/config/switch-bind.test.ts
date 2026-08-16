import { describe, expect, it } from 'vitest'
import { MAX_ALIAS_NAME, MAX_LINE_BYTES } from '@shared/config/alt-layers'
import {
  MAX_ECHO_NAME,
  SWITCH_ALIAS,
  renderSwitchBindChain,
  renderSwitchBindChainLines,
  sanitizeEchoName,
} from './switch-bind'
import type { SwitchBindProfile } from './switch-bind'

function profile(id: string, name = id.toUpperCase()): SwitchBindProfile {
  return { id, name }
}

/** Alias names actually emitted by a chain, in write order. */
function aliasNames(lines: string[]): string[] {
  return lines.flatMap((line) => {
    const match = /^alias (\S+) /.exec(line)
    return match ? [match[1]] : []
  })
}

/** The `;`-joined command list inside `alias <name> "<body>"`. */
function aliasBody(lines: string[], name: string): string[] {
  const line = lines.find((candidate) => candidate.startsWith(`alias ${name} `))
  if (!line) throw new Error(`no alias line for ${name}`)
  const match = /^alias \S+ "(.*)"$/.exec(line)
  return (match ? match[1] : line.slice(`alias ${name} `.length)).split('; ')
}

describe('renderSwitchBindChain', () => {
  it('renders two step aliases, the indirection alias and the bind for two profiles', () => {
    const chain = renderSwitchBindChain({
      key: 'F9',
      profiles: [profile('p1', 'Duel'), profile('p2', 'CTF')],
      defaultProfileId: 'p1',
    })

    expect(chain).toBe(
      [
        'alias q2l_sw1 "exec q2l-profile-p1.cfg; echo Profile: Duel; bind F9 q2l_switch; alias q2l_switch q2l_sw2"',
        'alias q2l_sw2 "exec q2l-profile-p2.cfg; echo Profile: CTF; bind F9 q2l_switch; alias q2l_switch q2l_sw1"',
        'alias q2l_switch q2l_sw2',
        'bind F9 q2l_switch',
      ].join('\n'),
    )
  })

  it('has no trailing newline, so the loader decides how to append it', () => {
    const chain = renderSwitchBindChain({
      key: 'F9',
      profiles: [profile('p1'), profile('p2')],
      defaultProfileId: 'p1',
    })

    expect(chain.endsWith('\n')).toBe(false)
    expect(chain.endsWith('bind F9 q2l_switch')).toBe(true)
  })

  it('is deterministic across repeated calls on the same input', () => {
    const input = {
      key: 'F9',
      profiles: [profile('p1', 'Duel'), profile('p2', 'CTF'), profile('p3', 'Rocket Arena')],
      defaultProfileId: 'p2',
    }

    expect(renderSwitchBindChain(input)).toBe(renderSwitchBindChain(input))
  })

  it('round-trips a high-ASCII profile name through latin1 byte-for-byte', () => {
    const chain = renderSwitchBindChain({
      key: 'F9',
      profiles: [profile('p1', 'Bjørn'), profile('p2', 'Grüße')],
      defaultProfileId: 'p1',
    })

    expect(Buffer.from(chain, 'latin1').toString('latin1')).toBe(chain)
  })
})

describe('renderSwitchBindChain cycle order', () => {
  const four = [
    profile('a', 'Alpha'),
    profile('b', 'Bravo'),
    profile('c', 'Charlie'),
    profile('d', 'Delta'),
  ]

  it('points the indirection alias at the successor of a default in the middle of the order', () => {
    // Default is the 2nd of 4, so the first press must land on the 3rd - the
    // loader already execed the default at launch.
    const lines = renderSwitchBindChainLines({ key: 'F9', profiles: four, defaultProfileId: 'b' })

    expect(lines).toContain('alias q2l_switch q2l_sw3')
  })

  it('chains every step to its successor and wraps the last step back to the first', () => {
    const lines = renderSwitchBindChainLines({ key: 'F9', profiles: four, defaultProfileId: 'b' })

    expect(aliasBody(lines, 'q2l_sw1').at(-1)).toBe('alias q2l_switch q2l_sw2')
    expect(aliasBody(lines, 'q2l_sw2').at(-1)).toBe('alias q2l_switch q2l_sw3')
    expect(aliasBody(lines, 'q2l_sw3').at(-1)).toBe('alias q2l_switch q2l_sw4')
    expect(aliasBody(lines, 'q2l_sw4').at(-1)).toBe('alias q2l_switch q2l_sw1')
  })

  it('emits one step alias per profile in list order, then the indirection alias and the bind', () => {
    const lines = renderSwitchBindChainLines({ key: 'F9', profiles: four, defaultProfileId: 'b' })

    expect(lines).toHaveLength(4 + 2)
    expect(aliasNames(lines)).toEqual(['q2l_sw1', 'q2l_sw2', 'q2l_sw3', 'q2l_sw4', 'q2l_switch'])
    expect(lines.at(-1)).toBe('bind F9 q2l_switch')
    expect(aliasBody(lines, 'q2l_sw3')[0]).toBe('exec q2l-profile-c.cfg')
  })

  it('wraps to the first step when the default is last in the order', () => {
    const lines = renderSwitchBindChainLines({ key: 'F9', profiles: four, defaultProfileId: 'd' })

    expect(lines).toContain('alias q2l_switch q2l_sw1')
  })

  it('starts at the second step when the default id is not among the profiles', () => {
    // Should not happen (an installation's default is always assigned), so the
    // documented degradation is "treat the first profile as the default".
    const lines = renderSwitchBindChainLines({
      key: 'F9',
      profiles: four,
      defaultProfileId: 'gone',
    })

    expect(lines).toContain('alias q2l_switch q2l_sw2')
  })

  it('re-applies the bind in every step, so a profile file that rebinds the key cannot kill the cycle', () => {
    const lines = renderSwitchBindChainLines({ key: 'F9', profiles: four, defaultProfileId: 'b' })

    for (const step of ['q2l_sw1', 'q2l_sw2', 'q2l_sw3', 'q2l_sw4']) {
      expect(aliasBody(lines, step)).toContain('bind F9 q2l_switch')
    }
  })

  it('execs each profile file and echoes each name exactly once', () => {
    const lines = renderSwitchBindChainLines({ key: 'F9', profiles: four, defaultProfileId: 'b' })

    for (const [index, entry] of four.entries()) {
      const body = aliasBody(lines, `q2l_sw${index + 1}`)
      expect(body[0]).toBe(`exec q2l-profile-${entry.id}.cfg`)
      expect(body[1]).toBe(`echo Profile: ${entry.name}`)
      expect(body).toHaveLength(4)
    }
  })
})

describe('renderSwitchBindChain with fewer than two profiles', () => {
  it('emits nothing for zero profiles', () => {
    expect(renderSwitchBindChain({ key: 'F9', profiles: [], defaultProfileId: '' })).toBe('')
    expect(renderSwitchBindChainLines({ key: 'F9', profiles: [], defaultProfileId: '' })).toEqual(
      [],
    )
  })

  it('emits nothing for a single profile', () => {
    expect(
      renderSwitchBindChain({ key: 'F9', profiles: [profile('p1')], defaultProfileId: 'p1' }),
    ).toBe('')
  })

  it('emits nothing when no usable key is given', () => {
    expect(
      renderSwitchBindChain({
        key: '   ',
        profiles: [profile('p1'), profile('p2')],
        defaultProfileId: 'p1',
      }),
    ).toBe('')
  })

  it('sanitizes the key name into a single token', () => {
    const chain = renderSwitchBindChain({
      key: ' "F9"; $x ',
      profiles: [profile('p1'), profile('p2')],
      defaultProfileId: 'p1',
    })

    expect(chain).toContain('bind F9x q2l_switch')
    expect(chain).not.toContain('"F9"')
  })
})

describe('switch-bind name sanitizing', () => {
  const messy = 'CTF "Pro"; $rand // v2 Bjørn'

  it('strips quotes, semicolons, macro sigils and comment slashes from the echoed name', () => {
    const lines = renderSwitchBindChainLines({
      key: 'F9',
      profiles: [profile('p1', messy), profile('p2', 'Plain')],
      defaultProfileId: 'p1',
    })

    expect(aliasBody(lines, 'q2l_sw1')[1]).toBe('echo Profile: CTF Pro rand v2 Bjørn')
  })

  it('keeps the step line well-formed: one quote pair, four commands, no stray separators', () => {
    const lines = renderSwitchBindChainLines({
      key: 'F9',
      profiles: [profile('p1', messy), profile('p2', 'Plain')],
      defaultProfileId: 'p1',
    })
    const line = lines[0]

    expect(line.match(/"/g)).toHaveLength(2)
    expect(line.startsWith('alias q2l_sw1 "')).toBe(true)
    expect(line.endsWith('"')).toBe(true)
    expect(aliasBody(lines, 'q2l_sw1')).toHaveLength(4)
  })

  it('collapses control characters and whitespace runs', () => {
    const lines = renderSwitchBindChainLines({
      key: 'F9',
      profiles: [profile('p1', 'Duel\n\tmode  x'), profile('p2', 'Plain')],
      defaultProfileId: 'p1',
    })

    expect(aliasBody(lines, 'q2l_sw1')[1]).toBe('echo Profile: Duel mode x')
  })

  it('truncates a long name to MAX_ECHO_NAME characters', () => {
    const long = 'L'.repeat(80)
    const lines = renderSwitchBindChainLines({
      key: 'F9',
      profiles: [profile('p1', long), profile('p2', 'Plain')],
      defaultProfileId: 'p1',
    })

    expect(aliasBody(lines, 'q2l_sw1')[1]).toBe(`echo Profile: ${'L'.repeat(MAX_ECHO_NAME)}`)
  })

  it('falls back to the profile id when sanitizing empties the name', () => {
    const lines = renderSwitchBindChainLines({
      key: 'F9',
      profiles: [profile('p1', '$$; ""'), profile('p2', 'Plain')],
      defaultProfileId: 'p1',
    })

    expect(aliasBody(lines, 'q2l_sw1')[1]).toBe('echo Profile: p1')
  })

  it('falls back to a literal when name and id are both unusable', () => {
    expect(sanitizeEchoName('""', '')).toBe('profile')
  })

  it('keeps high-ASCII characters, which survive the latin1 write', () => {
    expect(sanitizeEchoName('Bjørn', 'p1')).toBe('Bjørn')
  })
})

describe('switch-bind engine limits', () => {
  const many = Array.from({ length: 150 }, (_, index) =>
    profile(
      `0f9c1b7e-4d2a-4c3b-8e5f-${String(index).padStart(12, '0')}`,
      `Prøfile ${'ü'.repeat(60)}`,
    ),
  )

  it('keeps every emitted alias name within MAX_ALIAS_NAME, even for a large profile count', () => {
    const lines = renderSwitchBindChainLines({
      key: 'MOUSEWHEELDOWN',
      profiles: many,
      defaultProfileId: many[75].id,
    })

    expect(aliasNames(lines)).toHaveLength(many.length + 1)
    for (const name of aliasNames(lines)) {
      expect(name.length).toBeLessThanOrEqual(MAX_ALIAS_NAME)
    }
  })

  it('keeps every emitted line below the Cbuf_Execute line limit', () => {
    const lines = renderSwitchBindChainLines({
      key: 'MOUSEWHEELDOWN',
      profiles: many,
      defaultProfileId: many[75].id,
    })

    for (const line of lines) {
      expect(Buffer.byteLength(line, 'latin1')).toBeLessThan(MAX_LINE_BYTES)
    }
  })

  it('never emits an alias body containing a quote character', () => {
    const lines = renderSwitchBindChainLines({
      key: 'F9',
      profiles: [profile('p1', 'a "b" c'), profile('p2', 'd "e"')],
      defaultProfileId: 'p1',
    })

    for (const line of lines) {
      expect(line.match(/"/g)?.length ?? 0).toBeLessThanOrEqual(2)
    }
  })

  it('uses the fixed indirection alias token', () => {
    expect(SWITCH_ALIAS).toBe('q2l_switch')
    expect(SWITCH_ALIAS.length).toBeLessThanOrEqual(MAX_ALIAS_NAME)
  })
})
