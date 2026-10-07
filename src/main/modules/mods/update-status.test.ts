import { describe, expect, it } from 'vitest'
import { computeModUpdateStatus } from './update-status'

describe('computeModUpdateStatus', () => {
  it('a pinned version that differs from the record, higher or lower, is an update', () => {
    expect(
      computeModUpdateStatus({ catalogId: 'rogue', version: '1.0' }, { pinned: '1.1' })
        .updateAvailable,
    ).toBe(true)
    expect(
      computeModUpdateStatus({ catalogId: 'rogue', version: '1.1' }, { pinned: '1.0' })
        .updateAvailable,
    ).toBe(true)
  })

  it('an equal version is no update and reports both versions', () => {
    expect(
      computeModUpdateStatus({ catalogId: 'rogue', version: '1.0' }, { pinned: '1.0' }),
    ).toEqual({
      updateAvailable: false,
      installedVersion: '1.0',
      pinnedVersion: '1.0',
    })
  })

  it('a missing installed version counts as differing', () => {
    expect(computeModUpdateStatus({ catalogId: 'rogue' }, { pinned: '1.0' }).updateAvailable).toBe(
      true,
    )
  })

  it('a manual gamedir never has an update', () => {
    expect(
      computeModUpdateStatus({ catalogId: '', version: '1.0' }, { pinned: '2.0' }).updateAvailable,
    ).toBe(false)
    expect(computeModUpdateStatus(undefined, { pinned: '2.0' }).updateAvailable).toBe(false)
  })

  it('no catalog entry means nothing to update to', () => {
    expect(
      computeModUpdateStatus({ catalogId: 'rogue', version: '1.0' }, undefined).updateAvailable,
    ).toBe(false)
  })
})
