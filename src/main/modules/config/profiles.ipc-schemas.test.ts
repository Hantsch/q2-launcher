import { describe, expect, it } from 'vitest'
import {
  setProfileActionsInputSchema,
  setProfileBindsInputSchema,
  setProfileLayersInputSchema,
} from './schemas'

describe('setProfileBindsInputSchema / setProfileLayersInputSchema (IPC payload validation)', () => {
  it('rejects a binds payload whose value is not a map of strings', () => {
    expect(setProfileBindsInputSchema.safeParse({ profileId: 'p1', binds: { w: 1 } }).success).toBe(
      false,
    )
  })

  it('rejects a binds payload missing profileId', () => {
    expect(setProfileBindsInputSchema.safeParse({ binds: {} }).success).toBe(false)
  })

  it('accepts a well-formed binds payload', () => {
    expect(
      setProfileBindsInputSchema.safeParse({ profileId: 'p1', binds: { w: '+forward' } }).success,
    ).toBe(true)
  })

  it('rejects a layers payload with a garbage shape (string instead of array)', () => {
    expect(setProfileLayersInputSchema.safeParse({ profileId: 'p1', layers: 'nope' }).success).toBe(
      false,
    )
  })

  it('rejects a layers payload with an invalid mode', () => {
    expect(
      setProfileLayersInputSchema.safeParse({
        profileId: 'p1',
        layers: [{ id: 'l1', name: 'Drops', mode: 'sticky', triggerKey: 'ALT', overrides: {} }],
      }).success,
    ).toBe(false)
  })

  it('accepts a well-formed layers payload', () => {
    expect(
      setProfileLayersInputSchema.safeParse({
        profileId: 'p1',
        layers: [{ id: 'l1', name: 'Drops', mode: 'hold', triggerKey: 'ALT', overrides: {} }],
      }).success,
    ).toBe(true)
  })

  // Story 011: triggerKey becomes nullable - null means "no trigger assigned yet".
  it('accepts a layers payload with triggerKey: null', () => {
    expect(
      setProfileLayersInputSchema.safeParse({
        profileId: 'p1',
        layers: [{ id: 'l1', name: 'Drops', mode: 'hold', triggerKey: null, overrides: {} }],
      }).success,
    ).toBe(true)
  })

  it('rejects a layers payload with triggerKey: "" (empty string)', () => {
    expect(
      setProfileLayersInputSchema.safeParse({
        profileId: 'p1',
        layers: [{ id: 'l1', name: 'Drops', mode: 'hold', triggerKey: '', overrides: {} }],
      }).success,
    ).toBe(false)
  })
})

// Story 015 (decisions 1 + 2): the payload gains two optional fields and no new channel.
describe('setProfileActionsInputSchema (IPC payload validation)', () => {
  function payload(action: Record<string, unknown>): unknown {
    return {
      profileId: 'p1',
      categories: [{ id: 'movement', name: 'Movement' }],
      actions: [
        {
          id: 'a1',
          categoryId: 'movement',
          name: 'Jump',
          kind: 'bind',
          commands: [{ kind: 'raw', text: '+moveup' }],
          ...action,
        },
      ],
    }
  }

  it('accepts an actions payload carrying secondaryKey and catalogId', () => {
    expect(
      setProfileActionsInputSchema.safeParse(
        payload({ key: 'f', secondaryKey: 'MOUSE2', catalogId: 'movement.jump' }),
      ).success,
    ).toBe(true)
  })

  it('accepts an actions payload with neither field (a pre-015 action)', () => {
    expect(setProfileActionsInputSchema.safeParse(payload({ key: 'f' })).success).toBe(true)
  })

  it('rejects a secondaryKey longer than the key limit, same as key', () => {
    const tooLong = 'x'.repeat(21)
    expect(setProfileActionsInputSchema.safeParse(payload({ secondaryKey: tooLong })).success).toBe(
      false,
    )
    // The point is that the second slot is no laxer than the first.
    expect(setProfileActionsInputSchema.safeParse(payload({ key: tooLong })).success).toBe(false)
  })

  it('rejects an empty catalogId', () => {
    expect(setProfileActionsInputSchema.safeParse(payload({ catalogId: '' })).success).toBe(false)
  })
})
