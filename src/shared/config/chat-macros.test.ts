import { describe, expect, it } from 'vitest'
import {
  CHAT_MACROS,
  findMacro,
  findSingleDollarLocMistakes,
  macrosUsed,
  tokenizeMessage,
} from './chat-macros'

describe('findMacro', () => {
  it('finds a macro by its exact token', () => {
    expect(findMacro('$$loc_here')?.labelKey).toBe('config.chatMacros.locHere.label')
    expect(findMacro('%h')?.scope).toBe('mod')
  })

  it('returns undefined for an unknown token', () => {
    expect(findMacro('%z')).toBeUndefined()
  })
})

describe('findSingleDollarLocMistakes', () => {
  it('flags a single-dollar $loc_here mistake', () => {
    const issues = findSingleDollarLocMistakes('[ HELP ] $loc_here')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toEqual({ index: 9, found: '$loc_here', suggestion: '$$loc_here' })
  })

  it('flags a single-dollar $loc_there mistake', () => {
    const issues = findSingleDollarLocMistakes('[ ENEMY ] $loc_there')
    expect(issues).toHaveLength(1)
    expect(issues[0]?.suggestion).toBe('$$loc_there')
  })

  it('does not flag the correct double-dollar form', () => {
    expect(findSingleDollarLocMistakes('[ HELP ] $$loc_here')).toEqual([])
  })
})

describe('macrosUsed', () => {
  it('reports every macro present in a message', () => {
    const used = macrosUsed('%h %a incoming, $$loc_here')
    expect(used.map((m) => m.token).sort()).toEqual(['%a', '%h', '$$loc_here'].sort())
  })

  it('reports no macros when none are present', () => {
    expect(macrosUsed('just plain text')).toEqual([])
  })
})

describe('tokenizeMessage', () => {
  it('recognizes every client-scope ($$...) token as kind "meta"', () => {
    const clientMacros = CHAT_MACROS.filter((m) => m.scope === 'client')
    expect(clientMacros.length).toBeGreaterThan(0)
    for (const macro of clientMacros) {
      const segments = tokenizeMessage(macro.token)
      expect(segments).toEqual([{ kind: 'meta', value: macro.token, index: 0 }])
    }
  })

  it('recognizes every mod-scope (%x) token as kind "macro"', () => {
    const modMacros = CHAT_MACROS.filter((m) => m.scope === 'mod')
    expect(modMacros).toHaveLength(5)
    for (const macro of modMacros) {
      const segments = tokenizeMessage(macro.token)
      expect(segments).toEqual([{ kind: 'macro', value: macro.token, index: 0 }])
    }
  })

  it('does not split out a $ that is not part of a recognized token', () => {
    const segments = tokenizeMessage('cost $5')
    expect(segments).toEqual([{ kind: 'text', value: 'cost $5', index: 0 }])
  })

  it('coalesces surrounding literal text into single segments around a token', () => {
    const segments = tokenizeMessage('go $$loc_here now')
    expect(segments).toEqual([
      { kind: 'text', value: 'go ', index: 0 },
      { kind: 'meta', value: '$$loc_here', index: 3 },
      { kind: 'text', value: ' now', index: 13 },
    ])
  })

  it('handles adjacent recognized tokens without an intervening text segment', () => {
    const segments = tokenizeMessage('%h%a')
    expect(segments).toEqual([
      { kind: 'macro', value: '%h', index: 0 },
      { kind: 'macro', value: '%a', index: 2 },
    ])
  })

  it('returns no segments for an empty string', () => {
    expect(tokenizeMessage('')).toEqual([])
  })

  it('handles a message with only literal text', () => {
    expect(tokenizeMessage('hello world')).toEqual([
      { kind: 'text', value: 'hello world', index: 0 },
    ])
  })
})
