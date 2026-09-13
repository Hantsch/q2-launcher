import { describe, expect, it } from 'vitest'
import { SHIPPED_ICONS, shippedIconUrl } from './installation-icons'

/**
 * Story 067 D1: the shipped-icon manifest must be discovered from disk
 * (`import.meta.glob`), never a literal array of names (AC1). This test file
 * runs its own independent glob over the same directory (rather than reading
 * `SHIPPED_ICONS`' own module for the file list, which would prove nothing),
 * so a regression to a hardcoded array in the manifest — or a change to the
 * shipped set that forgets to update it — makes the counts/ids disagree.
 */
const filesOnDisk = import.meta.glob('../assets/installations/*.avif', { eager: true })

function idsOnDisk(): string[] {
  return Object.keys(filesOnDisk)
    .map((path) =>
      path
        .split('/')
        .pop()!
        .replace(/\.avif$/, ''),
    )
    .sort()
}

describe('SHIPPED_ICONS', () => {
  it('contains the six shipped installation icons', () => {
    const ids = SHIPPED_ICONS.map((icon) => icon.id).sort()
    expect(ids).toEqual(['gate', 'portal', 'q2pro-logo', 'r1q2-logo', 'ring', 'vanilla-logo'])
  })

  it('is derived from the asset directory, not a hardcoded list', () => {
    // If SHIPPED_ICONS were a literal array, this would drift the moment a
    // file is added to or removed from src/renderer/src/assets/installations
    // without anyone touching the manifest source.
    expect(SHIPPED_ICONS.map((icon) => icon.id).sort()).toEqual(idsOnDisk())
    expect(SHIPPED_ICONS).toHaveLength(idsOnDisk().length)
  })

  it('every entry resolves to a non-empty bundled url', () => {
    for (const icon of SHIPPED_ICONS) {
      expect(icon.url).toBeTruthy()
    }
  })

  it('is sorted by id', () => {
    const ids = SHIPPED_ICONS.map((icon) => icon.id)
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe('shippedIconUrl', () => {
  it('returns the url for a known id', () => {
    expect(shippedIconUrl('gate')).toBe(SHIPPED_ICONS.find((icon) => icon.id === 'gate')?.url)
  })

  it('returns undefined for an unknown id', () => {
    expect(shippedIconUrl('does-not-exist')).toBeUndefined()
  })
})
