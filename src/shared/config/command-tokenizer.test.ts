import { describe, expect, it } from 'vitest'
import { splitTopLevelSemicolons, stripLineComment, tokenize } from './command-tokenizer'

describe('stripLineComment', () => {
  it('strips a trailing // comment', () => {
    expect(stripLineComment('set cl_run 1 // enable always-run')).toBe('set cl_run 1 ')
  })

  it('returns the whole line when there is no comment', () => {
    expect(stripLineComment('set cl_run 1')).toBe('set cl_run 1')
  })

  it('does not treat // inside a quoted value as a comment', () => {
    expect(stripLineComment('set motd "visit http://example.com for info"')).toBe(
      'set motd "visit http://example.com for info"',
    )
  })

  it('treats a whole-line comment as entirely stripped', () => {
    expect(stripLineComment('// a whole-line comment')).toBe('')
  })
})

describe('splitTopLevelSemicolons', () => {
  it('splits on ; outside quotes', () => {
    expect(splitTopLevelSemicolons('set a 1; set b 2; bind x jump')).toEqual([
      'set a 1',
      ' set b 2',
      ' bind x jump',
    ])
  })

  it('does not split a ; inside a quoted argument', () => {
    expect(splitTopLevelSemicolons('bind TAB "cmd help; wait"')).toEqual([
      'bind TAB "cmd help; wait"',
    ])
  })

  it('returns the whole line as one part when there is no ;', () => {
    expect(splitTopLevelSemicolons('set a 1')).toEqual(['set a 1'])
  })
})

describe('tokenize', () => {
  it('splits on whitespace outside quotes', () => {
    expect(tokenize('bind w +forward')).toEqual(['bind', 'w', '+forward'])
  })

  it('keeps a quoted argument with embedded spaces as one token, quotes stripped', () => {
    expect(tokenize('set sv_hostname "My Cool Server"')).toEqual(['set', 'sv_hostname', 'My Cool Server'])
  })

  it('keeps a ; inside a quoted token intact', () => {
    expect(tokenize('alias lol "lol1;lol2;lol3"')).toEqual(['alias', 'lol', 'lol1;lol2;lol3'])
  })

  it('treats an unterminated quote as running to the end of the segment', () => {
    expect(tokenize('set sv_hostname "unterminated')).toEqual(['set', 'sv_hostname', 'unterminated'])
  })

  it('produces an empty-string token for an empty quoted argument', () => {
    expect(tokenize('alias blaster_settings ""')).toEqual(['alias', 'blaster_settings', ''])
  })

  it('returns no tokens for an empty or whitespace-only segment', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
  })

  it('does not treat a quote mid-token as special', () => {
    expect(tokenize('foo"bar baz')).toEqual(['foo"bar', 'baz'])
  })
})
