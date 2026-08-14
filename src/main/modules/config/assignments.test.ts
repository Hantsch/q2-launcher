import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import { assign, reconcileAssignments, setDefault, unassign } from './assignments'

function profile(id: string, overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id,
    name: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

/** The invariant the whole file exists for, expressed once and asserted often. */
function defaultsFor(profiles: ConfigProfile[], installationId: string): string[] {
  return profiles
    .filter((p) => p.assignments.some((a) => a.installationId === installationId && a.isDefault))
    .map((p) => p.id)
}

function assignmentsOf(profiles: ConfigProfile[], profileId: string): ConfigProfile['assignments'] {
  return profiles.find((p) => p.id === profileId)!.assignments
}

describe('assign', () => {
  it('assigns one profile to several installations', () => {
    let profiles = [profile('p1')]

    profiles = assign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p1', installationId: 'i2' })

    expect(assignmentsOf(profiles, 'p1')).toEqual([
      { installationId: 'i1', isDefault: true },
      { installationId: 'i2', isDefault: true },
    ])
    // Two defaults, but for two different installations - the invariant is
    // per installation, not per profile.
    expect(defaultsFor(profiles, 'i1')).toEqual(['p1'])
    expect(defaultsFor(profiles, 'i2')).toEqual(['p1'])
  })

  it('assigns several profiles to one installation, defaulting only the first', () => {
    let profiles = [profile('p1'), profile('p2'), profile('p3')]

    profiles = assign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p2', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p3', installationId: 'i1' })

    expect(assignmentsOf(profiles, 'p1')).toEqual([{ installationId: 'i1', isDefault: true }])
    expect(assignmentsOf(profiles, 'p2')).toEqual([{ installationId: 'i1', isDefault: false }])
    expect(assignmentsOf(profiles, 'p3')).toEqual([{ installationId: 'i1', isDefault: false }])
    expect(defaultsFor(profiles, 'i1')).toEqual(['p1'])
  })

  it('makes an installation default again once its previous default was unassigned', () => {
    let profiles = [profile('p1'), profile('p2')]

    profiles = assign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = unassign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p2', installationId: 'i1' })

    expect(defaultsFor(profiles, 'i1')).toEqual(['p2'])
  })

  it('is idempotent and never flips an existing default', () => {
    let profiles = [profile('p1'), profile('p2')]
    profiles = assign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p2', installationId: 'i1' })

    profiles = assign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p2', installationId: 'i1' })

    expect(assignmentsOf(profiles, 'p1')).toEqual([{ installationId: 'i1', isDefault: true }])
    expect(assignmentsOf(profiles, 'p2')).toEqual([{ installationId: 'i1', isDefault: false }])
    expect(defaultsFor(profiles, 'i1')).toEqual(['p1'])
  })

  it('does not mutate the profiles it was given', () => {
    const profiles = [profile('p1')]

    assign(profiles, { profileId: 'p1', installationId: 'i1' })

    expect(profiles[0]!.assignments).toEqual([])
  })

  it('throws on an unknown profile id', () => {
    expect(() => assign([profile('p1')], { profileId: 'nope', installationId: 'i1' })).toThrow()
  })
})

describe('setDefault', () => {
  it('clears the previous default for that installation only', () => {
    let profiles = [profile('p1'), profile('p2')]
    // p1 holds the default for both installations, p2 is assigned to i1 too.
    profiles = assign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p1', installationId: 'i2' })
    profiles = assign(profiles, { profileId: 'p2', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p2', installationId: 'i2' })

    profiles = setDefault(profiles, { profileId: 'p2', installationId: 'i1' })

    expect(defaultsFor(profiles, 'i1')).toEqual(['p2'])
    // i2's default is untouched, on the very profile that just lost i1's.
    expect(defaultsFor(profiles, 'i2')).toEqual(['p1'])
    expect(assignmentsOf(profiles, 'p1')).toEqual([
      { installationId: 'i1', isDefault: false },
      { installationId: 'i2', isDefault: true },
    ])
  })

  it('is idempotent on the profile that already holds the default', () => {
    let profiles = [profile('p1'), profile('p2')]
    profiles = assign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p2', installationId: 'i1' })

    profiles = setDefault(profiles, { profileId: 'p1', installationId: 'i1' })

    expect(defaultsFor(profiles, 'i1')).toEqual(['p1'])
  })

  it('does not mutate the profiles it was given', () => {
    const profiles = assign([profile('p1'), profile('p2')], {
      profileId: 'p1',
      installationId: 'i1',
    })
    const withBoth = assign(profiles, { profileId: 'p2', installationId: 'i1' })

    setDefault(withBoth, { profileId: 'p2', installationId: 'i1' })

    expect(defaultsFor(withBoth, 'i1')).toEqual(['p1'])
  })

  it('throws on an unknown profile id', () => {
    expect(() => setDefault([profile('p1')], { profileId: 'nope', installationId: 'i1' })).toThrow()
  })

  it('throws when the profile is not assigned to that installation', () => {
    const profiles = assign([profile('p1')], { profileId: 'p1', installationId: 'i1' })

    expect(() => setDefault(profiles, { profileId: 'p1', installationId: 'other' })).toThrow()
  })
})

describe('unassign', () => {
  it('promotes another profile when the default assignment is removed', () => {
    let profiles = [profile('p1'), profile('p2'), profile('p3')]
    profiles = assign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p2', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p3', installationId: 'i1' })

    profiles = unassign(profiles, { profileId: 'p1', installationId: 'i1' })

    expect(assignmentsOf(profiles, 'p1')).toEqual([])
    // Deterministic: the first remaining assignment in list order wins, and
    // exactly one of them does.
    expect(defaultsFor(profiles, 'i1')).toEqual(['p2'])
  })

  it('promotes nothing when a non-default assignment is removed', () => {
    let profiles = [profile('p1'), profile('p2'), profile('p3')]
    profiles = assign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p2', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p3', installationId: 'i1' })

    profiles = unassign(profiles, { profileId: 'p2', installationId: 'i1' })

    expect(defaultsFor(profiles, 'i1')).toEqual(['p1'])
    expect(assignmentsOf(profiles, 'p3')).toEqual([{ installationId: 'i1', isDefault: false }])
  })

  it('leaves an installation with no default once its last assignment goes', () => {
    let profiles = [profile('p1'), profile('p2')]
    profiles = assign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p2', installationId: 'i1' })

    profiles = unassign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = unassign(profiles, { profileId: 'p2', installationId: 'i1' })

    expect(defaultsFor(profiles, 'i1')).toEqual([])
    expect(profiles.every((p) => p.assignments.length === 0)).toBe(true)
  })

  it('only touches the named installation', () => {
    let profiles = [profile('p1'), profile('p2')]
    profiles = assign(profiles, { profileId: 'p1', installationId: 'i1' })
    profiles = assign(profiles, { profileId: 'p1', installationId: 'i2' })
    profiles = assign(profiles, { profileId: 'p2', installationId: 'i2' })

    profiles = unassign(profiles, { profileId: 'p1', installationId: 'i2' })

    expect(assignmentsOf(profiles, 'p1')).toEqual([{ installationId: 'i1', isDefault: true }])
    expect(defaultsFor(profiles, 'i1')).toEqual(['p1'])
    expect(defaultsFor(profiles, 'i2')).toEqual(['p2'])
  })

  it('is a no-op when the installation was not assigned to that profile', () => {
    const profiles = assign([profile('p1'), profile('p2')], {
      profileId: 'p1',
      installationId: 'i1',
    })

    const result = unassign(profiles, { profileId: 'p2', installationId: 'i1' })

    expect(result).toEqual(profiles)
  })

  it('does not mutate the profiles it was given', () => {
    const profiles = assign([profile('p1')], { profileId: 'p1', installationId: 'i1' })

    unassign(profiles, { profileId: 'p1', installationId: 'i1' })

    expect(assignmentsOf(profiles, 'p1')).toEqual([{ installationId: 'i1', isDefault: true }])
  })

  it('throws on an unknown profile id', () => {
    expect(() => unassign([profile('p1')], { profileId: 'nope', installationId: 'i1' })).toThrow()
  })
})

describe('reconcileAssignments', () => {
  it('drops assignments for unknown installations and keeps the rest verbatim', () => {
    const profiles = [
      profile('p1', {
        assignments: [
          { installationId: 'gone', isDefault: true },
          { installationId: 'i1', isDefault: true },
        ],
      }),
      profile('p2', {
        assignments: [
          { installationId: 'i1', isDefault: false },
          { installationId: 'alsoGone', isDefault: false },
        ],
      }),
    ]

    const result = reconcileAssignments(profiles, ['i1'])

    expect(assignmentsOf(result, 'p1')).toEqual([{ installationId: 'i1', isDefault: true }])
    expect(assignmentsOf(result, 'p2')).toEqual([{ installationId: 'i1', isDefault: false }])
    expect(defaultsFor(result, 'i1')).toEqual(['p1'])
  })

  it('never promotes across installations', () => {
    // p1's only default was for the vanished installation; i2 keeps the
    // default it already had, and nothing else is handed one.
    const profiles = [
      profile('p1', { assignments: [{ installationId: 'gone', isDefault: true }] }),
      profile('p2', { assignments: [{ installationId: 'i2', isDefault: true }] }),
      profile('p3', { assignments: [{ installationId: 'i2', isDefault: false }] }),
    ]

    const result = reconcileAssignments(profiles, ['i2'])

    expect(assignmentsOf(result, 'p1')).toEqual([])
    expect(defaultsFor(result, 'i2')).toEqual(['p2'])
    expect(defaultsFor(result, 'gone')).toEqual([])
  })

  it('is a no-op when every assignment is known', () => {
    const profiles = [
      profile('p1', { assignments: [{ installationId: 'i1', isDefault: true }] }),
      profile('p2', { assignments: [{ installationId: 'i1', isDefault: false }] }),
    ]

    expect(reconcileAssignments(profiles, ['i1', 'i2'])).toEqual(profiles)
  })

  it('drops everything when no installation is known', () => {
    const profiles = [profile('p1', { assignments: [{ installationId: 'i1', isDefault: true }] })]

    const result = reconcileAssignments(profiles, [])

    expect(assignmentsOf(result, 'p1')).toEqual([])
    expect(profiles[0]!.assignments).toHaveLength(1)
  })
})
