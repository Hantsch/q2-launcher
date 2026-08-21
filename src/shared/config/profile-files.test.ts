import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { resolveProfileFileNames, sanitizeProfileFileBase } from './profile-files'

type ProfileLike = Pick<ConfigProfile, 'id' | 'name' | 'createdAt'>

function profile(overrides: Partial<ProfileLike> = {}): ProfileLike {
  return {
    id: 'test-id',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('sanitizeProfileFileBase', () => {
  it('maps spaces to a single dash', () => {
    expect(sanitizeProfileFileBase('My Config', 'id-1')).toBe('My-Config')
  })

  it('maps quotes to dashes and collapses the resulting run', () => {
    expect(sanitizeProfileFileBase('"Frag" "Setup"', 'id-1')).toBe('Frag-Setup')
  })

  it('maps unicode characters to dashes', () => {
    expect(sanitizeProfileFileBase('Bjørn Größe ÿ', 'id-1')).toBe('Bj-rn-Gr-e')
  })

  it('collapses runs of already-invalid-turned-dash characters into one dash', () => {
    expect(sanitizeProfileFileBase('a;;;;b', 'id-1')).toBe('a-b')
  })

  it('trims leading and trailing dots and dashes', () => {
    expect(sanitizeProfileFileBase('--.foo.--', 'id-1')).toBe('foo')
  })

  it('keeps [A-Za-z0-9_.-] characters untouched', () => {
    expect(sanitizeProfileFileBase('My_Config-2.0', 'id-1')).toBe('My_Config-2.0')
  })

  it('caps the result at 48 characters', () => {
    const longName = 'a'.repeat(60)
    const result = sanitizeProfileFileBase(longName, 'id-1')
    expect(result).toBe('a'.repeat(48))
    expect(result.length).toBe(48)
  })

  it('re-trims a trailing dash exposed by truncation at the cap', () => {
    // 47 'a's then a run of dashes/space that would land the 48th character
    // on a dash if the cap sliced blindly through the middle of the run.
    const name = `${'a'.repeat(47)} ---- b`
    const result = sanitizeProfileFileBase(name, 'id-1')
    expect(result.length).toBeLessThanOrEqual(48)
    expect(result.endsWith('-')).toBe(false)
  })

  it('falls back to profile-<first 8 chars of id> for an empty name', () => {
    expect(sanitizeProfileFileBase('', 'abcdefgh12345')).toBe('profile-abcdefgh')
  })

  it('falls back to profile-<first 8 chars of id> for an all-invalid name', () => {
    expect(sanitizeProfileFileBase('!!!???///', 'abcdefgh12345')).toBe('profile-abcdefgh')
  })

  it('falls back to profile-<first 8 chars of id> for a name that is only dots and dashes', () => {
    expect(sanitizeProfileFileBase('...---...', 'abcdefgh12345')).toBe('profile-abcdefgh')
  })

  it.each(['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9'])(
    'appends -cfg to the Windows reserved device name %s',
    (device) => {
      expect(sanitizeProfileFileBase(device, 'id-1')).toBe(`${device}-cfg`)
    },
  )

  it('matches reserved device names case-insensitively', () => {
    expect(sanitizeProfileFileBase('nul', 'id-1')).toBe('nul-cfg')
    expect(sanitizeProfileFileBase('Nul', 'id-1')).toBe('Nul-cfg')
    expect(sanitizeProfileFileBase('com3', 'id-1')).toBe('com3-cfg')
  })

  it('does not treat a reserved name as a substring match', () => {
    expect(sanitizeProfileFileBase('NULLIFY', 'id-1')).toBe('NULLIFY')
    expect(sanitizeProfileFileBase('ICON', 'id-1')).toBe('ICON')
  })
})

describe('resolveProfileFileNames', () => {
  it('resolves a single profile to <base>.cfg', () => {
    const p = profile({ id: 'p1', name: 'My Config' })
    const result = resolveProfileFileNames([p])

    expect(result.get('p1')).toBe('My-Config.cfg')
  })

  it('resolves distinct names to distinct files with no suffix', () => {
    const a = profile({ id: 'a', name: 'Alpha' })
    const b = profile({ id: 'b', name: 'Beta' })
    const result = resolveProfileFileNames([a, b])

    expect(result.get('a')).toBe('Alpha.cfg')
    expect(result.get('b')).toBe('Beta.cfg')
  })

  it('resolves a case-insensitive collision by createdAt order, earliest first', () => {
    const earlier = profile({ id: 'earlier', name: 'Frag', createdAt: '2026-01-01T00:00:00.000Z' })
    const later = profile({ id: 'later', name: 'FRAG', createdAt: '2026-01-02T00:00:00.000Z' })

    const result = resolveProfileFileNames([earlier, later])

    expect(result.get('earlier')).toBe('Frag.cfg')
    expect(result.get('later')).toBe('FRAG-2.cfg')
  })

  it('assigns -2 and -3 to a three-way collision in createdAt order', () => {
    const first = profile({ id: 'first', name: 'frag', createdAt: '2026-01-01T00:00:00.000Z' })
    const second = profile({ id: 'second', name: 'Frag', createdAt: '2026-01-02T00:00:00.000Z' })
    const third = profile({ id: 'third', name: 'FRAG', createdAt: '2026-01-03T00:00:00.000Z' })

    const result = resolveProfileFileNames([first, second, third])

    expect(result.get('first')).toBe('frag.cfg')
    expect(result.get('second')).toBe('Frag-2.cfg')
    expect(result.get('third')).toBe('FRAG-3.cfg')
  })

  it('tie-breaks identical createdAt by id ascending', () => {
    const sameTime = '2026-01-01T00:00:00.000Z'
    const zeta = profile({ id: 'zeta', name: 'Frag', createdAt: sameTime })
    const alpha = profile({ id: 'alpha', name: 'Frag', createdAt: sameTime })

    const result = resolveProfileFileNames([zeta, alpha])

    expect(result.get('alpha')).toBe('Frag.cfg')
    expect(result.get('zeta')).toBe('Frag-2.cfg')
  })

  it('produces an identical mapping regardless of input array order', () => {
    const a = profile({ id: 'a', name: 'Frag', createdAt: '2026-01-01T00:00:00.000Z' })
    const b = profile({ id: 'b', name: 'FRAG', createdAt: '2026-01-02T00:00:00.000Z' })
    const c = profile({ id: 'c', name: 'Other', createdAt: '2026-01-03T00:00:00.000Z' })
    const d = profile({ id: 'd', name: 'frag', createdAt: '2026-01-04T00:00:00.000Z' })

    const forward = resolveProfileFileNames([a, b, c, d])
    const shuffled = resolveProfileFileNames([d, c, b, a])
    const reversed = resolveProfileFileNames([d, b, a, c])

    const asEntries = (m: Map<string, string>) => [...m.entries()].sort(([x], [y]) => (x < y ? -1 : 1))

    expect(asEntries(shuffled)).toEqual(asEntries(forward))
    expect(asEntries(reversed)).toEqual(asEntries(forward))
  })

  it('handles multiple independent collision groups without cross-contamination', () => {
    const frag1 = profile({ id: 'frag1', name: 'Frag', createdAt: '2026-01-01T00:00:00.000Z' })
    const frag2 = profile({ id: 'frag2', name: 'frag', createdAt: '2026-01-02T00:00:00.000Z' })
    const zoom1 = profile({ id: 'zoom1', name: 'Zoom', createdAt: '2026-01-01T00:00:00.000Z' })
    const zoom2 = profile({ id: 'zoom2', name: 'ZOOM', createdAt: '2026-01-02T00:00:00.000Z' })

    const result = resolveProfileFileNames([frag1, frag2, zoom1, zoom2])

    expect(result.get('frag1')).toBe('Frag.cfg')
    expect(result.get('frag2')).toBe('frag-2.cfg')
    expect(result.get('zoom1')).toBe('Zoom.cfg')
    expect(result.get('zoom2')).toBe('ZOOM-2.cfg')
  })

  it('returns an empty map for an empty profile list', () => {
    expect(resolveProfileFileNames([])).toEqual(new Map())
  })

  it('never lets a suffixed name collide with a different profile literally named that way', () => {
    // Review finding: "Frag" and "Frag" sanitize to the same base ("frag"),
    // so the second one would naturally want "-2" - but a THIRD profile is
    // literally named "Frag-2", whose own (unsuffixed) name IS that exact
    // string. Grouping by sanitized base alone (the pre-fix algorithm) treats
    // these as two unrelated single-member groups and lets both resolve to
    // "Frag-2.cfg" - claiming against one global set instead must give the
    // later-claiming one "Frag-3.cfg" instead.
    const first = profile({ id: 'first', name: 'Frag', createdAt: '2026-01-01T00:00:00.000Z' })
    const second = profile({ id: 'second', name: 'Frag', createdAt: '2026-01-02T00:00:00.000Z' })
    const third = profile({ id: 'third', name: 'Frag-2', createdAt: '2026-01-03T00:00:00.000Z' })

    const result = resolveProfileFileNames([first, second, third])
    const names = [...result.values()]

    expect(result.get('first')).toBe('Frag.cfg')
    expect(result.get('second')).toBe('Frag-2.cfg')
    // "third"'s own base IS "Frag-2" (already claimed by "second" above), so
    // it keeps stepping - the exact resulting string is not the point; that
    // no two profiles ever end up with the same file name is.
    expect(result.get('third')).toBe('Frag-2-2.cfg')
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length)
  })
})
