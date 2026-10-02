import { describe, expect, it } from 'vitest'
import { DEMO_RENAME_MAX_STEM, demoExtension, validateDemoRename } from './demo-rename'

describe('demoExtension', () => {
  it('recognises .dm2, .mvd2, .dm2.gz, .mvd2.gz, preserving original case', () => {
    expect(demoExtension('final.dm2')).toBe('.dm2')
    expect(demoExtension('final.mvd2')).toBe('.mvd2')
    expect(demoExtension('final.dm2.gz')).toBe('.dm2.gz')
    expect(demoExtension('final.mvd2.gz')).toBe('.mvd2.gz')
    expect(demoExtension('FINAL.DM2.GZ')).toBe('.DM2.GZ')
  })

  it('returns empty string when nothing recognised matches', () => {
    expect(demoExtension('final.txt')).toBe('')
    expect(demoExtension('final')).toBe('')
  })
})

describe('validateDemoRename', () => {
  it('rejects an empty stem', () => {
    const result = validateDemoRename('   ', 'old.dm2')
    expect(result).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects a stem with a path separator', () => {
    const result = validateDemoRename('foo/bar', 'old.dm2')
    expect(result).toEqual({ ok: false, reason: 'separator' })
  })

  it('rejects a stem containing ..', () => {
    const result = validateDemoRename('foo..bar', 'old.dm2')
    expect(result).toEqual({ ok: false, reason: 'dotDot' })
  })

  it('rejects a stem with an invalid character, reporting the first offender', () => {
    const result = validateDemoRename('foo?bar*baz', 'old.dm2')
    expect(result).toEqual({ ok: false, reason: 'invalidChar', params: { char: '?' } })
  })

  it('rejects a stem with a trailing dot or space', () => {
    expect(validateDemoRename('foo.', 'old.dm2')).toEqual({
      ok: false,
      reason: 'trailingDotOrSpace',
    })
    // trailing whitespace is trimmed first, so a trailing space only survives when it's exposed by
    // stripping a re-typed extension off the (already trimmed) stem
    expect(validateDemoRename('foo .dm2', 'old.dm2')).toEqual({
      ok: false,
      reason: 'trailingDotOrSpace',
    })
  })

  it('rejects reserved device names, case-insensitively', () => {
    expect(validateDemoRename('con', 'old.dm2')).toEqual({
      ok: false,
      reason: 'reserved',
      params: { name: 'con' },
    })
    expect(validateDemoRename('Com1', 'old.dm2')).toEqual({
      ok: false,
      reason: 'reserved',
      params: { name: 'Com1' },
    })
    expect(validateDemoRename('LPT9.notes', 'old.dm2')).toEqual({
      ok: false,
      reason: 'reserved',
      params: { name: 'LPT9' },
    })
  })

  it('rejects a stem longer than DEMO_RENAME_MAX_STEM', () => {
    const stem = 'a'.repeat(DEMO_RENAME_MAX_STEM + 1)
    const result = validateDemoRename(stem, 'old.dm2')
    expect(result).toEqual({ ok: false, reason: 'tooLong', params: { max: 100 } })
  })

  it('keeps the extension for all four recognised extensions', () => {
    expect(validateDemoRename('new-name', 'old.dm2')).toEqual({
      ok: true,
      fileName: 'new-name.dm2',
    })
    expect(validateDemoRename('new-name', 'old.mvd2')).toEqual({
      ok: true,
      fileName: 'new-name.mvd2',
    })
    expect(validateDemoRename('new-name', 'old.dm2.gz')).toEqual({
      ok: true,
      fileName: 'new-name.dm2.gz',
    })
    expect(validateDemoRename('new-name', 'old.mvd2.gz')).toEqual({
      ok: true,
      fileName: 'new-name.mvd2.gz',
    })
  })

  it('preserves the extension case from a mixed-case current file name', () => {
    const result = validateDemoRename('new-name', 'FINAL.DM2.GZ')
    expect(result).toEqual({ ok: true, fileName: 'new-name.DM2.GZ' })
  })

  it('strips a re-typed extension once instead of doubling it', () => {
    const result = validateDemoRename('final.dm2', 'old.dm2')
    expect(result).toEqual({ ok: true, fileName: 'final.dm2' })
  })

  it('accepts a stem with spaces and a single inner dot', () => {
    const result = validateDemoRename('finale vs tom pt.2', 'old.dm2')
    expect(result).toEqual({ ok: true, fileName: 'finale vs tom pt.2.dm2' })
  })
})
