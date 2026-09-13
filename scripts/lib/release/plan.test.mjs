import { describe, expect, test } from 'vitest'
import { UNRELEASED_PLACEHOLDER } from './changelog.mjs'
import { planRelease, ReleaseRefused } from './plan.mjs'

/**
 * Story 096 D1 (AC2, AC3, AC5, AC6, AC7) — these tests ARE the acceptance criteria, verbatim from
 * the story. Each asserts a user/CI-observable outcome (a refusal reason, a specific write, a
 * specific command count), not just whatever the implementation happens to emit.
 */

const PKG_TEXT = JSON.stringify({ name: 'q2-launcher', version: '1.0.0-beta.1' }, null, 2) + '\n'
const LOCK_TEXT =
  JSON.stringify(
    {
      name: 'q2-launcher',
      version: '1.0.0-beta.1',
      lockfileVersion: 3,
      packages: { '': { name: 'q2-launcher', version: '1.0.0-beta.1' } },
    },
    null,
    2,
  ) + '\n'

const POPULATED_CHANGELOG = `# Changelog

## Unreleased

### Added
- a new thing

### Fixed
- a bug

## 1.0.0-beta.1 — 2026-01-01

### Added
- the first beta
`

const EMPTY_CHANGELOG = `# Changelog

## Unreleased

${UNRELEASED_PLACEHOLDER}

## 1.0.0-beta.1 — 2026-01-01

### Added
- the first beta
`

/** @param {Partial<Parameters<typeof planRelease>[0]>} overrides */
function baseInput(overrides = {}) {
  return {
    changelogText: POPULATED_CHANGELOG,
    pkgText: PKG_TEXT,
    lockText: LOCK_TEXT,
    tags: [],
    requestedVersion: undefined,
    bump: undefined,
    dryRun: false,
    isCi: true,
    today: '2026-03-01',
    ...overrides,
  }
}

describe('planRelease — AC2: an empty Unreleased section refuses with a reason and plans no writes', () => {
  test('literally empty Unreleased refuses with a readable reason', () => {
    let caught
    try {
      planRelease(baseInput({ changelogText: EMPTY_CHANGELOG.replace(UNRELEASED_PLACEHOLDER, '') }))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ReleaseRefused)
    expect(caught.reason).toBeTypeOf('string')
    expect(caught.reason.length).toBeGreaterThan(0)
  })

  test('placeholder-only Unreleased refuses with a readable reason', () => {
    let caught
    try {
      planRelease(baseInput({ changelogText: EMPTY_CHANGELOG }))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ReleaseRefused)
    expect(caught.reason).toBeTypeOf('string')
    expect(caught.reason.length).toBeGreaterThan(0)
  })
})

describe('planRelease — AC3: a release promotes Unreleased, writes version files, plans one commit and one tag', () => {
  test('promotes changelog, writes package.json/lockfile, plans exactly one commit and one tag', () => {
    const result = planRelease(baseInput())

    // Version: prerelease current version + Added present → bump ticks the beta counter (D1's
    // prerelease-aware nextVersion), not a jump straight to a stable release.
    expect(result.version).toBe('1.0.0-beta.2')
    expect(result.tag).toBe('v1.0.0-beta.2')

    const changelogWrite = result.writes.find((w) => w.path === 'CHANGELOG.md')
    expect(changelogWrite).toBeDefined()
    expect(changelogWrite.content).toContain('## 1.0.0-beta.2 — 2026-03-01')
    expect(changelogWrite.content).toContain('- a new thing')
    expect(changelogWrite.content).toContain('- a bug')
    // Unreleased itself is emptied back to the placeholder - no stale bullets survive promotion.
    // Find the next *heading line* (not just any "## " substring, which the placeholder comment's
    // own "### Added" / "### Changed" mentions would otherwise false-match).
    const unreleasedIndex = changelogWrite.content.indexOf('## Unreleased')
    const nextHeadingMatch = /\n## /.exec(changelogWrite.content.slice(unreleasedIndex + 1))
    const nextHeadingIndex = unreleasedIndex + 1 + nextHeadingMatch.index
    const unreleasedBody = changelogWrite.content.slice(unreleasedIndex, nextHeadingIndex)
    expect(unreleasedBody).not.toContain('- a new thing')
    expect(unreleasedBody).toContain(UNRELEASED_PLACEHOLDER)

    const pkgWrite = result.writes.find((w) => w.path === 'package.json')
    expect(pkgWrite.content).toContain('"version": "1.0.0-beta.2"')

    const lockWrite = result.writes.find((w) => w.path === 'package-lock.json')
    expect(lockWrite.content).toContain('"version": "1.0.0-beta.2"')

    const commitCommands = result.commands.filter((c) => c.kind === 'git-commit')
    const tagCommands = result.commands.filter((c) => c.kind === 'git-tag')
    expect(commitCommands.length).toBe(1)
    expect(tagCommands.length).toBe(1)
  })
})

describe('planRelease — AC5: a dry run yields the version and the notes but no git or gh commands', () => {
  test('version and notes are computed but commands is empty', () => {
    const result = planRelease(baseInput({ dryRun: true }))
    expect(result.version).toBe('1.0.0-beta.2')
    expect(result.notes).toBeTypeOf('string')
    expect(result.notes.length).toBeGreaterThan(0)
    expect(result.commands).toEqual([])
  })
})

describe('planRelease — AC7: a second run on an unchanged tree refuses', () => {
  test('refuses when Unreleased is already empty (post-promotion state)', () => {
    expect(() => planRelease(baseInput({ changelogText: EMPTY_CHANGELOG }))).toThrow(
      ReleaseRefused,
    )
  })

  test('refuses when the target tag already exists, even with a populated Unreleased', () => {
    expect(() =>
      planRelease(baseInput({ tags: ['v1.0.0-beta.2'] })),
    ).toThrow(ReleaseRefused)
  })
})

describe('planRelease — AC6: an explicit version and an explicit bump each override the derived one', () => {
  test('requestedVersion wins outright, regardless of what categories would derive', () => {
    const result = planRelease(baseInput({ requestedVersion: '3.0.0' }))
    expect(result.version).toBe('3.0.0')
    expect(result.tag).toBe('v3.0.0')
  })

  test('an explicit bump overrides the category-derived one, even while current is a prerelease', () => {
    // Unreleased here only has Added (→ minor derived); force major via explicit bump instead.
    // Bug fix: an explicit --bump now overrides the prerelease-increment path too — it no longer
    // "masks the bump choice" as an earlier version of this test assumed. `baseInput()`'s current
    // version is still the default prerelease (1.0.0-beta.1); an explicit major bump ignores the
    // prerelease identifier and produces the corresponding stable release-core bump (`nextVersion`'s
    // `explicit` option).
    const result = planRelease(baseInput({ bump: 'major' }))
    expect(result.version).toBe('2.0.0')
  })
})
