import { describe, expect, it } from 'vitest'
import { parseConfigText } from './config-parser'

describe('parseConfigText', () => {
  it('parses quoted arguments with embedded spaces as a single value', () => {
    const result = parseConfigText('set sv_hostname "My Cool Server"\nbind t "say hello world"\n')

    expect(result.cvars).toEqual([{ name: 'sv_hostname', value: 'My Cool Server', line: 1 }])
    expect(result.binds).toEqual([{ kind: 'bind', key: 't', command: 'say hello world', line: 2 }])
  })

  it('strips a // comment, including one trailing a real command on the same line', () => {
    const result = parseConfigText(
      ['// a whole-line comment', 'set cl_run 1 // enable always-run'].join('\n'),
    )

    expect(result.cvars).toEqual([{ name: 'cl_run', value: '1', line: 2 }])
    // The whole-line comment is preserved verbatim; the trailing comment on
    // line 2 is simply discarded because line 2 as a whole was understood.
    expect(result.preserved).toEqual([{ text: '// a whole-line comment', line: 1 }])
  })

  it('does not treat // inside a quoted value as a comment', () => {
    const result = parseConfigText('set motd "visit http://example.com for info"\n')

    expect(result.cvars).toEqual([
      { name: 'motd', value: 'visit http://example.com for info', line: 1 },
    ])
  })

  it('splits multiple ;-separated commands on one line, keeping the same line number', () => {
    const result = parseConfigText('set a 1; set b 2; bind x jump\n')

    expect(result.cvars).toEqual([
      { name: 'a', value: '1', line: 1 },
      { name: 'b', value: '2', line: 1 },
    ])
    expect(result.binds).toEqual([{ kind: 'bind', key: 'x', command: 'jump', line: 1 }])
  })

  it('does not split a ; that appears inside a quoted argument', () => {
    const result = parseConfigText('bind TAB "cmd help; wait"\n')

    expect(result.binds).toEqual([{ kind: 'bind', key: 'TAB', command: 'cmd help; wait', line: 1 }])
  })

  it.each(['set', 'seta', 'setu', 'sets'])('recognizes %s as a cvar assignment', (cmd) => {
    const result = parseConfigText(`${cmd} cl_maxfps 125\n`)
    expect(result.cvars).toEqual([{ name: 'cl_maxfps', value: '125', line: 1 }])
  })

  it('is case-insensitive on the command name', () => {
    const result = parseConfigText('SET cl_maxfps 125\nBIND w +forward\n')
    expect(result.cvars).toEqual([{ name: 'cl_maxfps', value: '125', line: 1 }])
    expect(result.binds).toEqual([{ kind: 'bind', key: 'w', command: '+forward', line: 2 }])
  })

  it('normalizes a named key token to canonical casing regardless of how it was written', () => {
    const result = parseConfigText(['bind Shift "+klook"', 'bind ctrl "+attack"', 'unbind Enter'].join('\n'))

    expect(result.binds).toEqual([
      { kind: 'bind', key: 'SHIFT', command: '+klook', line: 1 },
      { kind: 'bind', key: 'CTRL', command: '+attack', line: 2 },
      { kind: 'unbind', key: 'ENTER', line: 3 },
    ])
  })

  it('recognizes bind, unbind and unbindall with their own shapes', () => {
    const result = parseConfigText(['bind w +forward', 'unbind w', 'unbindall'].join('\n'))

    expect(result.binds).toEqual([
      { kind: 'bind', key: 'w', command: '+forward', line: 1 },
      { kind: 'unbind', key: 'w', line: 2 },
      { kind: 'unbindall', line: 3 },
    ])
  })

  it("recognizes exec and only records the target - resolution is not this file's job", () => {
    const result = parseConfigText('exec autoexec.cfg\n')
    expect(result.execs).toEqual([{ target: 'autoexec.cfg', line: 1 }])
  })

  it('preserves an alias line verbatim', () => {
    const text = 'alias +strafe "+moveleft"\n'
    const result = parseConfigText(text)

    expect(result.preserved).toEqual([{ text: 'alias +strafe "+moveleft"', line: 1 }])
    expect(result.cvars).toEqual([])
    expect(result.binds).toEqual([])
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
      { name: 'a', value: '1', line: 1 },
      { name: 'b', value: '2', line: 5 },
    ])
    expect(result.preserved).toEqual([{ text: '// just a note', line: 4 }])
  })

  it('only preserves the unrecognized segment of a mixed ;-separated line, keeping the recognized sibling', () => {
    const result = parseConfigText('set a 1; something weird here\n')

    expect(result.cvars).toEqual([{ name: 'a', value: '1', line: 1 }])
    expect(result.preserved).toEqual([{ text: 'something weird here', line: 1 }])
  })

  it('gives 1-based line numbers and handles CRLF line endings', () => {
    const result = parseConfigText('set a 1\r\nbind w jump\r\nalias x y\r\n')

    expect(result.cvars[0].line).toBe(1)
    expect(result.binds[0].line).toBe(2)
    expect(result.preserved[0].line).toBe(3)
  })

  it('returns every occurrence of a duplicate cvar/bind without resolving conflicts', () => {
    const result = parseConfigText('set a 1\nset a 2\nbind w jump\nbind w +forward\n')

    expect(result.cvars).toEqual([
      { name: 'a', value: '1', line: 1 },
      { name: 'a', value: '2', line: 2 },
    ])
    expect(result.binds).toEqual([
      { kind: 'bind', key: 'w', command: 'jump', line: 3 },
      { kind: 'bind', key: 'w', command: '+forward', line: 4 },
    ])
  })

  it('treats an unterminated quote as running to the end of the line', () => {
    const result = parseConfigText('set sv_hostname "unterminated\n')
    expect(result.cvars).toEqual([{ name: 'sv_hostname', value: 'unterminated', line: 1 }])
  })

  it('returns empty arrays for empty input', () => {
    const result = parseConfigText('')
    expect(result).toEqual({ cvars: [], binds: [], execs: [], preserved: [] })
  })
})
