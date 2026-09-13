import { describe, expect, it } from 'vitest'
import {
  RELEASE_NOTES_MAX_ITEMS_PER_SECTION,
  RELEASE_NOTES_MAX_ITEM_LENGTH,
  RELEASE_NOTES_MAX_INPUT_CHARS,
  RELEASE_NOTES_MAX_SECTIONS,
  extractVersionSection,
  parseReleaseNotes,
} from './release-notes'

/** A realistic Keep a Changelog body, mirroring the repo's own `CHANGELOG.md` conventions. */
const REAL_BODY = `### Added

- **Your library** — find installations automatically, add a folder yourself, or start a fresh
  one from scratch.
- **Config profiles** — create one from a template, empty, as a copy, or from an imported
  \`config.cfg\`.

### Changed

- **Settings** — cvars your engine doesn't have are named, not hidden.

### Fixed

- Fixed a crash when launching with no active installation ([#42](https://example.com/42)).
`

describe('parseReleaseNotes', () => {
  it('parses a real Keep-a-Changelog body into its groups, in order', () => {
    const sections = parseReleaseNotes(REAL_BODY)

    expect(sections.map((s) => s.heading)).toEqual(['Added', 'Changed', 'Fixed'])
    expect(sections[0].items).toEqual([
      'Your library — find installations automatically, add a folder yourself, or start a fresh one from scratch.',
      'Config profiles — create one from a template, empty, as a copy, or from an imported config.cfg.',
    ])
    expect(sections[1].items).toEqual([
      "Settings — cvars your engine doesn't have are named, not hidden.",
    ])
    expect(sections[2].items).toEqual([
      'Fixed a crash when launching with no active installation (#42).',
    ])
  })

  it('parses a bare fragment with no top-level version header (R6: pending-update body)', () => {
    const sections = parseReleaseNotes('### Added\n\n- A new thing.\n')
    expect(sections).toEqual([{ heading: 'Added', items: ['A new thing.'] }])
  })

  it('returns [] for empty or whitespace-only input', () => {
    expect(parseReleaseNotes('')).toEqual([])
    expect(parseReleaseNotes('   \n\t\n  ')).toEqual([])
  })

  it('drops unknown blocks - tables, code fences, standalone images - rather than passing them through', () => {
    const markdown = `### Added

- A real item.

| col1 | col2 |
| --- | --- |
| a | b |

\`\`\`js
- this looks like an item but is inside a fence
\`\`\`

![alt text](https://example.com/pic.png)

- Another real item.
`
    const sections = parseReleaseNotes(markdown)
    expect(sections).toEqual([{ heading: 'Added', items: ['A real item.', 'Another real item.'] }])
  })

  it('keeps raw HTML as literal text inside an item, never as structure', () => {
    const markdown = `### Security

- Sanitize input: <img src=x onerror="alert(1)">
- Blocks inline scripts like <script>alert(1)</script> from executing.
`
    const sections = parseReleaseNotes(markdown)
    expect(sections).toHaveLength(1)
    expect(sections[0].items).toEqual([
      'Sanitize input: <img src=x onerror="alert(1)">',
      'Blocks inline scripts like <script>alert(1)</script> from executing.',
    ])
    // Still exactly one section, two items - the HTML never created extra structure.
    expect(sections[0].items.every((item) => typeof item === 'string')).toBe(true)
  })

  it('truncates instead of throwing once input exceeds the character cap', () => {
    const huge = '### Added\n\n' + '- item\n'.repeat(RELEASE_NOTES_MAX_INPUT_CHARS)
    expect(huge.length).toBeGreaterThan(RELEASE_NOTES_MAX_INPUT_CHARS)

    expect(() => parseReleaseNotes(huge)).not.toThrow()
    const sections = parseReleaseNotes(huge)
    expect(sections.length).toBeLessThanOrEqual(RELEASE_NOTES_MAX_SECTIONS)
  })

  it('caps the number of sections recognised', () => {
    let markdown = ''
    for (let i = 0; i < RELEASE_NOTES_MAX_SECTIONS + 10; i++) {
      markdown += `### Section ${i}\n\n- item\n\n`
    }
    const sections = parseReleaseNotes(markdown)
    expect(sections.length).toBe(RELEASE_NOTES_MAX_SECTIONS)
  })

  it('caps the number of items per section', () => {
    let markdown = '### Added\n\n'
    for (let i = 0; i < RELEASE_NOTES_MAX_ITEMS_PER_SECTION + 10; i++) {
      markdown += `- item ${i}\n`
    }
    const sections = parseReleaseNotes(markdown)
    expect(sections[0].items.length).toBe(RELEASE_NOTES_MAX_ITEMS_PER_SECTION)
  })

  it('caps the length of a single item', () => {
    const longItem = 'x'.repeat(RELEASE_NOTES_MAX_ITEM_LENGTH + 500)
    const markdown = `### Added\n\n- ${longItem}\n`
    const sections = parseReleaseNotes(markdown)
    expect(sections[0].items[0].length).toBe(RELEASE_NOTES_MAX_ITEM_LENGTH)
  })
})

describe('extractVersionSection', () => {
  const changelog = `# Changelog

## Unreleased

### Added

- Something not yet released.

## 1.2.0 — 2026-08-01

### Added

- Feature A.

### Fixed

- Bug B.

## 1.1.0 - 2026-06-15

### Added

- Older feature.
`

  it('resolves exactly one version section by its heading', () => {
    const result = extractVersionSection(changelog, '1.2.0')
    expect(result).not.toBeNull()
    expect(result?.version).toBe('1.2.0')
    expect(result?.date).toBe('2026-08-01')
    expect(result?.body).toContain('### Added')
    expect(result?.body).toContain('Feature A.')
    expect(result?.body).toContain('### Fixed')
    expect(result?.body).toContain('Bug B.')
    // Must not bleed into the next version's section.
    expect(result?.body).not.toContain('Older feature.')

    const parsed = parseReleaseNotes(result!.body)
    expect(parsed.map((s) => s.heading)).toEqual(['Added', 'Fixed'])
  })

  it('returns null when the version has no section', () => {
    expect(extractVersionSection(changelog, '9.9.9')).toBeNull()
  })

  it('returns null for empty changelog input', () => {
    expect(extractVersionSection('', '1.0.0')).toBeNull()
  })
})
