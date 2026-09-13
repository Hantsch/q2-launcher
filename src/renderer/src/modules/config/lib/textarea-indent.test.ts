import { describe, expect, it } from 'vitest'
import { dedentSelection, indentSelection } from './textarea-indent'

const UNIT = '  ' // two-space indent unit, matching the component's default

describe('indentSelection', () => {
  it('indents a single line with a collapsed cursor', () => {
    const text = 'set name "foo"'
    const result = indentSelection(text, 3, 3, UNIT)
    expect(result.text).toBe('  set name "foo"')
    // the cursor sits after the inserted unit, in the same logical spot
    expect(result.selectionStart).toBe(5)
    expect(result.selectionEnd).toBe(5)
  })

  it('indents a single line with a partial-line selection', () => {
    const text = 'set name "foo"'
    // select "name"
    const result = indentSelection(text, 4, 8, UNIT)
    expect(result.text).toBe('  set name "foo"')
    expect(result.selectionStart).toBe(6)
    expect(result.selectionEnd).toBe(10)
  })

  it('indents every line touched by a multi-line selection', () => {
    const text = 'set a "1"\nset b "2"\nset c "3"'
    // selection spans from inside line 1 to inside line 3
    const result = indentSelection(text, 4, 24, UNIT)
    expect(result.text).toBe('  set a "1"\n  set b "2"\n  set c "3"')
  })

  it('recomputes the selection so the same lines stay selected after a multi-line indent', () => {
    const text = 'aaa\nbbb\nccc'
    // select all of "aaa" and "bbb" (start of line 1 to end of line 2)
    const result = indentSelection(text, 0, 7, UNIT)
    expect(result.text).toBe('  aaa\n  bbb\nccc')
    // start was at the very beginning of line 1; its own inserted unit moves it forward too, so
    // the selection still opens right where line 1's (now-indented) content begins
    expect(result.selectionStart).toBe(UNIT.length)
    // end was at offset 7 (end of "bbb"); two lines each gained 2 chars before it
    expect(result.selectionEnd).toBe(7 + UNIT.length * 2)
  })

  it('does not pull in a line the selection only touches at its very start', () => {
    const text = 'aaa\nbbb\nccc'
    // selection ends exactly at the boundary between line 1 and line 2 - line 2 is untouched
    const result = indentSelection(text, 0, 4, UNIT)
    expect(result.text).toBe('  aaa\nbbb\nccc')
  })
})

describe('dedentSelection', () => {
  it('removes a full indent unit from a single line', () => {
    const text = '  set name "foo"'
    const result = dedentSelection(text, 5, 5, UNIT)
    expect(result.text).toBe('set name "foo"')
    expect(result.selectionStart).toBe(3)
    expect(result.selectionEnd).toBe(3)
  })

  it('is a no-op on a line with no leading whitespace', () => {
    const text = 'set name "foo"'
    const result = dedentSelection(text, 3, 3, UNIT)
    expect(result.text).toBe('set name "foo"')
    expect(result.selectionStart).toBe(3)
    expect(result.selectionEnd).toBe(3)
  })

  it('removes only the leading whitespace present when it is shorter than a full unit', () => {
    const text = ' set name "foo"' // one leading space, unit is two
    const result = dedentSelection(text, 4, 4, UNIT)
    expect(result.text).toBe('set name "foo"')
    expect(result.selectionStart).toBe(3)
  })

  it('dedents every line touched by a multi-line selection', () => {
    const text = '  set a "1"\n  set b "2"\n  set c "3"'
    const dedented = dedentSelection(text, 6, 26, UNIT)
    expect(dedented.text).toBe('set a "1"\nset b "2"\nset c "3"')
  })

  it('recomputes the selection so the same lines stay selected after a multi-line dedent', () => {
    const text = '  aaa\n  bbb\nccc'
    // select all of "aaa" and "bbb"
    const result = dedentSelection(text, 0, 11, UNIT)
    expect(result.text).toBe('aaa\nbbb\nccc')
    expect(result.selectionStart).toBe(0)
    expect(result.selectionEnd).toBe(11 - UNIT.length * 2)
  })

  it('leaves lines with mixed indentation state correctly dedented independently', () => {
    const text = '  aaa\nbbb\n  ccc'
    const result = dedentSelection(text, 0, text.length, UNIT)
    expect(result.text).toBe('aaa\nbbb\nccc')
  })
})
