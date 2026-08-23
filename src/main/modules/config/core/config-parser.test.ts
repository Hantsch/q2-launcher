import { describe, expect, it } from 'vitest'
import { parseConfigText } from './config-parser'

describe('parseConfigText', () => {
  it('parses quoted arguments with embedded spaces as a single value', () => {
    const result = parseConfigText('set sv_hostname "My Cool Server"\nbind t "say hello world"\n')

    expect(result.cvars).toEqual([
      { name: 'sv_hostname', value: 'My Cool Server', line: 1, comment: '' },
    ])
    expect(result.binds).toEqual([
      { kind: 'bind', key: 't', command: 'say hello world', line: 2, comment: '' },
    ])
  })

  it('strips a // comment, including one trailing a real command on the same line', () => {
    const result = parseConfigText(
      ['// a whole-line comment', 'set cl_run 1 // enable always-run'].join('\n'),
    )

    expect(result.cvars).toEqual([
      { name: 'cl_run', value: '1', line: 2, comment: ' enable always-run' },
    ])
    // The whole-line comment is a comment-only line: it still lands in
    // `preserved` unchanged (AC 8), and is ADDITIONALLY collected into
    // `comments` (story 042 D3); line 2's trailing comment travels with the
    // cvar record above rather than being discarded or duplicated here.
    expect(result.preserved).toEqual([{ text: '// a whole-line comment', line: 1 }])
    expect(result.comments).toEqual([{ text: ' a whole-line comment', line: 1 }])
  })

  it('does not treat // inside a quoted value as a comment', () => {
    const result = parseConfigText('set motd "visit http://example.com for info"\n')

    expect(result.cvars).toEqual([
      { name: 'motd', value: 'visit http://example.com for info', line: 1, comment: '' },
    ])
  })

  it('splits multiple ;-separated commands on one line, keeping the same line number', () => {
    const result = parseConfigText('set a 1; set b 2; bind x jump\n')

    expect(result.cvars).toEqual([
      { name: 'a', value: '1', line: 1, comment: '' },
      { name: 'b', value: '2', line: 1, comment: '' },
    ])
    expect(result.binds).toEqual([{ kind: 'bind', key: 'x', command: 'jump', line: 1, comment: '' }])
  })

  it('attaches one whole-line trailing comment to every sibling on a ;-separated line, not a fragment per segment', () => {
    const result = parseConfigText('set a 1; set b 2 // shared note\n')

    expect(result.cvars).toEqual([
      { name: 'a', value: '1', line: 1, comment: ' shared note' },
      { name: 'b', value: '2', line: 1, comment: ' shared note' },
    ])
  })

  it('does not split a ; that appears inside a quoted argument', () => {
    const result = parseConfigText('bind TAB "cmd help; wait"\n')

    expect(result.binds).toEqual([
      { kind: 'bind', key: 'TAB', command: 'cmd help; wait', line: 1, comment: '' },
    ])
  })

  it.each(['set', 'seta', 'setu', 'sets'])('recognizes %s as a cvar assignment', (cmd) => {
    const result = parseConfigText(`${cmd} cl_maxfps 125\n`)
    expect(result.cvars).toEqual([{ name: 'cl_maxfps', value: '125', line: 1, comment: '' }])
  })

  it('is case-insensitive on the command name', () => {
    const result = parseConfigText('SET cl_maxfps 125\nBIND w +forward\n')
    expect(result.cvars).toEqual([{ name: 'cl_maxfps', value: '125', line: 1, comment: '' }])
    expect(result.binds).toEqual([
      { kind: 'bind', key: 'w', command: '+forward', line: 2, comment: '' },
    ])
  })

  it('normalizes a named key token to canonical casing regardless of how it was written', () => {
    const result = parseConfigText(['bind Shift "+klook"', 'bind ctrl "+attack"', 'unbind Enter'].join('\n'))

    expect(result.binds).toEqual([
      { kind: 'bind', key: 'SHIFT', command: '+klook', line: 1, comment: '' },
      { kind: 'bind', key: 'CTRL', command: '+attack', line: 2, comment: '' },
      { kind: 'unbind', key: 'ENTER', line: 3, comment: '' },
    ])
  })

  it('recognizes bind, unbind and unbindall with their own shapes', () => {
    const result = parseConfigText(['bind w +forward', 'unbind w', 'unbindall'].join('\n'))

    expect(result.binds).toEqual([
      { kind: 'bind', key: 'w', command: '+forward', line: 1, comment: '' },
      { kind: 'unbind', key: 'w', line: 2, comment: '' },
      { kind: 'unbindall', line: 3, comment: '' },
    ])
  })

  it("recognizes exec and only records the target - resolution is not this file's job", () => {
    const result = parseConfigText('exec autoexec.cfg\n')
    expect(result.execs).toEqual([{ target: 'autoexec.cfg', line: 1 }])
  })

  it('parses a quoted alias body as a single string, keeping an embedded ; unsplit', () => {
    const result = parseConfigText('alias lol "lol1;lol2;lol3"\n')

    expect(result.aliases).toEqual([
      { name: 'lol', body: 'lol1;lol2;lol3', line: 1, comment: '' },
    ])
    expect(result.preserved).toEqual([])
  })

  it('joins an unquoted multi-token alias body with single spaces', () => {
    const result = parseConfigText(['alias zoom zoomin', 'alias +foo bind 1 use blaster'].join('\n'))

    expect(result.aliases).toEqual([
      { name: 'zoom', body: 'zoomin', line: 1, comment: '' },
      { name: '+foo', body: 'bind 1 use blaster', line: 2, comment: '' },
    ])
  })

  it('parses alias n "" as a recognized alias with an empty body', () => {
    const result = parseConfigText('alias blaster_settings ""\n')

    expect(result.aliases).toEqual([
      { name: 'blaster_settings', body: '', line: 1, comment: '' },
    ])
    expect(result.preserved).toEqual([])
  })

  it('keeps a +/- prefixed alias name verbatim, sign included', () => {
    const result = parseConfigText(['alias +slow "cl_run 0"', 'alias -slow "cl_run 1"'].join('\n'))

    expect(result.aliases).toEqual([
      { name: '+slow', body: 'cl_run 0', line: 1, comment: '' },
      { name: '-slow', body: 'cl_run 1', line: 2, comment: '' },
    ])
  })

  it('preserves a bare "alias" with no name at all, unlike a named alias', () => {
    const result = parseConfigText('alias\n')

    expect(result.aliases).toEqual([])
    expect(result.preserved).toEqual([{ text: 'alias', line: 1 }])
  })

  it('preserves a +-prefixed command line verbatim', () => {
    const result = parseConfigText('+mlook\n')
    expect(result.preserved).toEqual([{ text: '+mlook', line: 1 }])
  })

  it('preserves a genuinely garbled/unparsable line verbatim', () => {
    const result = parseConfigText('this is not a quake command !!\n')
    expect(result.preserved).toEqual([{ text: 'this is not a quake command !!', line: 1 }])
  })

  it('preserves a recognized command name that is missing required arguments', () => {
    const result = parseConfigText(['set', 'set onlyname', 'bind', 'bind w', 'exec'].join('\n'))

    expect(result.cvars).toEqual([])
    expect(result.binds).toEqual([])
    expect(result.execs).toEqual([])
    expect(result.preserved).toEqual([
      { text: 'set', line: 1 },
      { text: 'set onlyname', line: 2 },
      { text: 'bind', line: 3 },
      { text: 'bind w', line: 4 },
      { text: 'exec', line: 5 },
    ])
  })

  it('drops a truly blank line without preserving it, but keeps a comment-only line', () => {
    const result = parseConfigText(['set a 1', '', '   ', '// just a note', 'set b 2'].join('\n'))

    expect(result.cvars).toEqual([
      { name: 'a', value: '1', line: 1, comment: '' },
      { name: 'b', value: '2', line: 5, comment: '' },
    ])
    expect(result.preserved).toEqual([{ text: '// just a note', line: 4 }])
    expect(result.comments).toEqual([{ text: ' just a note', line: 4 }])
  })

  it('collects comment-only lines additionally, in document order, without removing them from preserved', () => {
    const result = parseConfigText(
      ['// first', 'set a 1', '// second', '// third', 'bind w jump'].join('\n'),
    )

    expect(result.comments).toEqual([
      { text: ' first', line: 1 },
      { text: ' second', line: 3 },
      { text: ' third', line: 4 },
    ])
    expect(result.preserved).toEqual([
      { text: '// first', line: 1 },
      { text: '// second', line: 3 },
      { text: '// third', line: 4 },
    ])
  })

  it('does not treat a line of bare semicolons (no comment marker) as a comment-only line', () => {
    const result = parseConfigText(';;;\n')

    expect(result.comments).toEqual([])
    expect(result.preserved).toEqual([{ text: ';;;', line: 1 }])
  })

  it('only preserves the unrecognized segment of a mixed ;-separated line, keeping the recognized sibling', () => {
    const result = parseConfigText('set a 1; something weird here\n')

    expect(result.cvars).toEqual([{ name: 'a', value: '1', line: 1, comment: '' }])
    expect(result.preserved).toEqual([{ text: 'something weird here', line: 1 }])
  })

  it('gives 1-based line numbers and handles CRLF line endings', () => {
    const result = parseConfigText('set a 1\r\nbind w jump\r\nalias x y\r\n+mlook\r\n')

    expect(result.cvars[0].line).toBe(1)
    expect(result.binds[0].line).toBe(2)
    expect(result.aliases[0].line).toBe(3)
    expect(result.preserved[0].line).toBe(4)
  })

  it('returns every occurrence of a duplicate cvar/bind without resolving conflicts', () => {
    const result = parseConfigText('set a 1\nset a 2\nbind w jump\nbind w +forward\n')

    expect(result.cvars).toEqual([
      { name: 'a', value: '1', line: 1, comment: '' },
      { name: 'a', value: '2', line: 2, comment: '' },
    ])
    expect(result.binds).toEqual([
      { kind: 'bind', key: 'w', command: 'jump', line: 3, comment: '' },
      { kind: 'bind', key: 'w', command: '+forward', line: 4, comment: '' },
    ])
  })

  it('treats an unterminated quote as running to the end of the line', () => {
    const result = parseConfigText('set sv_hostname "unterminated\n')
    expect(result.cvars).toEqual([
      { name: 'sv_hostname', value: 'unterminated', line: 1, comment: '' },
    ])
  })

  it('returns empty arrays for empty input', () => {
    const result = parseConfigText('')
    expect(result).toEqual({
      cvars: [],
      binds: [],
      execs: [],
      aliases: [],
      preserved: [],
      comments: [],
    })
  })
})
