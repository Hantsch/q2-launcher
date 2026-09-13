import { describe, expect, it, vi } from 'vitest'

/**
 * Story 099 D2. Two things are under test here, and only the first is about parsing:
 *
 *  1. `resolveReleaseNotes` picks exactly one version's section out of a multi-version changelog
 *     (R4) and says `null` - not an error - when the running version has none (AC5).
 *  2. The `?raw` import in `release-notes.ts` actually carries the repo's changelog text. That is
 *     the part that can only break silently: a mis-resolved or externalised `?raw` inline yields an
 *     empty string, About renders an empty state forever, and nothing else complains. Asserting it
 *     here means the same failure is caught under vitest, not first at package time.
 *
 * `electron` is mocked the same minimal way as the other main-process tests (`ipc/app.test.ts`),
 * just enough for `app.getVersion()` to be answerable.
 */

vi.mock('electron', () => ({
  app: { getVersion: () => '2.0.0' },
}))

const FIXTURE_CHANGELOG = `# Changelog

## Unreleased

### Added

- something not released yet

## 2.0.0 — 2026-09-13

### Added

- the thing this version brought

### Fixed

- a **bold** bug and a \`cvar\`

## 1.0.0 - 2026-01-02

### Added

- the first release
`

describe('resolveReleaseNotes', () => {
  it('picks the running version out of a multi-version changelog, and only that one', async () => {
    const { resolveReleaseNotes } = await import('./release-notes')

    const notes = resolveReleaseNotes(FIXTURE_CHANGELOG, '2.0.0')

    expect(notes).toEqual({
      version: '2.0.0',
      date: '2026-09-13',
      sections: [
        { heading: 'Added', items: ['the thing this version brought'] },
        { heading: 'Fixed', items: ['a bold bug and a cvar'] },
      ],
    })
  })

  it('picks an older version when that is the one running, without bleeding the newer one in', async () => {
    const { resolveReleaseNotes } = await import('./release-notes')

    const notes = resolveReleaseNotes(FIXTURE_CHANGELOG, '1.0.0')

    expect(notes).toEqual({
      version: '1.0.0',
      date: '2026-01-02',
      sections: [{ heading: 'Added', items: ['the first release'] }],
    })
  })

  it('returns null for a version the changelog has no section for', async () => {
    const { resolveReleaseNotes } = await import('./release-notes')

    // A dev build's version, or a bump whose entry isn't written yet - AC5's empty state.
    expect(resolveReleaseNotes(FIXTURE_CHANGELOG, '3.1.4')).toBeNull()
    expect(resolveReleaseNotes('', '2.0.0')).toBeNull()
  })
})

describe('the bundled changelog', () => {
  it('is the real CHANGELOG.md text, inlined by the ?raw import', async () => {
    const { bundledChangelog } = await import('./release-notes')

    expect(typeof bundledChangelog).toBe('string')
    expect(bundledChangelog.length).toBeGreaterThan(200)
    // Two markers from the file's own head: the title, and the Keep a Changelog link that makes it
    // the format `extractVersionSection` expects. Both would be absent from an empty or wrongly
    // resolved inline.
    expect(bundledChangelog).toContain('# Changelog')
    expect(bundledChangelog).toContain('keepachangelog.com')
  })

  it('installedReleaseNotes() resolves the running version against that bundled text', async () => {
    const { installedReleaseNotes, resolveReleaseNotes, bundledChangelog } =
      await import('./release-notes')

    // The mocked `app.getVersion()` is what the resolver must feed in - asserted against the pure
    // function over the same text rather than against a literal, so this test stays true whatever
    // the working tree's changelog happens to contain.
    expect(installedReleaseNotes()).toEqual(resolveReleaseNotes(bundledChangelog, '2.0.0'))
  })
})
