import { describe, expect, it } from 'vitest'
import { configProfileSchema } from './schemas'
import { setProfileActionsInputSchema } from '../modules/config/schemas'

/**
 * Story 008's persisted-state shape for `ConfigProfile.categories`/`.actions`. Unlike `layers`
 * (a whole-array `.catch(() => [])`), this story's acceptance criterion requires row-level
 * dropping: one malformed row must not wipe the rest of the array. See `parseForgivingRows` in
 * `./schemas.ts` for the mechanism.
 */
describe('configProfileSchema - categories/actions (story 008)', () => {
  const baseProfile = {
    id: 'p1',
    name: 'My profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignments: [],
  }

  it('parses to categories: [] and actions: [] when both keys are absent', () => {
    const result = configProfileSchema.parse(baseProfile)
    expect(result.categories).toEqual([])
    expect(result.actions).toEqual([])
  })

  it('drops only the malformed row among two action rows, keeping the valid one', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      actions: [
        // Missing `id` - malformed.
        { categoryId: 'c1', name: 'Bad row', commands: [] },
        // Well-formed.
        { id: 'a1', categoryId: 'c1', name: 'Good row', commands: [{ kind: 'raw', text: '+forward' }] },
      ],
    })
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({ id: 'a1', name: 'Good row' })
  })

  it('drops only the malformed row among two category rows, keeping the valid one', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      categories: [
        // Missing `entryKind` - malformed.
        { id: 'c1', name: 'Bad category' },
        // Well-formed.
        { id: 'c2', name: 'Good category', entryKind: 'bind' },
      ],
    })
    expect(result.categories).toHaveLength(1)
    expect(result.categories[0]).toMatchObject({ id: 'c2', name: 'Good category' })
  })

  it('drops a row whose command text is not latin-1, keeping unrelated well-formed rows', () => {
    const result = configProfileSchema.parse({
      ...baseProfile,
      actions: [
        {
          id: 'a1',
          categoryId: 'c1',
          name: 'Bad text',
          commands: [{ kind: 'raw', text: 'em dash — here' }],
        },
        {
          id: 'a2',
          categoryId: 'c1',
          name: 'Good text',
          commands: [{ kind: 'raw', text: '+forward' }],
        },
      ],
    })
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({ id: 'a2' })
  })

  it('round-trips a well-formed categories/actions payload through the strict and persisted schemas', () => {
    const payload = {
      profileId: 'p1',
      categories: [{ id: 'c1', name: 'Custom', entryKind: 'bind' as const }],
      actions: [
        {
          id: 'a1',
          categoryId: 'c1',
          name: 'Jump forward',
          commands: [{ kind: 'raw' as const, text: '+forward' }],
          key: 'W',
        },
      ],
    }

    const strict = setProfileActionsInputSchema.parse(payload)

    const persisted = configProfileSchema.parse({
      ...baseProfile,
      categories: strict.categories,
      actions: strict.actions,
    })

    expect(persisted.categories).toEqual(strict.categories)
    expect(persisted.actions).toEqual(strict.actions)
  })
})
