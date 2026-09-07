import { describe, expect, it } from 'vitest'
import {
  iconDataUrlInputSchema,
  installationIconSchema,
  pickIconFileInputSchema,
  setInstallationIconInputSchema,
  shippedIconIdSchema,
} from './ipc-schemas'

/**
 * Story 067 D3: the shipped-icon id is a bounded slug, never a path. This is a
 * security-relevant acceptance criterion - a renderer-supplied id must not be
 * usable to escape `src/renderer/src/assets/installations`. The lookup itself
 * (`shippedIconUrl`, `src/renderer/src/lib/installation-icons.ts`) is a plain
 * manifest map, never a filesystem join - this bound is defence-in-depth, not
 * something a real path traversal could otherwise reach, but any path-shaped
 * id is still rejected here rather than trusted to be harmless downstream.
 */
describe('shippedIconIdSchema', () => {
  it('accepts a plain lowercase slug', () => {
    expect(shippedIconIdSchema.safeParse('classic-q2').success).toBe(true)
  })

  it.each([
    ['relative traversal', '../foo'],
    ['nested relative traversal', '../../etc/passwd'],
    ['unix absolute path', '/etc/passwd'],
    ['windows absolute path', 'C:\\evil'],
    ['forward slash', 'foo/bar'],
    ['backslash', 'foo\\bar'],
    ['uppercase', 'Foo'],
    ['empty string', ''],
    ['too long', 'a'.repeat(65)],
  ])('rejects %s (%j)', (_label, value) => {
    expect(shippedIconIdSchema.safeParse(value).success).toBe(false)
  })
})

describe('installationIconSchema', () => {
  it('accepts a shipped icon with a valid id', () => {
    const result = installationIconSchema.safeParse({ kind: 'shipped', id: 'classic-q2' })
    expect(result.success).toBe(true)
  })

  it('rejects a shipped icon whose id is a path', () => {
    const result = installationIconSchema.safeParse({ kind: 'shipped', id: '../../etc/passwd' })
    expect(result.success).toBe(false)
  })

  it('accepts a custom icon', () => {
    expect(installationIconSchema.safeParse({ kind: 'custom' }).success).toBe(true)
  })

  it('rejects an unknown kind', () => {
    expect(installationIconSchema.safeParse({ kind: 'bogus' }).success).toBe(false)
  })
})

describe('setInstallationIconInputSchema', () => {
  it('accepts a shipped icon payload', () => {
    const result = setInstallationIconInputSchema.safeParse({
      installationId: 'inst-1',
      icon: { kind: 'shipped', id: 'classic-q2' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a custom icon payload', () => {
    const result = setInstallationIconInputSchema.safeParse({
      installationId: 'inst-1',
      icon: { kind: 'custom' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a null icon (clearing it)', () => {
    const result = setInstallationIconInputSchema.safeParse({
      installationId: 'inst-1',
      icon: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a shipped icon id shaped like a path', () => {
    const result = setInstallationIconInputSchema.safeParse({
      installationId: 'inst-1',
      icon: { kind: 'shipped', id: '../../etc/passwd' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing installationId', () => {
    const result = setInstallationIconInputSchema.safeParse({ icon: null })
    expect(result.success).toBe(false)
  })
})

describe('pickIconFileInputSchema', () => {
  it('accepts a bare installationId', () => {
    expect(pickIconFileInputSchema.safeParse({ installationId: 'inst-1' }).success).toBe(true)
  })

  it('rejects an empty installationId', () => {
    expect(pickIconFileInputSchema.safeParse({ installationId: '' }).success).toBe(false)
  })
})

describe('iconDataUrlInputSchema', () => {
  it('accepts a bare id string', () => {
    expect(iconDataUrlInputSchema.safeParse('inst-1').success).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(iconDataUrlInputSchema.safeParse('').success).toBe(false)
  })
})
