import { describe, expect, it } from 'vitest'
import type { ConfigProfile } from '@shared/modules/config'
import {
  ADDRESS_BOOK_SLOTS,
  buildAddressBookCvars,
  pickPreselectedProfileId,
  pickPreselectedSlot,
  readAddressBookSlots,
} from './address-book'

function makeProfile(overrides: Partial<ConfigProfile> = {}): ConfigProfile {
  return {
    id: 'p1',
    name: 'Profile 1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    cvars: {},
    binds: {},
    assignments: [],
    ...overrides,
  }
}

describe('readAddressBookSlots', () => {
  it('an absent or blank adr slot reads as empty', () => {
    const slots = readAddressBookSlots({
      adr0: '1.2.3.4:27910',
      adr1: '',
      adr2: '   ',
      // adr3..adr8 absent entirely
    })

    expect(slots).toHaveLength(9)
    expect(slots.map((s) => s.slot)).toEqual([...ADDRESS_BOOK_SLOTS])
    expect(slots[0]).toEqual({ slot: 'adr0', value: '1.2.3.4:27910' })
    expect(slots[1]).toEqual({ slot: 'adr1', value: undefined })
    expect(slots[2]).toEqual({ slot: 'adr2', value: undefined })
    expect(slots[3]).toEqual({ slot: 'adr3', value: undefined })
    expect(slots[8]).toEqual({ slot: 'adr8', value: undefined })
  })
})

describe('pickPreselectedProfileId', () => {
  it("the active installation's default profile is preselected, else the first", () => {
    const profiles = [
      makeProfile({ id: 'a', assignments: [{ installationId: 'inst-1', isDefault: false }] }),
      makeProfile({ id: 'b', assignments: [{ installationId: 'inst-1', isDefault: true }] }),
      makeProfile({ id: 'c' }),
    ]

    expect(pickPreselectedProfileId(profiles, 'inst-1')).toBe('b')
    // No default assignment for this installation -> falls back to the first profile.
    expect(pickPreselectedProfileId(profiles, 'inst-2')).toBe('a')
    // No active installation at all -> falls back to the first profile.
    expect(pickPreselectedProfileId(profiles, null)).toBe('a')
    // No profiles at all -> undefined.
    expect(pickPreselectedProfileId([], 'inst-1')).toBeUndefined()
  })
})

describe('pickPreselectedSlot', () => {
  it('the slot already holding the address wins, then the lowest empty slot, then none', () => {
    const address = '1.2.3.4:27910'

    const slotsWithMatch = readAddressBookSlots({ adr0: 'other:1', adr3: address })
    expect(pickPreselectedSlot(slotsWithMatch, address)).toBe('adr3')

    const slotsAllEmptyButFirst = readAddressBookSlots({ adr0: 'occupied:1' })
    expect(pickPreselectedSlot(slotsAllEmptyButFirst, address)).toBe('adr1')

    const fullCvars = Object.fromEntries(ADDRESS_BOOK_SLOTS.map((slot, i) => [slot, `x:${i}`]))
    const slotsAllFull = readAddressBookSlots(fullCvars)
    expect(pickPreselectedSlot(slotsAllFull, address)).toBeUndefined()
  })
})

describe('buildAddressBookCvars', () => {
  it('the written cvars keep every other cvar and do not mutate the input', () => {
    const current = { sensitivity: '3', adr0: 'old:1' }
    const result = buildAddressBookCvars(current, 'adr0', '1.2.3.4:27910')

    expect(result).toEqual({ sensitivity: '3', adr0: '1.2.3.4:27910' })
    expect(result).not.toBe(current)
    expect(current).toEqual({ sensitivity: '3', adr0: 'old:1' })
  })
})
