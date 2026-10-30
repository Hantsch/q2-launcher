import { describe, expect, it } from 'vitest'
import {
  commentRanges,
  isTestFile,
  listSourceFiles,
  maskLiterals,
  readRepoFile,
} from '../test-support/source-tree'

/**
 * A bare catch is a `catch` clause (not a promise `.catch(…)`) in non-test main-process code that
 * neither reads its binding, nor carries a comment on its `catch` line or its block's first line,
 * nor calls `.caught(` — see "A bare `catch` says what it swallows" in docs/ARCHITECTURE.md.
 *
 * The scan is textual (TS 7 ships no JS compiler API): comments and literal text are masked offset
 * for offset first, so braces in a template or regex and `catch` in a string or comment cannot
 * mislead the brace pairing. A clause is a `catch` right after a `}` whose `{` follows `try`; any
 * other `catch` that is not a member access is reported as unrecognised rather than skipped, so a
 * form the scanner does not understand fails the check instead of hiding a bare catch.
 *
 * `BARE_CATCH_REPORT=1 npx vitest run src/main/catch-policy.test.ts` prints every bare catch as
 * `file:line`; the failure message carries the same report.
 */

// A comment that only says "swallowed" names no failure class, so it does not explain a catch.
const TRIVIAL_COMMENT = /^(?:ignored?|swallow|best effort|noop|nothing to do)[.!:;,]*$/i

interface CatchScan {
  /** 1-based line of each bare catch's `catch` keyword. */
  bare: number[]
  /** Number of `catch` clauses found, bare or not. */
  clauses: number
  /** 1-based lines of `catch` words that are neither a clause nor a member access. */
  unrecognised: number[]
}

function pairForward(masked: string, open: number): number {
  const opener = masked[open]
  const closer = opener === '(' ? ')' : '}'
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === opener) depth++
    else if (masked[i] === closer && --depth === 0) return i
  }
  return -1
}

function pairBackward(masked: string, close: number): number {
  let depth = 0
  for (let i = close; i >= 0; i--) {
    if (masked[i] === '}') depth++
    else if (masked[i] === '{' && --depth === 0) return i
  }
  return -1
}

function skipSpace(masked: string, from: number): number {
  let i = from
  while (i < masked.length && /\s/.test(masked[i])) i++
  return i
}

function bindingNames(binding: string): string[] {
  const trimmed = binding.trim()
  // A destructured binding counts as read when any name in its pattern is read.
  if (trimmed.startsWith('{') || trimmed.startsWith('['))
    return trimmed.match(/[A-Za-z_$][\w$]*/g) ?? []
  const name = /^[A-Za-z_$][\w$]*/.exec(trimmed)
  return name ? [name[0]] : []
}

// A read is the bare name, not a property of the same name (`state.error`); a spread `...error` is.
const readsName = (body: string, name: string): boolean =>
  new RegExp(String.raw`(?<![\w$])(?<![^.]\.)${name.replace(/\$/g, '\\$')}(?![\w$])`).test(body)

function commentText(raw: string): string {
  return raw
    .replace(/^\/\/|^\/\*|\*\/$/g, '')
    .replace(/^\s*\*+/gm, '')
    .trim()
}

export function scanCatches(source: string): CatchScan {
  const masked = maskLiterals(source)
  const lineStarts = [0]
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1))
    lineStarts.push(i + 1)
  const lineOf = (offset: number): number => {
    let line = 0
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++
    return line + 1
  }
  const explaining = commentRanges(source).filter((range) => {
    const text = commentText(range.text)
    return text !== '' && !TRIVIAL_COMMENT.test(text)
  })
  const commentedLine = (line: number): boolean =>
    explaining.some((range) => range.startLine <= line && line <= range.endLine)

  const scan: CatchScan = { bare: [], clauses: 0, unrecognised: [] }
  for (const match of masked.matchAll(/(?<![\w$])catch(?![\w$])/g)) {
    const at = match.index
    const before = masked.slice(0, at).trimEnd()
    if (before.endsWith('.')) continue
    const tryOpen = before.endsWith('}') ? pairBackward(masked, before.length - 1) : -1
    if (tryOpen === -1 || !/(?<![\w$])try\s*$/.test(masked.slice(0, tryOpen))) {
      scan.unrecognised.push(lineOf(at))
      continue
    }
    let cursor = skipSpace(masked, at + 'catch'.length)
    let names: string[] = []
    if (masked[cursor] === '(') {
      const close = pairForward(masked, cursor)
      names = bindingNames(masked.slice(cursor + 1, close))
      cursor = skipSpace(masked, close + 1)
    }
    const blockClose = masked[cursor] === '{' ? pairForward(masked, cursor) : -1
    if (blockClose === -1) {
      scan.unrecognised.push(lineOf(at))
      continue
    }
    scan.clauses++
    const body = masked.slice(cursor + 1, blockClose)
    if (names.some((name) => readsName(body, name))) continue
    if (/\.caught\s*\(/.test(body)) continue
    const firstContent = source.slice(cursor + 1, blockClose).search(/\S/)
    const lines = [lineOf(at), lineOf(cursor)]
    if (firstContent !== -1) lines.push(lineOf(cursor + 1 + firstContent))
    if (lines.some(commentedLine)) continue
    scan.bare.push(lineOf(at))
  }
  return scan
}

describe('catch policy', () => {
  it('the bare-catch scanner flags a binding-less catch and an unused binding, and accepts a commented, logged or rethrowing one', () => {
    const bindingLess = ['try {', '  run()', '} catch {', '  return null', '}'].join('\n')
    expect(scanCatches(bindingLess).bare).toEqual([3])

    // Braces inside template text, a template expression and a regex must not shift the pairing,
    // and the binding's name inside template text is not a read.
    const unusedBinding = [
      'const label = `{ not a block ${ { a: 1 }.a } }`',
      'const brace = /\\}/',
      'try {',
      '  run(`}${label}{`)',
      '} catch (error) {',
      '  return `{ ${"}"} error }`',
      '}',
    ].join('\n')
    expect(scanCatches(unusedBinding)).toEqual({ bare: [5], clauses: 1, unrecognised: [] })

    const propertyOnly = ['try { run() } catch (error) {', '  report(state.error)', '}'].join('\n')
    expect(scanCatches(propertyOnly).bare).toEqual([1])

    const nested = [
      'try {',
      '  try {',
      '    a()',
      '  } catch (inner) {',
      '    throw inner',
      '  }',
      '} catch {',
      '  try { b() } catch { c() }',
      '}',
    ].join('\n')
    expect(scanCatches(nested)).toEqual({ bare: [7, 8], clauses: 3, unrecognised: [] })

    const trivial = [
      'try { a() } catch { // ignore',
      '}',
      'try { a() } catch {',
      '  /* Best effort. */',
      '}',
    ].join('\n')
    expect(scanCatches(trivial).bare).toEqual([1, 3])

    const accepted = [
      'try { a() } catch { // the file may not exist yet',
      '}',
      'try {',
      '  a()',
      '} catch {',
      '  // the directory may already be gone',
      '  return null',
      '}',
      'try { a() } catch (error) {',
      "  log.caught('reading the cache failed', error)",
      '}',
      "try { a() } catch { log.caught('reading the cache failed', undefined) }",
      'try { a() } catch (e) {',
      '  cleanup()',
      '  throw e',
      '}',
      'try { a() } catch (err: unknown) { return { ...err } } finally { b() }',
    ].join('\n')
    expect(scanCatches(accepted)).toEqual({ bare: [], clauses: 6, unrecognised: [] })

    const notClauses = [
      'promise.catch(() => {})',
      'maybe?.catch((error) => undefined)',
      "const text = '} catch {'",
      '// try { a() } catch { b() }',
      'try { a() } finally { b() }',
    ].join('\n')
    expect(scanCatches(notClauses)).toEqual({ bare: [], clauses: 0, unrecognised: [] })
  })

  it('no bare catch in src/main', () => {
    const files = listSourceFiles('src/main').filter(
      // A `.test-helpers.ts` file is imported by tests only, so it is test code too.
      (file) => file.endsWith('.ts') && !isTestFile(file) && !file.endsWith('.test-helpers.ts'),
    )
    const locations: string[] = []
    const unrecognised: string[] = []
    let clauses = 0
    for (const file of files) {
      const scan = scanCatches(readRepoFile(file))
      clauses += scan.clauses
      unrecognised.push(...scan.unrecognised.map((line) => `${file}:${line}`))
      locations.push(...scan.bare.map((line) => `${file}:${line}`))
    }

    const report = [
      `${locations.length} bare of ${clauses} catch clauses in ${files.length} files`,
      'bare catches:',
      ...locations,
    ].join('\n')
    if (process.env.BARE_CATCH_REPORT) console.log(report)

    expect(unrecognised, 'catch words the scanner could not classify').toEqual([])
    expect(locations, report).toEqual([])
  })
})
