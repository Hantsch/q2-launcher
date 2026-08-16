import { describe, expect, it } from 'vitest'
import {
  ALIAS_LOOP_COUNT,
  CBUF_LINE_BYTES,
  MAX_ALIAS_NAME,
  compressedLength,
  evaluateSize,
  limitsFor,
} from './engine-limits'

describe('limitsFor', () => {
  it('r1q2: 65534-byte buffer, truncates on overflow, measures raw bytes', () => {
    const limits = limitsFor('r1q2')
    expect(limits).toBeDefined()
    expect(limits?.execBufferBytes).toBe(65534)
    expect(limits?.overflowDiscardsWholeFile).toBe(false)
    expect(limits?.sizeCountsAfterCompression).toBe(false)
    expect(limits?.writtenConfigName).toBe('q2config.cfg')
  })

  it('q2pro: 65535-byte buffer, discards the whole file (EFBIG), measures compressed bytes', () => {
    const limits = limitsFor('q2pro')
    expect(limits).toBeDefined()
    expect(limits?.execBufferBytes).toBe(65535)
    expect(limits?.overflowDiscardsWholeFile).toBe(true)
    expect(limits?.sizeCountsAfterCompression).toBe(true)
    expect(limits?.writtenConfigName).toBe('q2config.cfg')
  })

  it('vanilla: 8190-byte buffer, discards the whole file, measures raw bytes', () => {
    const limits = limitsFor('vanilla')
    expect(limits).toBeDefined()
    expect(limits?.execBufferBytes).toBe(8190)
    expect(limits?.overflowDiscardsWholeFile).toBe(true)
    expect(limits?.sizeCountsAfterCompression).toBe(false)
    expect(limits?.writtenConfigName).toBe('config.cfg')
  })

  it('shares the same line/alias/loop limits across all three in-scope engines', () => {
    for (const engine of ['r1q2', 'q2pro', 'vanilla'] as const) {
      const limits = limitsFor(engine)
      expect(limits?.maxLineBytes).toBe(CBUF_LINE_BYTES)
      expect(limits?.maxAliasNameLength).toBe(MAX_ALIAS_NAME)
      expect(limits?.aliasLoopCount).toBe(ALIAS_LOOP_COUNT)
    }
  })

  it('yields no limits for an out-of-scope engine, never r1q2 as a fallback', () => {
    const limits = limitsFor('yquake2')
    expect(limits).toBeUndefined()
    expect(limitsFor('kmquake2')).toBeUndefined()
    expect(limitsFor('unknown')).toBeUndefined()
  })
})

describe('compressedLength', () => {
  it('strips a // comment and collapses the surrounding whitespace to one newline', () => {
    // "foo  // bar\nbaz" -> comment and its leading spaces disappear, the
    // newline that ended the comment collapses to a single output newline,
    // leaving exactly "foo\nbaz" worth of counted bytes (7).
    const text = 'foo  // bar\nbaz'
    expect(compressedLength(text)).toBe(7)
    expect(compressedLength(text)).toBeLessThan(text.length)
  })

  it('copies a quoted string through untouched, comment markers included', () => {
    const text = 'say "look // not a comment"'
    // Everything from the opening to the closing quote is copied verbatim:
    // the quotes themselves plus their contents, "say " counted as a word.
    expect(compressedLength(text)).toBe(text.length)
  })

  it('drops a backslash-newline line continuation entirely', () => {
    // The continuation disappears without leaving a joining space behind
    // beyond the one that was already there, so this reads the same as the
    // two words separated by a single ordinary space.
    expect(compressedLength('foo \\\nbar')).toBe(compressedLength('foo bar'))
  })
})

describe('evaluateSize', () => {
  // A file that is mostly `//` comments: large on disk, but Q2PRO's
  // COM_Compress strips every comment line down to nothing before measuring.
  const commentLine = `// ${'x'.repeat(60)}\n`
  const bloated = commentLine.repeat(1100) // ~70,400 raw bytes
  const bytes = bloated.length

  it('overflows on r1q2 (measured raw) but fits comfortably on q2pro (measured compressed)', () => {
    expect(bytes).toBeGreaterThan(65534)
    expect(compressedLength(bloated)).toBe(0)

    const r1q2 = evaluateSize(bytes, 'r1q2', bloated)
    expect(r1q2).toBeDefined()
    expect(r1q2?.effectiveBytes).toBe(bytes)
    expect(r1q2?.level).toBe('over')
    expect(r1q2?.overflowDiscardsWholeFile).toBe(false) // truncates, does not discard

    const q2pro = evaluateSize(bytes, 'q2pro', bloated)
    expect(q2pro).toBeDefined()
    expect(q2pro?.effectiveBytes).toBe(0)
    expect(q2pro?.level).toBe('ok')
    expect(q2pro?.overflowDiscardsWholeFile).toBe(true) // would discard, but it never overflows here
  })

  it('warns above 80% of the limit and reports over once it is exceeded', () => {
    const limit = limitsFor('vanilla')!.execBufferBytes
    expect(evaluateSize(Math.floor(limit * 0.5), 'vanilla')?.level).toBe('ok')
    expect(evaluateSize(Math.floor(limit * 0.85), 'vanilla')?.level).toBe('warn')
    expect(evaluateSize(limit + 1, 'vanilla')?.level).toBe('over')
    expect(evaluateSize(limit + 1, 'vanilla')?.overflowDiscardsWholeFile).toBe(true)
  })

  it('yields no budget for an out-of-scope engine', () => {
    expect(evaluateSize(100, 'yquake2')).toBeUndefined()
  })
})
