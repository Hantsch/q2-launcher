import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  notesFor,
  parseChangelog,
  promote,
  readUnreleased,
  UNRELEASED_PLACEHOLDER,
  validateUnreleased,
} from './changelog.mjs'

/**
 * Story 096 D1: direct unit coverage of the pure changelog parser/editor, so `plan.test.mjs`'s
 * tests aren't the only thing exercising these functions. Mirrors
 * `src/main/lib/renderer-source.test.ts`'s describe/test style.
 */

const POPULATED = `# Changelog

## Unreleased

### Added
- a new thing

### Fixed
- a bug

## 1.2.0 — 2026-01-01

### Fixed
- an older bug
`

const EMPTY_PLACEHOLDER_ONLY = `# Changelog

## Unreleased

${UNRELEASED_PLACEHOLDER}

## 1.2.0 — 2026-01-01

### Fixed
- an older bug
`

const LITERALLY_EMPTY = `# Changelog

## Unreleased

## 1.2.0 — 2026-01-01

### Fixed
- an older bug
`

const NO_BULLETS_UNDER_CATEGORY = `# Changelog

## Unreleased

### Added

## 1.2.0 — 2026-01-01

### Fixed
- an older bug
`

const NO_UNRELEASED_HEADING = `# Changelog

## 1.2.0 — 2026-01-01

### Fixed
- an older bug
`

// Real bullets wrap across multiple lines with indented continuation, e.g. this repo's own
// CHANGELOG.md. Regression fixture for the bug where `parseSection` only captured `^-\s` lines and
// silently dropped every continuation line that followed.
const MULTILINE_BULLET = `# Changelog

## Unreleased

### Added
- **Your library** — find installations automatically (Steam, GOG, Epic, the classic
  install paths, or an optional deep scan of your drives), add a folder yourself, or start a
  fresh one from scratch; rename, reorder, favourite, relocate and remove entries.
- a short single-line thing

## 1.2.0 — 2026-01-01

### Fixed
- an older bug
`

describe('parseChangelog', () => {
  test('regression: a CRLF changelog parses exactly like its LF twin, so a Windows checkout still releases', () => {
    const crlf = POPULATED.replace(/\n/g, '\r\n')

    expect(parseChangelog(crlf)).toEqual(parseChangelog(POPULATED))
    // The failure this guards against was not a parse error but a silent refusal: every section
    // read as preamble, so the release aborted claiming Unreleased was empty.
    expect(validateUnreleased(crlf)).toBeNull()
  })
})

describe('readUnreleased', () => {
  test('collects categories and bullets in order across categories', () => {
    const result = readUnreleased(POPULATED)
    expect(result.categories).toEqual(['Added', 'Fixed'])
    expect(result.bullets).toEqual(['a new thing', 'a bug'])
    expect(result.hasBreaking).toBe(false)
  })

  test('detects a **BREAKING** bullet', () => {
    const text = POPULATED.replace('- a new thing', '- **BREAKING** removed the old thing')
    const result = readUnreleased(text)
    expect(result.hasBreaking).toBe(true)
  })

  test('returns empty categories/bullets when Unreleased has no sub-headings', () => {
    const result = readUnreleased(LITERALLY_EMPTY)
    expect(result.categories).toEqual([])
    expect(result.bullets).toEqual([])
  })

  test('a multi-line bullet is captured whole, continuation lines and all, not truncated', () => {
    const result = readUnreleased(MULTILINE_BULLET)
    expect(result.bullets).toEqual([
      '**Your library** — find installations automatically (Steam, GOG, Epic, the classic\n' +
        '  install paths, or an optional deep scan of your drives), add a folder yourself, or start a\n' +
        '  fresh one from scratch; rename, reorder, favourite, relocate and remove entries.',
      'a short single-line thing',
    ])
  })
})

describe('validateUnreleased', () => {
  test('passes (returns null) for a populated Unreleased section', () => {
    expect(validateUnreleased(POPULATED)).toBeNull()
  })

  test('refuses when Unreleased is literally empty', () => {
    const reason = validateUnreleased(LITERALLY_EMPTY)
    expect(reason).toBeTypeOf('string')
    expect(reason.length).toBeGreaterThan(0)
  })

  test('refuses when Unreleased contains only the placeholder comment', () => {
    const reason = validateUnreleased(EMPTY_PLACEHOLDER_ONLY)
    expect(reason).toBeTypeOf('string')
    expect(reason.length).toBeGreaterThan(0)
  })

  test('refuses when Unreleased has a category heading but zero bullets', () => {
    const reason = validateUnreleased(NO_BULLETS_UNDER_CATEGORY)
    expect(reason).toBeTypeOf('string')
    expect(reason.length).toBeGreaterThan(0)
  })

  test('refuses with a readable reason when the "## Unreleased" heading is missing entirely', () => {
    const reason = validateUnreleased(NO_UNRELEASED_HEADING)
    expect(reason).toBeTypeOf('string')
    expect(reason.length).toBeGreaterThan(0)
  })
})

describe('promote', () => {
  test('moves Unreleased content into a new dated version section and empties Unreleased', () => {
    const result = promote(POPULATED, '1.3.0', '2026-03-01')

    // The new dated section exists and holds exactly what Unreleased used to hold.
    expect(result).toContain('## 1.3.0 — 2026-03-01')
    const promotedSection = parseChangelog(result).prior.find((s) =>
      s.heading.startsWith('1.3.0'),
    )
    expect(promotedSection).toBeDefined()
    expect(promotedSection.categories).toEqual([
      { name: 'Added', bullets: ['a new thing'] },
      { name: 'Fixed', bullets: ['a bug'] },
    ])

    // Unreleased itself is back to just the scaffold placeholder - no stale bullets survive.
    const { unreleased } = parseChangelog(result)
    expect(unreleased.categories).toEqual([])
    expect(unreleased.raw).toContain(UNRELEASED_PLACEHOLDER)

    // The prior version section is preserved untouched.
    expect(result).toContain('## 1.2.0 — 2026-01-01')
    expect(result).toContain('- an older bug')
  })

  test('the new section is inserted directly below the emptied Unreleased section', () => {
    const result = promote(POPULATED, '1.3.0', '2026-03-01')
    const unreleasedIndex = result.indexOf('## Unreleased')
    const newSectionIndex = result.indexOf('## 1.3.0 — 2026-03-01')
    const priorSectionIndex = result.indexOf('## 1.2.0 — 2026-01-01')
    expect(unreleasedIndex).toBeGreaterThanOrEqual(0)
    expect(newSectionIndex).toBeGreaterThan(unreleasedIndex)
    expect(priorSectionIndex).toBeGreaterThan(newSectionIndex)
  })

  test('a multi-line bullet survives promotion verbatim, not truncated to its first line', () => {
    const result = promote(MULTILINE_BULLET, '1.3.0', '2026-03-01')
    expect(result).toContain(
      '- **Your library** — find installations automatically (Steam, GOG, Epic, the classic\n' +
        '  install paths, or an optional deep scan of your drives), add a folder yourself, or start a\n' +
        '  fresh one from scratch; rename, reorder, favourite, relocate and remove entries.',
    )
  })

  test('regression: promote() on the real repo CHANGELOG.md does not truncate its multi-line bullets', () => {
    const realChangelogPath = fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url))
    const realChangelogText = readFileSync(realChangelogPath, 'utf-8')

    // Sanity check the fixture assumption: the real file does contain a bullet that wraps, with a
    // continuation-only substring that would be silently dropped by the truncating parser.
    expect(realChangelogText).toContain('and manage your own favourites and address sources.')

    const result = promote(realChangelogText, '9.9.9', '2026-01-01')

    // The whole sentence must survive intact across its original line breaks, not cut mid-word
    // after "and see live status" (the pre-fix behaviour) and not reflowed onto one line either.
    expect(result).toContain(
      '- **Servers** — a full server browser: scan, filter and sort the list, see live status and\n' +
        '  full server rules, join or spectate in one click, keep a watchlist of players across servers,\n' +
        '  and manage your own favourites and address sources.',
    )
  })
})

describe('notesFor', () => {
  test('returns the promoted section body without the heading line', () => {
    const promoted = promote(POPULATED, '1.3.0', '2026-03-01')
    const notes = notesFor(promoted, '1.3.0')
    expect(notes).not.toContain('## 1.3.0')
    expect(notes).toContain('### Added')
    expect(notes).toContain('- a new thing')
    expect(notes).toContain('### Fixed')
    expect(notes).toContain('- a bug')
  })

  test('throws when no section for the requested version exists', () => {
    expect(() => notesFor(POPULATED, '9.9.9')).toThrow()
  })
})
