import { describe, expect, it } from 'vitest'
import { CONSOLE_LINE_MAX, validateConsoleLine } from './console-line'

describe('validateConsoleLine', () => {
  it('a single printable line up to 255 chars is accepted and trimmed', () => {
    expect(validateConsoleLine('  say hello  ')).toEqual({ ok: true, line: 'say hello' })
    const max = 'a'.repeat(CONSOLE_LINE_MAX)
    expect(CONSOLE_LINE_MAX).toBe(255)
    expect(validateConsoleLine(max)).toEqual({ ok: true, line: max })
  })

  it('a line break is rejected as multiline', () => {
    for (const raw of ['a\nb', 'a\r\nb', 'a\rb', 'say hi\n']) {
      expect(validateConsoleLine(raw)).toEqual({ ok: false, reason: 'multiline' })
    }
  })

  it('a control character is rejected', () => {
    for (const raw of ['a\tb', 'a\x00b', 'a\x1bb', 'a\x7fb']) {
      expect(validateConsoleLine(raw)).toEqual({ ok: false, reason: 'control' })
    }
  })

  it('a non-ASCII character is rejected', () => {
    for (const raw of ['grüß', 'say \u{1F600}', 'a b']) {
      expect(validateConsoleLine(raw)).toEqual({ ok: false, reason: 'nonAscii' })
    }
  })

  it('256 characters are rejected as too long', () => {
    expect(validateConsoleLine('a'.repeat(CONSOLE_LINE_MAX + 1))).toEqual({ ok: false, reason: 'tooLong' })
  })

  it('whitespace only is empty', () => {
    expect(validateConsoleLine('')).toEqual({ ok: false, reason: 'empty' })
    expect(validateConsoleLine('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('quotes, semicolons and $ are accepted', () => {
    const line = 'echo "a"; set x $y // note'
    expect(validateConsoleLine(line)).toEqual({ ok: true, line })
  })
})
