import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { renderProfileFile } from '@shared/config/render'
import {
  tokenizeConfigText,
  type ConfigSyntaxLine,
  type ConfigSyntaxToken,
} from './config-syntax'

/** Concatenates one line's token texts, in order. */
function lineText(line: ConfigSyntaxLine): string {
  return line.tokens.map((t) => t.text).join('')
}

/** Re-joins a whole tokenized document back into its original text. */
function reconstruct(lines: ConfigSyntaxLine[]): string {
  return lines.map((line) => lineText(line) + line.terminator).join('')
}

function allKinds(lines: ConfigSyntaxLine[]): Set<ConfigSyntaxToken['kind']> {
  const kinds = new Set<ConfigSyntaxToken['kind']>()
  for (const line of lines) {
    for (const token of line.tokens) kinds.add(token.kind)
  }
  return kinds
}

function profile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'profile-1',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: { sensitivity: '3', crosshair: '1' },
    binds: { w: '+forward', s: '+back' },
    assignments: [],
    ...overrides,
  }
}

describe('tokenizeConfigText - round-trip losslessness', () => {
  it('reproduces renderProfileFile output exactly', () => {
    const rendered = renderProfileFile(profile())
    const lines = tokenizeConfigText(rendered)
    expect(reconstruct(lines)).toBe(rendered)
  })

  it('reproduces a hand-written config exercising every quoting/comment edge case', () => {
    const input = [
      'alias +drops "bind 1 drop rl; bind 2 drop rg"',
      'set a 1; set b 2',
      'set motd "see http://example.com // not a comment; still not"',
      'set nick "Ronny" // trailing comment after a real command',
      'set unterminated "this quote never closes',
      'set greeting "café"',
      '#$%^&{}} unmatched garbage ]][[',
      'bind mouse1 +attack',
    ].join('\r\n')

    const lines = tokenizeConfigText(input)
    expect(reconstruct(lines)).toBe(input)
  })

  it('round-trips an empty string', () => {
    expect(reconstruct(tokenizeConfigText(''))).toBe('')
  })

  it('round-trips mixed line endings and a trailing partial line', () => {
    const input = 'set a 1\nset b 2\r\nset c 3\rset d 4'
    expect(reconstruct(tokenizeConfigText(input))).toBe(input)
  })
})

describe('tokenizeConfigText - classification', () => {
  it('classifies a set command line', () => {
    const [line] = tokenizeConfigText('set sensitivity 3')
    expect(line.tokens).toEqual([
      { kind: 'command', text: 'set' },
      { kind: 'space', text: ' ' },
      { kind: 'cvar', text: 'sensitivity' },
      { kind: 'space', text: ' ' },
      { kind: 'number', text: '3' },
    ])
  })

  it('classifies a bind command line with a quoted command body', () => {
    const [line] = tokenizeConfigText('bind w "+forward"')
    expect(line.tokens).toEqual([
      { kind: 'command', text: 'bind' },
      { kind: 'space', text: ' ' },
      { kind: 'key', text: 'w' },
      { kind: 'space', text: ' ' },
      { kind: 'string', text: '"+forward"' },
    ])
  })

  it('classifies unbindall with no key argument', () => {
    const [line] = tokenizeConfigText('unbindall')
    expect(line.tokens).toEqual([{ kind: 'command', text: 'unbindall' }])
  })

  it('classifies a bare +/- plusCommand distinct from a negative numeric set value', () => {
    const [plusLine] = tokenizeConfigText('+attack')
    expect(plusLine.tokens).toEqual([{ kind: 'plusCommand', text: '+attack' }])

    const [minusLine] = tokenizeConfigText('-attack')
    expect(minusLine.tokens).toEqual([{ kind: 'plusCommand', text: '-attack' }])

    const [negativeSetLine] = tokenizeConfigText('set m_pitch -5')
    expect(negativeSetLine.tokens).toEqual([
      { kind: 'command', text: 'set' },
      { kind: 'space', text: ' ' },
      { kind: 'cvar', text: 'm_pitch' },
      { kind: 'space', text: ' ' },
      { kind: 'number', text: '-5' },
    ])
  })

  it('classifies the +/- command word bound to a key as plusCommand, not text', () => {
    // Manual test-plan step 1: "+attack marked as a +-command" in a bind line.
    const [line] = tokenizeConfigText('bind s +back')
    expect(line.tokens).toEqual([
      { kind: 'command', text: 'bind' },
      { kind: 'space', text: ' ' },
      { kind: 'key', text: 's' },
      { kind: 'space', text: ' ' },
      { kind: 'plusCommand', text: '+back' },
    ])
  })

  it('classifies a float number value', () => {
    const [line] = tokenizeConfigText('set m_pitch 0.022')
    expect(line.tokens.some((t) => t.kind === 'number' && t.text === '0.022')).toBe(true)
  })

  it('splits a ; chain into two segments, each classifying its own command/cvar', () => {
    const [line] = tokenizeConfigText('set a 1; set b 2')
    expect(line.tokens).toEqual([
      { kind: 'command', text: 'set' },
      { kind: 'space', text: ' ' },
      { kind: 'cvar', text: 'a' },
      { kind: 'space', text: ' ' },
      { kind: 'number', text: '1' },
      { kind: 'separator', text: ';' },
      { kind: 'space', text: ' ' },
      { kind: 'command', text: 'set' },
      { kind: 'space', text: ' ' },
      { kind: 'cvar', text: 'b' },
      { kind: 'space', text: ' ' },
      { kind: 'number', text: '2' },
    ])
  })

  it('treats // inside a quoted string as ordinary text, not a comment', () => {
    const [line] = tokenizeConfigText('set motd "see http://example.com"')
    const stringToken = line.tokens.find((t) => t.kind === 'string')
    expect(stringToken?.text).toBe('"see http://example.com"')
    expect(line.tokens.some((t) => t.kind === 'comment')).toBe(false)
  })

  it('treats a trailing // after a real command as a comment token running to end of line', () => {
    const [line] = tokenizeConfigText('set nick "Ronny" // trailing comment')
    const comment = line.tokens.find((t) => t.kind === 'comment')
    expect(comment?.text).toBe('// trailing comment')
  })

  it('runs an unterminated quote to the end of the line', () => {
    const [line] = tokenizeConfigText('set greeting "never closes')
    const stringToken = line.tokens.find((t) => t.kind === 'string')
    expect(stringToken?.text).toBe('"never closes')
  })

  it('does not split on a ; that lives inside comment text', () => {
    const [line] = tokenizeConfigText('echo hi // a;b')
    const comment = line.tokens.find((t) => t.kind === 'comment')
    expect(comment?.text).toBe('// a;b')
    expect(line.tokens.some((t) => t.kind === 'separator')).toBe(false)
  })

  it('classifies a whole-line // comment', () => {
    const [line] = tokenizeConfigText('// just a comment')
    expect(line.tokens).toEqual([{ kind: 'comment', text: '// just a comment' }])
  })
})

describe('tokenizeConfigText - garbled lines are isolated', () => {
  it('leaves neighbours unaffected by an unrecognized/garbled line between them', () => {
    const input = ['set a 1', '#$%^&{}} ]][[ garbage', 'bind w +forward'].join('\n')
    const lines = tokenizeConfigText(input)

    expect(lines[0].tokens[0]).toEqual({ kind: 'command', text: 'set' })
    expect(lines[0].tokens.some((t) => t.kind === 'cvar' && t.text === 'a')).toBe(true)

    const garbled = lines[1]
    expect(garbled.tokens.some((t) => t.kind === 'command')).toBe(false)
    expect(garbled.tokens.some((t) => t.kind === 'key')).toBe(false)
    expect(garbled.tokens.some((t) => t.kind === 'cvar')).toBe(false)
    for (const token of garbled.tokens) {
      expect(['text', 'space', 'number', 'string']).toContain(token.kind)
    }
    expect(lineText(garbled)).toBe('#$%^&{}} ]][[ garbage')

    expect(lines[2].tokens[0]).toEqual({ kind: 'command', text: 'bind' })
    expect(lines[2].tokens.some((t) => t.kind === 'key' && t.text === 'w')).toBe(true)
  })
})

describe('tokenizeConfigText - every token kind is exercised', () => {
  it('produces every kind listed on ConfigSyntaxToken across the fixtures used in this file', () => {
    const fixtures = [
      renderProfileFile(profile()),
      'alias +drops "bind 1 drop rl; bind 2 drop rg"',
      'set a 1; set b 2 // trailing',
      'set motd "see http://example.com"',
      'set unterminated "never closes',
      '+attack',
      '-attack',
      'unbindall',
      '#$%^&{}} garbage ]][[',
      'set m_pitch -5',
    ].join('\n')

    const seen = allKinds(tokenizeConfigText(fixtures))
    const expected = new Set<ConfigSyntaxToken['kind']>([
      'comment',
      'command',
      'key',
      'cvar',
      'number',
      'string',
      'plusCommand',
      'separator',
      'space',
      'text',
    ])
    expect(seen).toEqual(expected)
  })
})

describe('tokenizeConfigText - performance', () => {
  it('tokenizes a ~2000 line synthetic config well under a loose bound', () => {
    const block = [
      'set sensitivity 3',
      'set crosshair 1 // pick a crosshair',
      'bind w "+forward"',
      'bind s +back',
      'alias +drops "bind 1 drop rl; bind 2 drop rg"',
      '// a comment line',
      'unbindall',
      '+attack',
    ]
    const lines: string[] = []
    for (let i = 0; i < 250; i++) lines.push(...block)
    const text = lines.join('\r\n')
    expect(lines.length).toBeGreaterThanOrEqual(2000)

    const start = performance.now()
    const result = tokenizeConfigText(text)
    const elapsed = performance.now() - start

    expect(result.length).toBe(lines.length)
    expect(elapsed).toBeLessThan(500)

    // Guards the fixture's own 'bind s +back' line - +back must classify as
    // plusCommand, not silently regress to text.
    const bindSLine = result[3]
    expect(lineText(bindSLine)).toBe('bind s +back')
    expect(bindSLine.tokens).toContainEqual({ kind: 'plusCommand', text: '+back' })
  })
})
