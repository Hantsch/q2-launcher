import { describe, expect, test } from 'vitest'
import { applyVersion, deriveBump, isPrerelease, nextVersion } from './version.mjs'

/**
 * Story 096 D1: direct unit coverage of the pure semver helpers, so `plan.test.mjs`'s tests
 * aren't the only thing exercising these functions. Mirrors
 * `src/main/lib/renderer-source.test.ts`'s describe/test style.
 */

describe('deriveBump', () => {
  test('Added or Changed alone → minor', () => {
    expect(deriveBump(['Added'])).toBe('minor')
    expect(deriveBump(['Changed'])).toBe('minor')
    expect(deriveBump(['Added', 'Fixed'])).toBe('minor')
  })

  test('Fixed/Security only → patch', () => {
    expect(deriveBump(['Fixed'])).toBe('patch')
    expect(deriveBump(['Security'])).toBe('patch')
    expect(deriveBump(['Fixed', 'Security'])).toBe('patch')
  })

  test('Removed present → major', () => {
    expect(deriveBump(['Removed'])).toBe('major')
    expect(deriveBump(['Added', 'Removed'])).toBe('major')
  })

  test('a **BREAKING** bullet forces major even from Added/Changed-only categories', () => {
    expect(deriveBump(['Changed'], { hasBreaking: true })).toBe('major')
  })

  test('no categories at all → patch (nothing more severe was declared)', () => {
    expect(deriveBump([])).toBe('patch')
  })
})

describe('isPrerelease', () => {
  test('a beta version carries a prerelease identifier', () => {
    expect(isPrerelease('1.0.0-beta.1')).toBe(true)
  })

  test('a stable version does not', () => {
    expect(isPrerelease('1.0.0')).toBe(false)
  })
})

describe('nextVersion', () => {
  test('a derived bump (no explicit option) on a prerelease version only ticks the prerelease counter', () => {
    expect(nextVersion('1.0.0-beta.1', 'patch')).toBe('1.0.0-beta.2')
    expect(nextVersion('1.0.0-beta.1', 'minor')).toBe('1.0.0-beta.2')
    expect(nextVersion('1.0.0-beta.1', 'major')).toBe('1.0.0-beta.2')
  })

  test('a stable version applies a normal semver bump, resetting lower components', () => {
    expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  test('an explicit bump overrides the prerelease-increment path (AC6), dropping the prerelease identifier', () => {
    // A human-requested --bump means "cut a real release now" — it must not be masked into a
    // beta-counter tick just because `current` happens to be a prerelease.
    expect(nextVersion('1.0.0-beta.1', 'major', { explicit: true })).toBe('2.0.0')
    expect(nextVersion('1.0.0-beta.1', 'minor', { explicit: true })).toBe('1.1.0')
    expect(nextVersion('1.0.0-beta.1', 'patch', { explicit: true })).toBe('1.0.1')
  })

  test('explicit: true on an already-stable version behaves the same as the derived path', () => {
    expect(nextVersion('1.2.3', 'major', { explicit: true })).toBe('2.0.0')
  })
})

describe('applyVersion', () => {
  const pkgText = JSON.stringify({ name: 'q2-launcher', version: '0.1.0' }, null, 2) + '\n'
  const lockText =
    JSON.stringify(
      {
        name: 'q2-launcher',
        version: '0.1.0',
        lockfileVersion: 3,
        packages: {
          '': { name: 'q2-launcher', version: '0.1.0' },
          'node_modules/some-dep': { version: '0.1.0' },
        },
      },
      null,
      2,
    ) + '\n'

  test('replaces the version field in package.json text', () => {
    const { pkgText: result } = applyVersion(pkgText, lockText, '1.0.0-beta.1')
    expect(result).toContain('"version": "1.0.0-beta.1"')
    // Nothing else in the file changed.
    expect(result).toContain('"name": "q2-launcher"')
  })

  test('replaces both of the project\'s own version fields in package-lock.json text', () => {
    const { lockText: result } = applyVersion(pkgText, lockText, '1.0.0-beta.1')
    const occurrences = result.match(/"version": "1\.0\.0-beta\.1"/g) ?? []
    expect(occurrences.length).toBe(2)
  })

  test('does not touch an unrelated dependency\'s own version field', () => {
    const { lockText: result } = applyVersion(pkgText, lockText, '1.0.0-beta.1')
    expect(result).toContain('"node_modules/some-dep": {\n      "version": "0.1.0"')
  })
})
